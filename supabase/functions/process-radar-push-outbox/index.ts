import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (payload: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) throw new Error('Faltan variables de Supabase.');

    const authorization = req.headers.get('Authorization') || '';
    if (authorization !== `Bearer ${serviceKey}`) {
      return jsonResponse({ error: 'No autorizado' }, 401);
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const requestedLimit = Number(body.limit || 25);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 25, 100));

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: jobs, error: claimError } = await admin.rpc('claim_radar_push_jobs', {
      p_limit: limit,
    });
    if (claimError) throw claimError;

    let sent = 0;
    let failed = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const job of jobs || []) {
      try {
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
        const noDevices = pushResponse.ok && Number(pushResult.sent || 0) === 0 && Number(pushResult.failed || 0) === 0;
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
          p_error: error?.message || 'Radar push processing failed',
        });
        results.push({ job_id: job.job_id, success: false, error: error?.message || 'Unknown error' });
      }
    }

    return jsonResponse({ claimed: jobs?.length || 0, sent, failed, results });
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Error procesando la cola push del radar' }, 500);
  }
});
