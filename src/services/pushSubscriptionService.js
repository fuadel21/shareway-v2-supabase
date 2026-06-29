import { supabase } from '@/lib/supabase.js';

const normalizePublicKey = (value = '') => String(value)
  .trim()
  .replace(/^['"]|['"]$/g, '')
  .replace(/\s/g, '');

const urlBase64ToUint8Array = (base64String) => {
  const cleanKey = normalizePublicKey(base64String);
  const padding = '='.repeat((4 - cleanKey.length % 4) % 4);
  const base64 = `${cleanKey}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));

  if (output.length !== 65) {
    throw new Error('La clave pública VAPID no es válida. Revisa VITE_VAPID_PUBLIC_KEY en Vercel.');
  }

  return output;
};

export const isPushSupported = () => (
  typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window
);

export const getPushPermission = () => {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
};

export const registerPushSubscription = async (userId) => {
  if (!userId) throw new Error('Usuario no disponible.');
  if (!isPushSupported()) throw new Error('Este navegador no soporta notificaciones push.');

  const publicKey = normalizePublicKey(import.meta.env.VITE_VAPID_PUBLIC_KEY);
  if (!publicKey) throw new Error('Falta VITE_VAPID_PUBLIC_KEY en Vercel.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permiso de notificaciones no concedido.');

  const registration = await navigator.serviceWorker.register('/shareway-push-sw.js');
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) throw new Error('La suscripción push no es válida.');

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });

  if (error) throw error;
  return subscription;
};

export const deactivatePushSubscription = async (userId) => {
  if (!userId) return;

  if (isPushSupported()) {
    const registration = await navigator.serviceWorker.getRegistration('/shareway-push-sw.js');
    const subscription = await registration?.pushManager?.getSubscription?.();
    if (subscription) {
      await subscription.unsubscribe();
    }
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) throw error;
};
