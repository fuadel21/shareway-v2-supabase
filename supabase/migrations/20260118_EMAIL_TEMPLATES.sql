-- ========================================================
-- EMAIL TEMPLATES Y AUTOMATIZACIÓN
-- Templates predefinidos y sistema de recordatorios automáticos
-- ========================================================

-- 1. Insertar templates de email por defecto
INSERT INTO public.email_templates (name, subject, html_content, text_content, variables) VALUES
('default_notification', 
 'Notificación de Shareway',
 '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shareway</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;"><h1 style="margin: 0; font-size: 24px;">🚗 Shareway</h1></div><div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;"><h2 style="color: #1f2937; margin-top: 0;">{{title}}</h2><p style="color: #6b7280; line-height: 1.6;">{{body}}</p>{{#if data.ride_id}}<div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;"><p style="margin: 0; color: #374151;"><strong>ID del Viaje:</strong> {{data.ride_id}}</p></div>{{/if}}<div style="text-align: center; margin-top: 30px;"><a href="{{data.action_url}}" style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Ver en Shareway</a></div></div><div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;"><p>© 2024 Shareway. Todos los derechos reservados.</p><p>Si no quieres recibir estos emails, <a href="{{data.unsubscribe_url}}" style="color: #9ca3af;">desuscríbete aquí</a>.</p></div></body></html>',
 'Shareway - {{title}}\n\n{{body}}\n\n{{#if data.ride_id}}ID del Viaje: {{data.ride_id}}{{/if}}\n\nVisita Shareway: {{data.action_url}}',
 '{"title", "body", "data.ride_id", "data.action_url", "data.unsubscribe_url"}'),

('ride_request_received',
 'Nueva solicitud de plaza',
 '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nueva Solicitud - Shareway</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: #3b82f6; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;"><h1 style="margin: 0; font-size: 24px;">🎯 Nueva Solicitud</h1></div><div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;"><h2 style="color: #1f2937; margin-top: 0;">Tienes una nueva solicitud de plaza</h2><p style="color: #6b7280; line-height: 1.6;">{{data.requester_name}} quiere unirse a tu viaje desde {{data.origin}} hasta {{data.destination}}.</p><div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;"><p style="margin: 0; color: #374151;"><strong>📍 Ruta:</strong> {{data.origin}} → {{data.destination}}</p><p style="margin: 10px 0; color: #374151;"><strong>🕐 Hora:</strong> {{data.departure_time}}</p><p style="margin: 10px 0; color: #374151;"><strong>💰 Precio:</strong> €{{data.suggested_price}}</p><p style="margin: 10px 0; color: #374151;"><strong>👥 Plazas:</strong> {{data.seats_needed}}</p></div><div style="text-align: center; margin-top: 30px;"><a href="{{data.action_url}}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Ver Solicitud</a></div></div></body></html>',
 'Tienes una nueva solicitud de plaza\n\n{{data.requester_name}} quiere unirse a tu viaje:\n\nRuta: {{data.origin}} → {{data.destination}}\nHora: {{data.departure_time}}\nPrecio: €{{data.suggested_price}}\nPlazas: {{data.seats_needed}}\n\nVer solicitud: {{data.action_url}}',
 '{"data.requester_name", "data.origin", "data.destination", "data.departure_time", "data.suggested_price", "data.seats_needed", "data.action_url"}'),

