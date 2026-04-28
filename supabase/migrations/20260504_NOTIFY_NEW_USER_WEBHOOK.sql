-- 1. Crear el trigger para notificar al administrador sobre nuevos usuarios
-- Este trigger se activa cuando se crea un nuevo perfil en la tabla 'profiles'.

-- Asegurarnos de que la función de la Edge Function esté bien definida como un Webhook
CREATE OR REPLACE FUNCTION public.handle_new_user_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Llamada a la Edge Function notify-admin-new-user
  -- Supabase enviará el 'record' (los datos del nuevo perfil) automáticamente
  PERFORM
    net.http_post(
      url := 'https://wmkhutsesgtkcgqbctef.supabase.co/functions/v1/notify-admin-new-user',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('request.headers')::jsonb->>'authorization'
      ),
      body := jsonb_build_object('record', row_to_json(NEW))
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Crear el trigger
DROP TRIGGER IF EXISTS on_auth_user_created_notification ON public.profiles;
CREATE TRIGGER on_auth_user_created_notification
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_notification();

-- Nota: Requiere que la extensión 'pg_net' esté habilitada en Supabase (suele estarlo por defecto en proyectos nuevos)
CREATE EXTENSION IF NOT EXISTS pg_net;
