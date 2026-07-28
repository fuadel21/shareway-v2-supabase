const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STORAGE_KEY = 'shareway-radar-heartbeat-at';

const canTouchNow = () => {
  if (typeof window === 'undefined') return false;
  const last = Number(window.localStorage.getItem(STORAGE_KEY) || 0);
  return !Number.isFinite(last) || Date.now() - last >= HEARTBEAT_INTERVAL_MS;
};

const markTouched = () => {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable in private mode; heartbeat still succeeds.
  }
};

export const installRadarPresenceHeartbeat = (client) => {
  if (!client || typeof window === 'undefined' || typeof document === 'undefined') return client;

  let inFlight = null;

  const touch = async ({ force = false } = {}) => {
    if (!force && !canTouchNow()) return;
    if (document.visibilityState === 'hidden') return;
    if (inFlight) return inFlight;

    inFlight = client.auth.getSession()
      .then(async ({ data }) => {
        if (!data?.session?.user?.id) return;
        const { data: result, error } = await client.rpc('touch_my_radar_presence');
        if (error) throw error;
        if (result?.success === false) throw new Error(result?.error || 'Radar heartbeat rejected');
        markTouched();
      })
      .catch((error) => {
        console.warn('[radar-heartbeat] Could not refresh radar presence', error?.message || error);
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void touch();
  };

  const onOnline = () => void touch();

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', onOnline);

  client.auth.onAuthStateChange((event, session) => {
    if (session?.user?.id && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
      void touch({ force: event === 'SIGNED_IN' });
    }
  });

  queueMicrotask(() => void touch());
  return client;
};