('ride_accepted',
 '¡Tu solicitud fue aceptada!',
 '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Solicitud Aceptada - Shareway</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;"><h1 style="margin: 0; font-size: 24px;">✅ Solicitud Aceptada</h1></div><div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;"><h2 style="color: #1f2937; margin-top: 0;">¡Buenas noticias! {{data.driver_name}} aceptó tu solicitud</h2><p style="color: #6b7280; line-height: 1.6;">Tu plaza está confirmada para el viaje desde {{data.origin}} hasta {{data.destination}}.</p><div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;"><p style="margin: 0; color: #92400e;"><strong>🔐 Tu PIN de verificación:</strong> <span style="font-size: 24px; font-weight: bold; color: #dc2626;">{{data.pin}}</span></p><p style="margin: 10px 0 0 0; color: #92400e; font-size: 14px;">Guarda este PIN. Lo necesitarás para verificar tu identidad al subirte al coche.</p></div><div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;"><p style="margin: 0; color: #374151;"><strong>🕐 Hora:</strong> {{data.departure_time}}</p><p style="margin: 10px 0; color: #374151;"><strong>📍 Punto de encuentro:</strong> {{data.pickup_point}}</p><p style="margin: 10px 0; color: #374151;"><strong>💰 Precio:</strong> €{{data.price}}</p></div><div style="text-align: center; margin-top: 30px;"><a href="{{data.action_url}}" style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Ver Detalles</a></div></div></body></html>',
 '¡Tu solicitud fue aceptada!\n\n{{data.driver_name}} aceptó tu solicitud para el viaje:\n\nRuta: {{data.origin}} → {{data.destination}}\nHora: {{data.departure_time}}\nPunto de encuentro: {{data.pickup_point}}\nPrecio: €{{data.price}}\n\n🔐 TU PIN DE VERIFICACIÓN: {{data.pin}}\n\nGuarda este PIN. Lo necesitarás para verificar tu identidad.\n\nVer detalles: {{data.action_url}}',
 '{"data.driver_name", "data.origin", "data.destination", "data.departure_time", "data.pickup_point", "data.price", "data.pin", "data.action_url"}'),

('trip_reminder',
 'Recordatorio de tu viaje',
 '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recordatorio - Shareway</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: #f59e0b; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;"><h1 style="margin: 0; font-size: 24px;">⏰ Recordatorio</h1></div><div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;"><h2 style="color: #1f2937; margin-top: 0;">Tu viaje está por comenzar</h2><p style="color: #6b7280; line-height: 1.6;">Tu viaje desde {{data.origin}} hasta {{data.destination}} comienza en {{data.time_until}}.</p><div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;"><p style="margin: 0; color: #374151;"><strong>🕐 Hora:</strong> {{data.departure_time}}</p><p style="margin: 10px 0; color: #374151;"><strong>📍 Punto de encuentro:</strong> {{data.pickup_point}}</p>{{#if data.driver_name}}<p style="margin: 10px 0; color: #374151;"><strong>👨‍✈️ Conductor:</strong> {{data.driver_name}}</p>{{/if}}{{#if data.passengers}}<p style="margin: 10px 0; color: #374151;"><strong>👥 Pasajeros:</strong> {{data.passengers}}</p>{{/if}}</div><div style="background: #dbeafe; padding: 20px; border-radius: 8px; margin: 20px 0;"><p style="margin: 0; color: #1e40af;"><strong>💡 Consejos:</strong></p><ul style="margin: 10px 0; color: #1e40af; padding-left: 20px;"><li>Llega 5 minutos antes</li><li>Ten listo tu PIN de verificación</li><li>Verifica el punto de encuentro</li></ul></div><div style="text-align: center; margin-top: 30px;"><a href="{{data.action_url}}" style="background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Ver Viaje</a></div></div></body></html>',
 'Recordatorio de tu viaje\n\nTu viaje comienza en {{data.time_until}}:\n\nRuta: {{data.origin}} → {{data.destination}}\nHora: {{data.departure_time}}\nPunto de encuentro: {{data.pickup_point}}{{#if data.driver_name}}\nConductor: {{data.driver_name}}{{/if}}{{#if data.passengers}}\nPasajeros: {{data.passengers}}{{/if}}\n\n💡 Consejos:\n- Llega 5 minutos antes\n- Ten listo tu PIN de verificación\n- Verifica el punto de encuentro\n\nVer viaje: {{data.action_url}}',
 '{"data.origin", "data.destination", "data.time_until", "data.departure_time", "data.pickup_point", "data.driver_name", "data.passengers", "data.action_url"}'),

