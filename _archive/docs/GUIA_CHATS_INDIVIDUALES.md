# 🚀 Sistema de Chats Individuales - Guía de Implementación

## 📋 Resumen
Se ha implementado un sistema completo de chats individuales donde:
- **Conductores** pueden chatear individualmente con cada pasajero
- **Pasajeros** pueden chatear con el conductor
- Se mantiene el **chat grupal** para todos los participantes
- Los chats se crean **automáticamente** al confirmar una reserva

---

## 🗄️ PASO 1: Ejecutar SQL en Supabase

Abre el **SQL Editor** en Supabase Dashboard y ejecuta este script:

```sql
-- ==========================================
-- SISTEMA DE CHATS INDIVIDUALES
-- ==========================================

-- 1. Agregar campo para tipo de chat
ALTER TABLE public.chats 
ADD COLUMN IF NOT EXISTS chat_type TEXT DEFAULT 'group' 
CHECK (chat_type IN ('group', 'individual'));

-- 2. Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_chats_ride_type 
  ON public.chats(ride_id, chat_type);
CREATE INDEX IF NOT EXISTS idx_chats_participants 
  ON public.chats USING GIN(participants);

-- 3. Función para crear chat individual
CREATE OR REPLACE FUNCTION public.create_individual_chat(
    p_ride_id UUID,
    p_driver_id UUID,
    p_passenger_id UUID
) RETURNS UUID AS $$
DECLARE
    v_chat_id UUID;
    v_driver_name TEXT;
    v_passenger_name TEXT;
BEGIN
    SELECT display_name INTO v_driver_name 
    FROM public.profiles WHERE id = p_driver_id;
    
    SELECT display_name INTO v_passenger_name 
    FROM public.profiles WHERE id = p_passenger_id;
    
    -- Verificar si ya existe
    SELECT id INTO v_chat_id
    FROM public.chats
    WHERE ride_id = p_ride_id
      AND chat_type = 'individual'
      AND participants @> ARRAY[p_driver_id, p_passenger_id]
      AND participants <@ ARRAY[p_driver_id, p_passenger_id];
    
    -- Crear si no existe
    IF v_chat_id IS NULL THEN
        INSERT INTO public.chats (
            ride_id,
            participants,
            participant_names,
            chat_type
        ) VALUES (
            p_ride_id,
            ARRAY[p_driver_id, p_passenger_id],
            jsonb_build_object(
                p_driver_id::TEXT, v_driver_name,
                p_passenger_id::TEXT, v_passenger_name
            ),
            'individual'
        ) RETURNING id INTO v_chat_id;
    END IF;
    
    RETURN v_chat_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Trigger para crear chats automáticamente
CREATE OR REPLACE FUNCTION public.create_chat_on_booking()
RETURNS TRIGGER AS $$
DECLARE
    v_driver_id UUID;
    v_passenger_id UUID;
    v_passenger JSONB;
BEGIN
    SELECT driver_id INTO v_driver_id 
    FROM public.rides WHERE id = NEW.id;
    
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(NEW.passengers)
    LOOP
        IF v_passenger->>'status' = 'confirmed' THEN
            v_passenger_id := (v_passenger->>'id')::UUID;
            PERFORM public.create_individual_chat(NEW.id, v_driver_id, v_passenger_id);
        END IF;
    END LOOP;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_booking_create_individual_chat ON public.rides;
CREATE TRIGGER on_booking_create_individual_chat
    AFTER INSERT OR UPDATE OF passengers ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION public.create_chat_on_booking();

-- 5. Función para obtener chats de un viaje
CREATE OR REPLACE FUNCTION public.get_ride_chats(p_ride_id UUID)
RETURNS TABLE (
    chat_id UUID,
    chat_type TEXT,
    participants UUID[],
    participant_names JSONB,
    last_message JSONB,
    unread_count BIGINT,
    updated_at TIMESTAMPTZ
) AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_is_driver BOOLEAN;
BEGIN
    SELECT driver_id = v_user_id INTO v_is_driver
    FROM public.rides WHERE id = p_ride_id;
    
    RETURN QUERY
    SELECT 
        c.id,
        c.chat_type,
        c.participants,
        c.participant_names,
        c.last_message,
        (SELECT COUNT(*) FROM public.messages m 
         WHERE m.chat_id = c.id 
           AND m.sender_id != v_user_id 
           AND m.created_at > COALESCE(
               (SELECT last_read_at FROM public.chat_reads 
                WHERE chat_id = c.id AND user_id = v_user_id), 
               '1970-01-01'::TIMESTAMPTZ
           )
        )::BIGINT as unread_count,
        c.updated_at
    FROM public.chats c
    WHERE c.ride_id = p_ride_id
      AND v_user_id = ANY(c.participants)
      AND (
          (v_is_driver AND c.chat_type IN ('individual', 'group'))
          OR
          (NOT v_is_driver AND (
              c.chat_type = 'group' 
              OR (c.chat_type = 'individual' AND v_user_id = ANY(c.participants))
          ))
      )
    ORDER BY c.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Tabla para tracking de mensajes leídos
CREATE TABLE IF NOT EXISTS public.chat_reads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(chat_id, user_id)
);

-- 7. Crear chats individuales para viajes existentes
DO $$
DECLARE
    v_ride RECORD;
    v_passenger JSONB;
BEGIN
    FOR v_ride IN 
        SELECT id, driver_id, passengers 
        FROM public.rides 
        WHERE status IN ('scheduled', 'active', 'in_progress')
    LOOP
        FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride.passengers)
        LOOP
            IF v_passenger->>'status' = 'confirmed' THEN
                PERFORM public.create_individual_chat(
                    v_ride.id, 
                    v_ride.driver_id, 
                    (v_passenger->>'id')::UUID
                );
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- ✅ COMPLETADO
SELECT 'Sistema de chats individuales instalado correctamente' as status;
```

