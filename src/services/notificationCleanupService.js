import { supabase } from '@/lib/supabase.js';

export const clearMyReadNotifications = async () => {
  const { data, error } = await supabase.rpc('sw_clear_my_read_notifications');
  if (error) throw error;
  return Number(data || 0);
};
