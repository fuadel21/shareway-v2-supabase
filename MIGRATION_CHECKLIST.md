# ✅ CHECKLIST DE MIGRACIÓN - ShareWay v2

## 🎯 Fase 1: Setup de Supabase (30-40 min)

### A. Crear Proyecto en Supabase
- [ ] 1.1. Ir a https://supabase.com/dashboard
- [ ] 1.2. Iniciar sesión (GitHub recomendado)
- [ ] 1.3. Click en "New Project"
- [ ] 1.4. Configurar:
  - Nombre: `shareway-v2`
  - Database Password: __________ (guardar en lugar seguro)
  - Región: __________ (ej: Europe West)
  - Plan: Free
- [ ] 1.5. Click "Create new project"
- [ ] 1.6. **Esperar 1-2 minutos** (la BD se está inicializando)

### B. Obtener Credenciales
Una vez que el proyecto esté listo:

- [ ] 2.1. Ir a **Settings** (ícono de engranaje) > **API**
- [ ] 2.2. Copiar los siguientes valores:

```
Project URL: _________________________________
anon public key: _________________________________
service_role key: _________________________________
```

- [ ] 2.3. Actualizar archivo `.env` en la raíz del proyecto:
  - Reemplazar `VITE_SUPABASE_URL=...`
  - Reemplazar `VITE_SUPABASE_ANON_KEY=...`
  - Reemplazar `SUPABASE_SERVICE_ROLE_KEY=...`

### C. Ejecutar Scripts SQL
- [ ] 3.1. En Supabase Dashboard, ir a **SQL Editor** (ícono </> en el menú)
- [ ] 3.2. Click en "New query"
- [ ] 3.3. Copiar y pegar TODO el contenido de `supabase/schema.sql`
- [ ] 3.4. Click "Run" o presionar `Ctrl+Enter`
- [ ] 3.5. **Verificar**: Ir a "Table Editor" y confirmar que se crearon 11 tablas:
  - ✓ profiles
  - ✓ wallets
  - ✓ transactions
  - ✓ rides
  - ✓ ride_requests
  - ✓ chats
  - ✓ messages
  - ✓ ratings
  - ✓ communities
  - ✓ emergency_contacts
  - ✓ favorite_routes

- [ ] 3.6. Crear otra "New query"
- [ ] 3.7. Copiar y pegar TODO el contenido de `supabase/rpc_functions.sql`
- [ ] 3.8. Click "Run"
- [ ] 3.9. **Verificar**: Ir a "Database" > "Functions" y confirmar que se crearon las funciones

- [ ] 3.10. Crear otra "New query"
- [ ] 3.11. Copiar y pegar TODO el contenido de `supabase/additional_functions.sql`
- [ ] 3.12. Click "Run"

### D. Configurar Storage
- [ ] 4.1. Ir a **Storage** en el menú lateral
- [ ] 4.2. Click "Create a new bucket"
- [ ] 4.3. Crear bucket `profile-photos`:
  - Name: `profile-photos`
  - Public bucket: ✓ (activar)
  - Click "Create bucket"

- [ ] 4.4. Crear bucket `verification-documents`:
  - Name: `verification-documents`
  - Public bucket: ✗ (desactivar)
  - Click "Create bucket"

- [ ] 4.5. Crear bucket `chat-media`:
  - Name: `chat-media`
  - Public bucket: ✗ (desactivar)
  - Click "Create bucket"

### E. Configurar Autenticación
- [ ] 5.1. Ir a **Authentication** > **Providers**
- [ ] 5.2. Verificar que "Email" está habilitado (viene por defecto)
- [ ] 5.3. Si usas Google OAuth:
  - Click en "Google"
  - Activar "Enable Google provider"
  - Configurar Client ID y Client Secret

---

## 🎯 Fase 2: Migración de Código (2-3 días)

### A. Probar Conexión
- [ ] 6.1. Abrir consola del navegador (F12)
- [ ] 6.2. Ejecutar:
```javascript
import { supabase } from './src/lib/supabase.js';
const { data, error } = await supabase.from('profiles').select('count');
console.log('Conexión:', data ? '✅ Exitosa' : '❌ Error', error);
```

### B. Migrar AuthContext
- [ ] 7.1. Abrir `src/contexts/AuthContext.jsx` (o similar)
- [ ] 7.2. Reemplazar imports de Firebase con Supabase
- [ ] 7.3. Actualizar funciones de login/logout/register
- [ ] 7.4. Probar:
  - [ ] Registro de nuevo usuario
  - [ ] Login
  - [ ] Logout

