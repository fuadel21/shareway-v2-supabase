# 🚀 Guía de Migración de Firebase a Supabase

## ✅ Progreso Actual

### Fase 1: Configuración Inicial - **COMPLETADA**
- [x] Instalación de `@supabase/supabase-js`
- [x] Creación de archivo de configuración `src/lib/supabase.js`
- [x] Creación de `.env.example` con variables necesarias
- [x] Creación de `package.json` con dependencias

### Fase 2: Configuración de Base de Datos - **EN PROGRESO**
- [x] Schema SQL completo creado (`supabase/schema.sql`)
- [x] Funciones RPC creadas (`supabase/rpc_functions.sql`)
- [x] Helper para llamadas RPC (`src/lib/supabaseRPC.js`)
- [ ] Ejecutar scripts en Supabase
- [ ] Migrar datos existentes (si aplica)

---

## 📋 Pasos Siguientes

### 1. Crear Proyecto en Supabase

1. Ve a [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Crea una nueva organización (si no tienes una)
3. Crea un nuevo proyecto:
   - Nombre: `shareway-v2`
   - Contraseña de base de datos: (guárdala en un lugar seguro)
   - Región: Elige la más cercana a tus usuarios

4. Espera a que el proyecto se inicialice (1-2 minutos)

### 2. Configurar Variables de Entorno

1. En el dashboard de Supabase, ve a **Settings** > **API**
2. Copia los valores:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ NUNCA expongas esta clave en el frontend)

3. Crea/actualiza el archivo `.env` en la raíz del proyecto:

```env
# Supabase
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key

# Stripe (mantener las existentes)
VITE_STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_SECRET_KEY=sk_...

# Google Maps (si se mantiene)
VITE_GOOGLE_MAPS_API_KEY=...
```

### 3. Ejecutar Scripts SQL en Supabase

1. En el dashboard de Supabase, ve a **SQL Editor**

2. **Paso 1: Ejecuta el schema principal**
   - Crea un nuevo query
   - Copia y pega el contenido completo de `supabase/schema.sql`
   - Click en **Run** o presiona `Ctrl+Enter`
   - Verifica que todas las tablas se crearon correctamente en **Table Editor**

3. **Paso 2: Ejecuta las funciones RPC**
   - Crea otro nuevo query
   - Copia y pega el contenido de `supabase/rpc_functions.sql`
   - Click en **Run**
   - Ve a **Database** > **Functions** para verificar que se crearon

### 4. Configurar Autenticación en Supabase

1. Ve a **Authentication** > **Providers**
2. Habilita los proveedores que necesites:
   - **Email** (habilitado por defecto)
   - **Google** (si lo usabas en Firebase)
   - Otros proveedores OAuth si aplica