('payment_required',
 'Pago requerido para confirmar plaza',
 '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pago Requerido - Shareway</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: #ef4444; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;"><h1 style="margin: 0; font-size: 24px;">💳 Pago Requerido</h1></div><div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;"><h2 style="color: #1f2937; margin-top: 0;">Confirma tu plaza con el pago</h2><p style="color: #6b7280; line-height: 1.6;">Para confirmar tu plaza en el viaje desde {{data.origin}} hasta {{data.destination}}, necesitas realizar el pago de €{{data.amount}}.</p><div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ef4444;"><p style="margin: 0; color: #991b1b;"><strong>⏰ Tiempo límite:</strong> {{data.expires_in}}</p><p style="margin: 10px 0 0 0; color: #991b1b; font-size: 14px;">Si no pagas a tiempo, tu solicitud será cancelada automáticamente.</p></div><div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;"><p style="margin: 0; color: #374151;"><strong>💰 Monto a pagar:</strong> €{{data.amount}}</p><p style="margin: 10px 0; color: #374151;"><strong>🎯 Viaje:</strong> {{data.origin}} → {{data.destination}}</p><p style="margin: 10px 0; color: #374151;"><strong>🕐 Hora:</strong> {{data.departure_time}}</p></div><div style="text-align: center; margin-top: 30px;"><a href="{{data.action_url}}" style="background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Pagar Ahora</a></div></div></body></html>',
 'Pago requerido para confirmar plaza\n\nPara confirmar tu plaza, necesitas pagar €{{data.amount}}.\n\nViaje: {{data.origin}} → {{data.destination}}\nHora: {{data.departure_time}}\n\n⏰ Tiempo límite: {{data.expires_in}}\nSi no pagas a tiempo, tu solicitud será cancelada.\n\nPagar ahora: {{data.action_url}}',
 '{"data.origin", "data.destination", "data.amount", "data.expires_in", "data.departure_time", "data.action_url"}'),

('review_reminder',
 'Valora tu experiencia',
 '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Valora tu Viaje - Shareway</title></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: #8b5cf6; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;"><h1 style="margin: 0; font-size: 24px;">⭐ Valora tu Experiencia</h1></div><div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;"><h2 style="color: #1f2937; margin-top: 0;">¿Cómo fue tu viaje con {{data.other_user_name}}?</h2><p style="color: #6b7280; line-height: 1.6;">Tu feedback ayuda a mejorar la comunidad de Shareway. ¡Tus valoraciones son importantes!</p><div style="background: #ede9fe; padding: 20px; border-radius: 8px; margin: 20px 0;"><p style="margin: 0; color: #5b21b6;"><strong>🎁 Recompensa:</strong> Por valorar, ganarás 10 EcoPoints</p></div><div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;"><p style="margin: 0; color: #374151;"><strong>🛣️ Viaje:</strong> {{data.origin}} → {{data.destination}}</p><p style="margin: 10px 0; color: #374151;"><strong>📅 Fecha:</strong> {{data.trip_date}}</p></div><div style="text-align: center; margin-top: 30px;"><a href="{{data.action_url}}" style="background: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Valorar Ahora</a></div></div></body></html>',
 'Valora tu experiencia\n\n¿Cómo fue tu viaje con {{data.other_user_name}}?\n\nTu feedback ayuda a mejorar la comunidad de Shareway.\n\n🎁 Recompensa: 10 EcoPoints por valorar\n\nViaje: {{data.origin}} → {{data.destination}}\nFecha: {{data.trip_date}}\n\nValorar ahora: {{data.action_url}}',
 '{"data.other_user_name", "data.origin", "data.destination", "data.trip_date", "data.action_url"}')

ON CONFLICT (name) DO NOTHING;

-- 2. Función para crear recordatorios automáticos
CREATE OR REPLACE FUNCTION public.create_trip_reminders()
RETURNS INTEGER AS $$
DECLARE
    v_reminders_created INTEGER := 0;
    v_ride RECORD;
    v_notification_id UUID;