---

## ✅ PASO 2: Verificar Archivos Frontend

Los siguientes archivos ya han sido creados/modificados:

### Archivos Nuevos:
- ✅ `src/components/RideChatSelector.jsx` - Selector de conversaciones

### Archivos Modificados:
- ✅ `src/App.jsx` - Rutas agregadas
- ✅ `src/components/RideChat.jsx` - Soporte para chatId
- ✅ `src/components/RideDetails.jsx` - Botón actualizado

---

## 🎯 Cómo Funciona

### Para el Conductor:
1. Entra a "Detalles del Viaje"
2. Click en "CONVERSACIONES"
3. Ve lista de chats:
   - 💬 Chat Grupal del Viaje
   - 👤 Chat con Pasajero 1
   - 👤 Chat con Pasajero 2
   - ...
4. Selecciona el chat deseado
5. Chatea normalmente

### Para el Pasajero:
1. Entra a "Detalles del Viaje"
2. Click en "CONVERSACIONES"
3. Ve:
   - 💬 Chat Grupal del Viaje
   - 👤 Chat con el Conductor
4. Selecciona el chat
5. Chatea normalmente

---

## 🧪 Pruebas

Después de aplicar el SQL, prueba:

1. **Crear un viaje nuevo** como conductor
2. **Reservar una plaza** como pasajero
3. **Verificar** que se creó el chat individual automáticamente:
   ```sql
   SELECT * FROM public.chats WHERE chat_type = 'individual';
   ```
4. **Entrar** a "Detalles del Viaje" y click en "CONVERSACIONES"
5. **Verificar** que aparecen todos los chats

---

## 🔧 Troubleshooting

### Si no aparecen los chats:
```sql
-- Ver todos los chats de un viaje
SELECT * FROM public.chats WHERE ride_id = 'TU_RIDE_ID';

-- Ver mensajes de un chat
SELECT * FROM public.messages WHERE chat_id = 'TU_CHAT_ID';
```

### Si el trigger no funciona:
```sql
-- Verificar que existe
SELECT * FROM pg_trigger WHERE tgname = 'on_booking_create_individual_chat';

-- Recrear manualmente chats
SELECT public.create_individual_chat(
    'ride_id'::UUID, 
    'driver_id'::UUID, 
    'passenger_id'::UUID
);
```

---

## 📊 Estructura de Datos

### Tabla `chats`:
```
id              UUID
ride_id         UUID
participants    UUID[]
participant_names JSONB
chat_type       TEXT ('group' | 'individual')  ← NUEVO
last_message    JSONB
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

### Tabla `chat_reads` (nueva):
```
id              UUID
chat_id         UUID
user_id         UUID
last_read_at    TIMESTAMPTZ
```

---

## ✅ Checklist Final

- [ ] SQL ejecutado en Supabase
- [ ] Verificar que `chat_type` existe en tabla `chats`
- [ ] Verificar que función `get_ride_chats` existe
- [ ] Verificar que trigger `on_booking_create_individual_chat` existe
- [ ] Recargar aplicación frontend
- [ ] Probar crear viaje y reservar
- [ ] Verificar que aparecen chats individuales
- [ ] Probar enviar mensajes

---

🎉 **¡Sistema de Chats Individuales Listo!**