3. Para Google OAuth:
   - Ve a [Google Cloud Console](https://console.cloud.google.com/)
   - Usa el mismo proyecto o crea uno nuevo
   - Habilita Google+ API
   - Crea credenciales OAuth 2.0
   - Agrega la URL de callback de Supabase:
     `https://tu-proyecto.supabase.co/auth/v1/callback`
   - Copia Client ID y Client Secret a Supabase

### 5. Configurar Storage en Supabase

1. Ve a **Storage** en el dashboard
2. Crea los buckets necesarios:
   - `profile-photos` (para fotos de perfil)
   - `verification-documents` (para documentos de verificación)
   - `chat-media` (para media en chats)

3. Configura las políticas de acceso para cada bucket:

```sql
-- Bucket: profile-photos
-- Política de lectura pública
CREATE POLICY "Las fotos de perfil son públicas"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile-photos');

-- Política de subida (solo el dueño)
CREATE POLICY "Los usuarios pueden subir su foto de perfil"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'profile-photos' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Bucket: verification-documents
-- Solo accesible por el usuario y admins
CREATE POLICY "Los usuarios pueden ver sus documentos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'verification-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Los usuarios pueden subir documentos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'verification-documents' AND
  auth.uid()::text = (storage.foldername(name))[1]
);
```

### 6. Instalar Dependencias del Proyecto

```bash
pnpm install
```

### 7. Probar la Conexión

1. Crea un archivo de test: `src/test-supabase.js`

```javascript
import { supabase } from './lib/supabase';

export async function testSupabaseConnection() {
  try {
    const { data, error } = await supabase.from('profiles').select('count');
    
    if (error) {
      console.error('❌ Error conectando a Supabase:', error);
      return false;
    }
    
    console.log('✅ Conexión a Supabase exitosa!');
    console.log('📊 Datos:', data);
    return true;
  } catch (err) {
    console.error('❌ Error:', err);
    return false;
  }
}
```

2. Ejecuta el test en la consola del navegador después de iniciar el proyecto

---

## 🔄 Fase 3: Migración de Autenticación

### Archivos a Actualizar:

1. **`src/contexts/AuthContext.jsx`** (o similar)
   - Reemplazar `firebase/auth` con autenticación de Supabase
   - Usar `supabase.auth.signInWithPassword()`, `supabase.auth.signUp()`, etc.

2. **Componentes de Login/Register**
   - Actualizar llamadas a funciones de autenticación

### Ejemplo de Migración de AuthContext:

**ANTES (Firebase):**
```javascript
import { auth } from '../lib/firebase';
import { onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';

const login = async (email, password) => {
  return await signInWithEmailAndPassword(auth, email, password);
};
```

**DESPUÉS (Supabase):**
```javascript
import { supabase } from '../lib/supabase';

const login = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  
  if (error) throw error;
  return data;
};

// Listener de cambios en autenticación
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    setUser(session?.user ?? null);
  });

  return () => subscription.unsubscribe();
}, []);
```

---

## 🔄 Fase 4: Migración de Servicios

### Orden de Migración Recomendado:

1. ✅ **rideService.js** - Usar funciones RPC de `supabaseRPC.js`
2. ✅ **walletService.js** - Queries directas a tabla `wallets`
3. ✅ **requestService.js** - Usar RPC functions
4. ✅ **bookingService.js** - Usar RPC functions
5. ✅ **chatService.js** - Real-time con Supabase Realtime

### Ejemplo de Migración de Servicio:

**ANTES (Firebase):**
```javascript
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

export const createRide = async (rideData) => {
  const createRideFn = httpsCallable(functions, 'createRide');
  const result = await createRideFn(rideData);
  return result.data;
};
```

**DESPUÉS (Supabase):**
```javascript
import { createRide as createRideRPC } from '../lib/supabaseRPC';

export const createRide = async (rideData) => {
  return await createRideRPC(rideData);
};
```

---

## 📡 Fase 5: Migración de Real-time Features

### Chat en Tiempo Real

**ANTES (Firebase):**
```javascript
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';

const messagesRef = collection(db, 'chats', chatId, 'messages');
const q = query(messagesRef, orderBy('createdAt', 'asc'));

const unsubscribe = onSnapshot(q, (snapshot) => {
  const messages = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
  setMessages(messages);
});
```

**DESPUÉS (Supabase):**
```javascript
import { supabase } from '../lib/supabase';

// Cargar mensajes iniciales
const { data: messages } = await supabase
  .from('messages')
  .select('*')
  .eq('chat_id', chatId)
  .order('created_at', { ascending: true });

setMessages(messages);

// Suscribirse a nuevos mensajes
const subscription = supabase
  .channel(`chat_${chatId}`)
  .on('postgres_changes', 
    { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'messages',
      filter: `chat_id=eq.${chatId}`
    }, 
    (payload) => {
      setMessages(prev => [...prev, payload.new]);
    }
  )
  .subscribe();

// Limpiar suscripción
return () => {
  subscription.unsubscribe();
};
```

---

## 🗄️ Migración de Datos (Opcional)

Si tienes datos existentes en Firebase Firestore que quieres migrar:

### Opción 1: Migración Manual (Recomendada para proyectos pequeños)

1. Exporta los datos de Firebase usando el Admin SDK
2. Transforma el formato para PostgreSQL
3. Usa el SQL Editor de Supabase para insertar

### Opción 2: Script de Migración Automática

Crear un script Node.js que:
1. Lee datos de Firestore
2. Los transforma al formato de PostgreSQL
3. Los inserta en Supabase usando el cliente JS

**Ejemplo básico:**

```javascript
// migration-script.js
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

// Inicializar Firebase Admin
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

// Inicializar Supabase con service role key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrateUsers() {
  const usersSnapshot = await db.collection('users').get();
  
  for (const doc of usersSnapshot.docs) {
    const userData = doc.data();
    
    const { error } = await supabase
      .from('profiles')
      .insert({
        id: doc.id,
        display_name: userData.displayName,
        email: userData.email,
        // ... otros campos
      });
      
    if (error) console.error('Error:', error);
    else console.log('✅ Migrado:', doc.id);
  }
}

migrateUsers();
```

---

## 🧪 Testing

1. **Autenticación**
   - [ ] Registro de nuevo usuario
   - [ ] Login con email/password
   - [ ] Logout
   - [ ] Recuperación de contraseña
   - [ ] OAuth (si aplica)

2. **Viajes**
   - [ ] Crear viaje
   - [ ] Buscar viajes
   - [ ] Reservar asiento
   - [ ] Iniciar viaje
   - [ ] Completar viaje
   - [ ] Cancelar viaje

3. **Wallet**
   - [ ] Ver balance
   - [ ] Ver transacciones
   - [ ] Agregar fondos
   - [ ] Solicitar retiro

4. **Chat**
   - [ ] Crear chat
   - [ ] Enviar mensaje
   - [ ] Recibir mensajes en tiempo real

---

## 🧹 Limpieza Final

Una vez que todo funcione correctamente:

1. **Eliminar dependencias de Firebase:**
```bash
pnpm remove firebase firebase-admin firebase-functions
```

2. **Eliminar archivos de Firebase:**
   - `src/lib/firebase.js`
   - `src/lib/firebaseConfig.js`
   - `functions/` (directorio completo)

3. **Actualizar imports en todos los archivos**

4. **Eliminar configuración de Firebase:**
   - `firebase.json`
   - `.firebaserc`

---

## 🚨 Notas Importantes

### Diferencias Clave Firebase vs Supabase:

1. **IDs**: Firebase usa strings alfanuméricos, Supabase usa UUIDs
2. **Timestamps**: Firebase usa `Timestamp`, Supabase usa `TIMESTAMPTZ`
3. **Arrays**: Firebase usa `arrayUnion/arrayRemove`, Supabase usa `array_append/array_remove` en SQL
4. **Real-time**: Firebase usa `onSnapshot`, Supabase usa `subscribe` con channels
5. **Queries**: Firebase usa métodos encadenados, Supabase es más similar a SQL

### Seguridad:

- ⚠️ **NUNCA** expongas `SUPABASE_SERVICE_ROLE_KEY` en el frontend
- Usa Row Level Security (RLS) para proteger datos
- Las funciones RPC ya tienen `SECURITY DEFINER` para ejecutar con privilegios elevados

### Performance:

- Supabase usa PostgreSQL, optimizado para queries complejos
- Los índices geográficos permiten búsquedas rápidas de viajes cercanos
- Las funciones RPC reducen el número de round-trips a la base de datos

---

## 🆘 Ayuda y Soporte

- [Documentación de Supabase](https://supabase.com/docs)
- [Supabase Discord](https://discord.supabase.com/)
- [Stack Overflow - Supabase Tag](https://stackoverflow.com/questions/tagged/supabase)

---

## 📝 Checklist Final

- [ ] Proyecto de Supabase creado
- [ ] Variables de entorno configuradas
- [ ] Schema SQL ejecutado
- [ ] Funciones RPC ejecutadas
- [ ] Storage configurado
- [ ] Autenticación migrada
- [ ] Servicios migrados
- [ ] Real-time features migradas
- [ ] Testing completado
- [ ] Dependencias de Firebase eliminadas
- [ ] Documentación actualizada

---

**¡Buena suerte con la migración! 🚀**