BEGIN
    -- Crear recordatorios para viajes en las próximas 24 horas
    
    -- Recordatorio de 24 horas
    FOR v_ride IN
        SELECT 
            r.id,
            r.driver_id,
            r.departure_time,
            r.origin->>'name' as origin_name,
            r.destination->>'name' as destination_name,
            p.display_name as driver_name
        FROM public.rides r
        JOIN public.profiles p ON p.id = r.driver_id
        WHERE r.status = 'scheduled'
            AND r.departure_time BETWEEN NOW() + INTERVAL '23 hours' AND NOW() + INTERVAL '25 hours'
            AND NOT EXISTS (
                SELECT 1 FROM public.notifications n
                WHERE n.user_id = r.driver_id
                    AND n.data->>'ride_id' = r.id::TEXT
                    AND n.type = 'trip_reminder'
                    AND n.data->>'reminder_type' = '24_hours'
            )
    LOOP
        -- Notificación para conductor
        v_notification_id := public.create_notification(
            v_ride.driver_id,
            'trip_reminder',
            'Recordatorio de tu viaje',
            'Tu viaje de mañana a las ' || TO_CHAR(v_ride.departure_time, 'HH24:MI') || ' está confirmado.',
            json_build_object(
                'ride_id', v_ride.id,
                'origin', v_ride.origin_name,
                'destination', v_ride.destination_name,
                'departure_time', v_ride.departure_time,
                'reminder_type', '24_hours',
                'time_until', 'mañana',
                'action_url', '/rides/' || v_ride.id
            ),
            'normal',
            'ride'
        );
        
        -- Notificaciones para pasajeros
        INSERT INTO public.notifications (user_id, type, title, body, data, priority, category)
        SELECT 
            (p->>'id')::UUID,
            'trip_reminder',
            'Recordatorio de tu viaje',
            'Tu viaje de mañana a las ' || TO_CHAR(v_ride.departure_time, 'HH24:MI') || ' está confirmado.',
            json_build_object(
                'ride_id', v_ride.id,
                'origin', v_ride.origin_name,
                'destination', v_ride.destination_name,
                'departure_time', v_ride.departure_time,
                'driver_name', v_ride.driver_name,
                'reminder_type', '24_hours',
                'time_until', 'mañana',
                'action_url', '/rides/' || v_ride.id
            ),
            'normal',
            'ride'
        FROM public.rides r,
            jsonb_array_elements(r.passengers) p
        WHERE r.id = v_ride.id
            AND NOT EXISTS (
                SELECT 1 FROM public.notifications n
                WHERE n.user_id = (p->>'id')::UUID
                    AND n.data->>'ride_id' = r.id::TEXT
                    AND n.type = 'trip_reminder'
                    AND n.data->>'reminder_type' = '24_hours'
            );
        
        v_reminders_created := v_reminders_created + 1;
    END LOOP;
    
    -- Recordatorio de 2 horas
    FOR v_ride IN
        SELECT 
            r.id,
            r.driver_id,
            r.departure_time,
            r.origin->>'name' as origin_name,
            r.destination->>'name' as destination_name,
            p.display_name as driver_name
        FROM public.rides r
        JOIN public.profiles p ON p.id = r.driver_id
        WHERE r.status = 'scheduled'
            AND r.departure_time BETWEEN NOW() + INTERVAL '1 hour 50 minutes' AND NOW() + INTERVAL '2 hours 10 minutes'
            AND NOT EXISTS (
                SELECT 1 FROM public.notifications n
                WHERE n.user_id = r.driver_id
                    AND n.data->>'ride_id' = r.id::TEXT
                    AND n.type = 'trip_reminder'
                    AND n.data->>'reminder_type' = '2_hours'
            )
    LOOP
        -- Notificación urgente para conductor
        v_notification_id := public.create_notification(
            v_ride.driver_id,
            'trip_reminder',
            '¡Tu viaje comienza en 2 horas!',
            'Prepárate para tu viaje a las ' || TO_CHAR(v_ride.departure_time, 'HH24:MI') || '.',
            json_build_object(
                'ride_id', v_ride.id,
                'origin', v_ride.origin_name,
                'destination', v_ride.destination_name,
                'departure_time', v_ride.departure_time,
                'reminder_type', '2_hours',
                'time_until', '2 horas',
                'action_url', '/rides/' || v_ride.id
            ),
            'high',
            'ride'
        );
        
        -- Notificaciones para pasajeros
        INSERT INTO public.notifications (user_id, type, title, body, data, priority, category)
        SELECT 
            (p->>'id')::UUID,
            'trip_reminder',
            '¡Tu viaje comienza en 2 horas!',
            'Prepárate para tu viaje a las ' || TO_CHAR(v_ride.departure_time, 'HH24:MI') || '.',
            json_build_object(
                'ride_id', v_ride.id,
                'origin', v_ride.origin_name,
                'destination', v_ride.destination_name,
                'departure_time', v_ride.departure_time,
                'driver_name', v_ride.driver_name,
                'reminder_type', '2_hours',
                'time_until', '2 horas',
                'action_url', '/rides/' || v_ride.id
            ),
            'high',
            'ride'
        FROM public.rides r,
            jsonb_array_elements(r.passengers) p
        WHERE r.id = v_ride.id
            AND NOT EXISTS (
                SELECT 1 FROM public.notifications n
                WHERE n.user_id = (p->>'id')::UUID
                    AND n.data->>'ride_id' = r.id::TEXT
                    AND n.type = 'trip_reminder'
                    AND n.data->>'reminder_type' = '2_hours'
            );
        
        v_reminders_created := v_reminders_created + 1;
    END LOOP;
    
    -- Recordatorio de 15 minutos
    FOR v_ride IN
        SELECT 
            r.id,
            r.driver_id,
            r.departure_time,
            r.origin->>'name' as origin_name,
            r.destination->>'name' as destination_name,
            p.display_name as driver_name
        FROM public.rides r
        JOIN public.profiles p ON p.id = r.driver_id
        WHERE r.status = 'scheduled'
            AND r.departure_time BETWEEN NOW() + INTERVAL '14 minutes' AND NOW() + INTERVAL '16 minutes'
            AND NOT EXISTS (
                SELECT 1 FROM public.notifications n
                WHERE n.user_id = r.driver_id
                    AND n.data->>'ride_id' = r.id::TEXT
                    AND n.type = 'trip_reminder'
                    AND n.data->>'reminder_type' = '15_minutes'
            )
    LOOP
        -- Notificación urgente para conductor
        v_notification_id := public.create_notification(
            v_ride.driver_id,
            'trip_reminder',
            '¡Tu viaje comienza en 15 minutos!',
            'Es hora de ir al punto de encuentro. Tu viaje a las ' || TO_CHAR(v_ride.departure_time, 'HH24:MI') || ' está por comenzar.',
            json_build_object(
                'ride_id', v_ride.id,
                'origin', v_ride.origin_name,
                'destination', v_ride.destination_name,
                'departure_time', v_ride.departure_time,
                'reminder_type', '15_minutes',
                'time_until', '15 minutos',
                'action_url', '/rides/' || v_ride.id
            ),
            'urgent',
            'ride'
        );
        
        -- Notificaciones para pasajeros
        INSERT INTO public.notifications (user_id, type, title, body, data, priority, category)
        SELECT 
            (p->>'id')::UUID,
            'trip_reminder',
            '¡Tu viaje comienza en 15 minutos!',
            'Es hora de ir al punto de encuentro. Tu viaje a las ' || TO_CHAR(v_ride.departure_time, 'HH24:MI') || ' está por comenzar.',
            json_build_object(
                'ride_id', v_ride.id,
                'origin', v_ride.origin_name,
                'destination', v_ride.destination_name,
                'departure_time', v_ride.departure_time,
                'driver_name', v_ride.driver_name,
                'reminder_type', '15_minutes',
                'time_until', '15 minutos',
                'action_url', '/rides/' || v_ride.id
            ),
            'urgent',
            'ride'
        FROM public.rides r,
            jsonb_array_elements(r.passengers) p
        WHERE r.id = v_ride.id
            AND NOT EXISTS (
                SELECT 1 FROM public.notifications n
                WHERE n.user_id = (p->>'id')::UUID
                    AND n.data->>'ride_id' = r.id::TEXT
                    AND n.type = 'trip_reminder'
                    AND n.data->>'reminder_type' = '15_minutes'
            );
        
        v_reminders_created := v_reminders_created + 1;
    END LOOP;
    
    RETURN v_reminders_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Función para crear recordatorios de valoración