### C. Migrar Servicios (Uno por uno)

**rideService.js**
- [ ] 8.1. Renombrar `src/services/rideService.js` a `rideService.firebase.js.bak`
- [ ] 8.2. Renombrar `src/services/rideService.supabase.js` a `rideService.js`
- [ ] 8.3. Actualizar imports en componentes que usan rideService
- [ ] 8.4. Probar:
  - [ ] Crear viaje
  - [ ] Ver viajes
  - [ ] Buscar viajes

**walletService.js**
- [ ] 9.1. Migrar a Supabase usando `supabaseRPC.js`
- [ ] 9.2. Probar wallet y transacciones

**bookingService.js**
- [ ] 10.1. Migrar a Supabase
- [ ] 10.2. Probar reservas

**requestService.js**
- [ ] 11.1. Migrar a Supabase
- [ ] 11.2. Probar solicitudes

**chatService.js**
- [ ] 12.1. Migrar a Supabase con real-time
- [ ] 12.2. Probar chat en tiempo real

### D. Actualizar Componentes
- [ ] 13.1. Buscar todos los archivos con `import.*firebase`
- [ ] 13.2. Actualizar uno por uno a Supabase
- [ ] 13.3. Testing continuo de cada componente

---

## 🎯 Fase 3: Testing Completo (1 día)

### Funcionalidad Core
- [ ] 14.1. Registro e inicio de sesión
- [ ] 14.2. Crear perfil
- [ ] 14.3. Publicar viaje
- [ ] 14.4. Buscar viajes
- [ ] 14.5. Reservar asiento
- [ ] 14.6. Iniciar viaje (verificar PIN)
- [ ] 14.7. Completar viaje
- [ ] 14.8. Cancelar viaje/reserva
- [ ] 14.9. Chat en tiempo real
- [ ] 14.10. Calificaciones
- [ ] 14.11. Wallet y transacciones

### Real-time Features
- [ ] 15.1. Mensajes de chat
- [ ] 15.2. Actualizaciones de viajes
- [ ] 15.3. Notificaciones

---

## 🎯 Fase 4: Limpieza Final (1 día)

### Eliminar Firebase
- [ ] 16.1. Verificar que TODO funciona con Supabase
- [ ] 16.2. Hacer backup del proyecto actual
- [ ] 16.3. Eliminar dependencias:
```bash
npm remove firebase firebase-admin firebase-functions
```
- [ ] 16.4. Eliminar archivos:
  - [ ] `src/lib/firebase.js`
  - [ ] `src/lib/firebaseConfig.js`
  - [ ] `functions/` (directorio completo)
  - [ ] `firebase.json`
  - [ ] `.firebaserc`
  - [ ] Todos los `.bak` creados

- [ ] 16.5. Limpiar imports:
  - Buscar cualquier referencia a `firebase` en el código
  - Eliminar imports no usados

### Testing Final
- [ ] 17.1. Probar TODAS las features críticas
- [ ] 17.2. Verificar que no hay errores en consola
- [ ] 17.3. Probar en diferentes navegadores
- [ ] 17.4. Probar flujo completo de usuario

---

## 🎉 ¡MIGRACIÓN COMPLETADA!

### Post-Migración
- [ ] 18.1. Configurar backups automáticos en Supabase
- [ ] 18.2. Monitorear logs los primeros días
- [ ] 18.3. Optimizar queries según uso real
- [ ] 18.4. Documentar cambios para el equipo

---

## 📊 Progreso Actual

```
✅ Fase 0: Preparación            - COMPLETADA (scripts SQL, helpers, docs)
🔄 Fase 1: Setup de Supabase      - EN PROGRESO
⏳ Fase 2: Migración de Código    - PENDIENTE
⏳ Fase 3: Testing                - PENDIENTE
⏳ Fase 4: Limpieza               - PENDIENTE
```

---

## 🆘 Si encuentras problemas:

1. **Error al ejecutar SQL**: Revisa que copiaste el script completo
2. **Error de autenticación**: Verifica las credenciales en `.env`
3. **RLS errors**: Es normal, las políticas RLS protegen los datos
4. **No compila**: Verifica que `@supabase/supabase-js` está instalado

**Consulta**: `MIGRATION_GUIDE.md` para detalles de cada paso

---

**Última actualización**: 2025-12-27  
**Estado**: Listo para comenzar Fase 1
