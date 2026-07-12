import { supabase } from '@/lib/supabase.js';

export const DEFAULT_RIDE_EXPIRATION_GRACE_MINUTES = 120;

export const expireStaleRides = async (graceMinutes = DEFAULT_RIDE_EXPIRATION_GRACE_MINUTES) => {
  const { data, error } = await supabase.rpc('expire_stale_rides', {
    p_grace_minutes: Number(graceMinutes) || DEFAULT_RIDE_EXPIRATION_GRACE_MINUTES,
  });

  if (error) throw error;

  return {
    success: data?.success ?? true,
    expiredCount: Number(data?.expired_count || 0),
    graceMinutes: Number(data?.grace_minutes || graceMinutes),
    ranAt: data?.ran_at || new Date().toISOString(),
    raw: data,
  };
};