CREATE OR REPLACE FUNCTION public.create_review_reminders()
RETURNS INTEGER AS $$
DECLARE
    v_reminders_created INTEGER := 0;
    v_participant RECORD;
    v_notification_id UUID;
BEGIN
    -- Recordatorios para valorar viajes completados hace 24 horas
    FOR v_participant IN
        SELECT 
            r.id as ride_id,
            r.driver_id,
            (p->>'id')::UUID as passenger_id,
            r.departure_time,
            r.origin->>'name' as origin_name,
            r.destination->>'name' as destination_name,
            pd.display_name as driver_name,
            pp.display_name as passenger_name
        FROM public.rides r,
            jsonb_array_elements(r.passengers) p
        JOIN public.profiles pd ON pd.id = r.driver_id
        JOIN public.profiles pp ON pp.id = (p->>'id')::UUID
        WHERE r.status = 'completed'
            AND r.completed_at BETWEEN NOW() - INTERVAL '25 hours' AND NOW() - INTERVAL '23 hours'
            AND NOT EXISTS (
                SELECT 1 FROM public.reviews rev
                WHERE rev.ride_id = r.id
                    AND rev.reviewer_id = r.driver_id
                    AND rev.reviewee_id = (p->>'id')::UUID
            )
            AND NOT EXISTS (
                SELECT 1 FROM public.notifications n
                WHERE n.user_id = r.driver_id
                    AND n.data->>'ride_id' = r.id::TEXT
                    AND n.type = 'review_reminder'
            )
    LOOP
        -- Recordatorio para conductor valorando al pasajero
        v_notification_id := public.create_notification(
            v_participant.driver_id,
            'review_reminder',
            'Valora a ' || v_participant.passenger_name,
            '¿Cómo fue tu experiencia con ' || v_participant.passenger_name || ' en el viaje de ayer?',
            json_build_object(
                'ride_id', v_participant.ride_id,
                'other_user_id', v_participant.passenger_id,
                'other_user_name', v_participant.passenger_name,
                'origin', v_participant.origin_name,
                'destination', v_participant.destination_name,
                'trip_date', TO_CHAR(v_participant.departure_time, 'DD/MM/YYYY'),
                'action_url', '/review/' || v_participant.ride_id || '/' || v_participant.passenger_id
            ),
            'normal',
            'social'
        );
        
        -- Recordatorio para pasajero valorando al conductor
        v_notification_id := public.create_notification(
            v_participant.passenger_id,
            'review_reminder',
            'Valora a ' || v_participant.driver_name,
            '¿Cómo fue tu experiencia con ' || v_participant.driver_name || ' en el viaje de ayer?',
            json_build_object(
                'ride_id', v_participant.ride_id,
                'other_user_id', v_participant.driver_id,
                'other_user_name', v_participant.driver_name,
                'origin', v_participant.origin_name,
                'destination', v_participant.destination_name,
                'trip_date', TO_CHAR(v_participant.departure_time, 'DD/MM/YYYY'),
                'action_url', '/review/' || v_participant.ride_id || '/' || v_participant.driver_id
            ),
            'normal',
            'social'
        );
        
        v_reminders_created := v_reminders_created + 2;
    END LOOP;
    
    RETURN v_reminders_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Job programado para ejecutar recordatorios
CREATE OR REPLACE FUNCTION public.run_notification_jobs()
RETURNS JSON AS $$
DECLARE
    v_trip_reminders INTEGER;
    v_review_reminders INTEGER;
    v_cleaned_notifications INTEGER;
BEGIN
    -- Ejecutar recordatorios de viajes
    v_trip_reminders := public.create_trip_reminders();
    
    -- Ejecutar recordatorios de valoración
    v_review_reminders := public.create_review_reminders();
    
    -- Limpiar notificaciones antiguas
    v_cleaned_notifications := public.cleanup_old_notifications();
    
    RETURN json_build_object(
        'success', true,
        'trip_reminders_created', v_trip_reminders,
        'review_reminders_created', v_review_reminders,
        'notifications_cleaned', v_cleaned_notifications,
        'executed_at', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentarios para auditoría
COMMENT ON FUNCTION public.create_trip_reminders IS 'Crea recordatorios automáticos para viajes próximos';
COMMENT ON FUNCTION public.create_review_reminders IS 'Crea recordatorios para valorar viajes completados';
COMMENT ON FUNCTION public.run_notification_jobs IS 'Ejecuta todos los jobs de notificaciones';
