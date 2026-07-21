import { afterEach, describe, expect, it, vi } from 'vitest';
import { enhanceRideSyncChannel, installRideSyncRecovery } from './enhanceRideSyncChannel.js';

const createFakeChannel = () => {
  const channel = {
    handlers: [],
    statusCallback: null,
    on: vi.fn(function on(type, filter, callback) {
      this.handlers.push({ type, filter, callback });
      return this;
    }),
    subscribe: vi.fn(function subscribe(callback) {
      this.statusCallback = callback;
      return this;
    }),
    unsubscribe: vi.fn(async () => 'ok'),
  };
  return channel;
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('ride sync recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves unrelated realtime channels untouched', () => {
    const channel = createFakeChannel();
    expect(enhanceRideSyncChannel(channel, 'chat_updates_123')).toBe(channel);
    expect(channel.on).not.toHaveBeenCalled();
  });

  it('refreshes the secure ride snapshot after realtime reconnects', async () => {
    const channel = enhanceRideSyncChannel(createFakeChannel(), 'ride_updates_123');
    const refresh = vi.fn();

    channel
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: 'id=eq.123',
      }, refresh)
      .subscribe();

    channel.statusCallback('SUBSCRIBED');
    await flush();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ source: 'ride_resync_fallback' });
  });

  it('refreshes when the app returns online', async () => {
    const channel = enhanceRideSyncChannel(createFakeChannel(), 'ride_updates_123');
    const refresh = vi.fn();

    channel.on('postgres_changes', {
      schema: 'public',
      table: 'rides',
    }, refresh).subscribe();

    await new Promise((resolve) => setTimeout(resolve, 800));
    window.dispatchEvent(new Event('online'));
    await flush();

    expect(refresh).toHaveBeenCalledTimes(1);
    await channel.unsubscribe();
  });

  it('removes browser listeners when the channel closes', async () => {
    const channel = enhanceRideSyncChannel(createFakeChannel(), 'ride_updates_123');
    const refresh = vi.fn();

    channel.on('postgres_changes', {
      schema: 'public',
      table: 'rides',
    }, refresh).subscribe();

    await channel.unsubscribe();
    window.dispatchEvent(new Event('online'));
    await flush();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('installs only once on the Supabase client', () => {
    const client = {
      channel: vi.fn(() => createFakeChannel()),
    };

    const first = installRideSyncRecovery(client);
    const wrappedChannel = first.channel;
    const second = installRideSyncRecovery(client);

    expect(second).toBe(first);
    expect(second.channel).toBe(wrappedChannel);
  });
});
