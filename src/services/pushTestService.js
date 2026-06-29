import { supabase } from '@/lib/supabase.js';

export const sendTestPush = async () => {
  const { data, error } = await supabase.functions.invoke('send-push', {
    body: {
      title: 'ShareWay',
      message: 'Push activada correctamente en este dispositivo.',
      url: '/notifications',
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
};
