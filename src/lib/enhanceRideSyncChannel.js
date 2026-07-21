const RIDE_CHANNEL_PREFIX = 'ride_updates_';
const RESYNC_DEBOUNCE_MS = 750;

const canUseBrowserEvents = () =>
  typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * Adds a lightweight recovery layer to the existing ride realtime channel.
 *
 * Supabase realtime remains the primary source. The captured ride refresh
 * callback is also invoked after a reconnect, when the app regains focus,
 * when the document becomes visible again, or when connectivity returns.
 * This covers missed booking/passenger events without polling continuously.
 */
export const enhanceRideSyncChannel = (channel, topic) => {
  if (!channel || !String(topic || '').startsWith(RIDE_CHANNEL_PREFIX)) {
    return channel;
  }

  const originalOn = channel.on.bind(channel);
  const originalSubscribe = channel.subscribe.bind(channel);
  const originalUnsubscribe = channel.unsubscribe.bind(channel);

  let refreshRide = null;
  let lastRefreshAt = 0;
  let listenersAttached = false;

  const requestRefresh = () => {
    if (typeof refreshRide !== 'function') return;

    const now = Date.now();
    if (now - lastRefreshAt < RESYNC_DEBOUNCE_MS) return;
    lastRefreshAt = now;

    Promise.resolve()
      .then(() => refreshRide({ source: 'ride_resync_fallback' }))
      .catch((error) => {
        console.warn('Ride resync fallback failed:', error?.message || error);
      });
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') requestRefresh();
  };

  const attachListeners = () => {
    if (!canUseBrowserEvents() || listenersAttached) return;
    listenersAttached = true;
    window.addEventListener('focus', requestRefresh);
    window.addEventListener('online', requestRefresh);
    document.addEventListener('visibilitychange', handleVisibility);
  };

  const detachListeners = () => {
    if (!canUseBrowserEvents() || !listenersAttached) return;
    listenersAttached = false;
    window.removeEventListener('focus', requestRefresh);
    window.removeEventListener('online', requestRefresh);
    document.removeEventListener('visibilitychange', handleVisibility);
  };

  channel.on = (type, filter, callback) => {
    if (
      type === 'postgres_changes' &&
      filter?.schema === 'public' &&
      filter?.table === 'rides' &&
      typeof callback === 'function'
    ) {
      refreshRide = callback;
    }

    originalOn(type, filter, callback);
    return channel;
  };

  channel.subscribe = (statusCallback, timeout) => {
    attachListeners();

    return originalSubscribe((status, error) => {
      if (status === 'SUBSCRIBED') requestRefresh();
      if (typeof statusCallback === 'function') statusCallback(status, error);
    }, timeout);
  };

  channel.unsubscribe = async (...args) => {
    detachListeners();
    refreshRide = null;
    return originalUnsubscribe(...args);
  };

  return channel;
};

export const installRideSyncRecovery = (client) => {
  if (!client?.channel || client.__rideSyncRecoveryInstalled) return client;

  const originalChannel = client.channel.bind(client);
  client.channel = (topic, options) =>
    enhanceRideSyncChannel(originalChannel(topic, options), topic);

  Object.defineProperty(client, '__rideSyncRecoveryInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return client;
};
