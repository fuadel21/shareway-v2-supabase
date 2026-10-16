import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

;

const jsonResponse = (payload: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { 'Content-Type': 'application/json' } },
);

type PushJob = {
  job_id: number;
  notification_id: string;
  user_id: string;
  title: string;
  message: string;
  action_url: string;
  metadata?: Record<string, unknown> | null;
  attempts?: number;
};

type ReminderValidation = {
  valid: boolean;
  reason?: string;
};

const isTrue = (value: unknown) => value === true || String(value).toLowerCase() === 'true';

const validateTripReminder = async (
  admin: ReturnType<typeof createClient>,
  job: PushJob,
): Promise<ReminderValidation> => {
  const metadata = (job.metadata || {}) as Record<string, unknown>;
  if (!isTrue(metadata.trip_reminder)) return { valid: true };

  const rideId = String(metadata.ride_id || '').trim();
  const snapshotRaw = String(metadata.departure_time_snapshot || '').trim();
  if (!rideId || !snapshotRaw) {
    return { valid: false, reason: 'TRIP_REMINDER_METADATA_INVALID' };
  }

  const { data: ride, error } = await admin
    .from('rides')
    .select('id,status,departure_time,driver_id,passengers')
    .eq('id', rideId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo validar el recordatorio: ${error.message}`);
  }
  if (!ride) return { valid: false, reason: 'RIDE_NOT_FOUND' };
  if (String(ride.status || '').toLowerCase() !== 'scheduled') {
    return { valid: false, reason: `RIDE_STATUS_${String(ride.status || 'UNKNOWN').toUpperCase()}` };
  }

  const snapshotTime = Date.parse(snapshotRaw);
  const currentDeparture = Date.parse(String(ride.departure_time || ''));
  if (!Number.isFinite(snapshotTime) || !Number.isFinite(currentDeparture)) {
    return { valid: false, reason: 'DEPARTURE_TIME_INVALID' };
  }

  // Any reschedule invalidates a queued reminder created for the previous departure.
  if (Math.abs(snapshotTime - currentDeparture) > 1000) {
    return { valid: false, reason: 'RIDE_RESCHEDULED' };
  }

  const remainingMs = currentDeparture - Date.now();
  if (remainingMs <= 0) return { valid: false, reason: 'RIDE_ALREADY_DEPARTED' };

  // A heavily delayed 24h push should not arrive alongside the much more useful 1h reminder.
  if (String(metadata.reminder_key || '') === '24h' && remainingMs < 2 * 60 * 60 * 1000) {
    return { valid: false, reason: '24H_REMINDER_TOO_LATE' };
  }

  const recipientRole = String(metadata.recipient_role || '');
  const isCurrentDriver = String(ride.driver_id || '') === String(job.user_id);
  const passengers = Array.isArray(ride.passengers) ? ride.passengers : [];
  const isCurrentPassenger = passengers.some((passenger: Record<string, unknown>) => {
    const status = String(passenger?.status || '').toLowerCase();
    return String(passenger?.id || '') === String(job.user_id)
      && ['confirmed', 'verified', 'on_board'].includes(status);
  });

  if (recipientRole === 'driver' && !isCurrentDriver) {
    return { valid: false, reason: 'DRIVER_NO_LONGER_ASSIGNED' };
  }
  if (recipientRole === 'passenger' && !isCurrentPassenger) {
    return { valid: false, reason: 'PASSENGER_BOOKING_NO_LONGER_ACTIVE' };
  }
  if (!recipientRole && !isCurrentDriver && !isCurrentPassenger) {
    return { valid: false, reason: 'RECIPIENT_NO_LONGER_ON_RIDE' };
  }

  return { valid: true };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) throw new Error('Faltan variables de Supabase.');

    // Autenticacion del cron: Bearer service_role O secreto compartido
    // (el cron de la BD no necesita material de clave sensible en el vault)
    const authorization = req.headers.get('Authorization') || '';
    const sharedSecret = req.headers.get('x-sw-webhook') || '';
    const authorized = authorization === `Bearer ${serviceKey}`
      || sharedSecret === 'shareway-bookings-2026';
    if (!authorized) {
      return jsonResponse({ error: 'No autorizado' }, 401);
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const requestedLimit = Number(body.limit || 25);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 25, 100));

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // The same scheduled worker that drains radar pushes also discovers due trip reminders.
    // This call is intentionally non-fatal so radar delivery keeps working during rollout
    // or if reminder generation temporarily fails.
    const { data: reminderSweep, error: reminderSweepError } = await admin.rpc('enqueue_due_trip_reminders');

    const { data: jobs, error: claimError } = await admin.rpc('claim_radar_push_jobs', {
      p_limit: limit,
    });
    if (claimError) throw claimError;

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const rawJob of jobs || []) {
      const job = rawJob as PushJob;
      try {
        const validation = await validateTripReminder(admin, job);
        if (!validation.valid) {
          const { error: discardError } = await admin.rpc('discard_radar_push_job', {
            p_job_id: job.job_id,
            p_reason: validation.reason || 'STALE_TRIP_REMINDER',
          });
          if (discardError) throw discardError;

          skipped += 1;
          results.push({
            job_id: job.job_id,
            success: true,
            skipped: true,
            reason: validation.reason || 'STALE_TRIP_REMINDER',
          });
          continue;
        }

        const pushResponse = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            notification: {
              id: job.notification_id,
              user_id: job.user_id,
              title: job.title,
              message: job.message,
              action_url: job.action_url,
              metadata: job.metadata,
            },
          }),
        });

        const pushResult = await pushResponse.json().catch(() => ({})) as Record<string, unknown>;
        const delivered = pushResponse.ok && Number(pushResult.sent || 0) > 0;
        const noDevices = pushResponse.ok
          && Number(pushResult.sent || 0) === 0
          && Number(pushResult.failed || 0) === 0;
        const success = delivered || noDevices;
        const errorMessage = success
          ? null
          : String(pushResult.error || `send-push returned ${pushResponse.status}`);

        const { error: finishError } = await admin.rpc('finish_radar_push_job', {
          p_job_id: job.job_id,
          p_success: success,
          p_error: errorMessage,
        });
        if (finishError) throw finishError;

        if (success) sent += 1;
        else failed += 1;
        results.push({ job_id: job.job_id, success, push: pushResult });
      } catch (error) {
        failed += 1;
        await admin.rpc('finish_radar_push_job', {
          p_job_id: job.job_id,
          p_success: false,
          p_error: error?.message || 'Background push processing failed',
        });
        results.push({
          job_id: job.job_id,
          success: false,
          error: error?.message || 'Unknown error',
        });
      }
    }

    return jsonResponse({
      reminder_sweep: reminderSweep || null,
      reminder_sweep_error: reminderSweepError?.message || null,
      claimed: jobs?.length || 0,
      sent,
      failed,
      skipped,
      results,
    });
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Error procesando la cola push en segundo plano' }, 500);
  }
});
