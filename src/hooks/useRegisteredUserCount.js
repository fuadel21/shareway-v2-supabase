import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { getPublicRegisteredUserCount } from '../lib/supabaseRPC.js';

export const readRegisteredUserCount = (data) => {
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : { count: data };
  const count = Number(payload?.count);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
};

/**
 * Live public registered-user counter shared by the landing page and the dashboard.
 * Realtime only signals that the aggregate row changed; the value itself is
 * always fetched through the allow-listed RPC.
 */
export function useRegisteredUserCount(channelName = 'public-registered-user-count') {
  const [registeredUsers, setRegisteredUsers] = useState(null);
  const [countError, setCountError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const refreshCount = async () => {
      const response = await getPublicRegisteredUserCount();
      if (!isMounted) return;

      const count = response.success ? readRegisteredUserCount(response.data) : null;
      if (count === null) {
        setCountError(true);
        return;
      }

      setRegisteredUsers(count);
      setCountError(false);
    };

    refreshCount();

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'public_platform_stats' },
        refreshCount
      )
      .subscribe();

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshCount();
    };
    const interval = window.setInterval(refreshCount, 30000);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      supabase.removeChannel(channel);
    };
  }, [channelName]);

  return { registeredUsers, countError };
}

export default useRegisteredUserCount;
