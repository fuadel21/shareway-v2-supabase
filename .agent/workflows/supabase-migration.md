---
description: Plan de migración completo de Firebase a Supabase
---

# 🔄 Plan de Migración Firebase → Supabase

## Fase 1: Configuración Inicial ✅
- [x] Instalar dependencias de Supabase
- [x] Crear configuración de Supabase
- [x] Crear archivo .env para variables de entorno

## Fase 2: Migración de Base de Datos 📊
- [ ] Analizar estructura actual de Firestore
- [ ] Crear schema SQL equivalente en Supabase
- [ ] Configurar Row Level Security (RLS)
- [ ] Crear funciones RPC necesarias
- [ ] Migrar datos existentes (si aplica)

## Fase 3: Migración de Autenticación 🔐
- [ ] Reemplazar Firebase Auth con Supabase Auth
- [ ] Actualizar contexto de autenticación (AuthContext)
- [ ] Actualizar hooks relacionados
- [ ] Actualizar componentes que usan autenticación
- [ ] Configurar providers de OAuth (si aplican)

## Fase 4: Migración de Storage 📁
- [ ] Configurar buckets en Supabase Storage
- [ ] Actualizar funciones de carga de archivos
- [ ] Migrar referencias de Storage en componentes
- [ ] Configurar políticas de acceso a Storage

## Fase 5: Migración de Cloud Functions → Edge Functions/API 🔧
- [ ] Decidir arquitectura (Edge Functions vs API Routes)
- [ ] Migrar funciones de usuarios
- [ ] Migrar funciones de viajes (rides)
- [ ] Migrar funciones de reservas (bookings)
- [ ] Migrar funciones de pagos (Stripe integration)
- [ ] Migrar funciones de chat
- [ ] Migrar funciones de wallet
- [ ] Migrar cron jobs

## Fase 6: Servicios y Hooks 🔄
- [ ] Actualizar rideService.js
- [ ] Actualizar bookingService.js
- [ ] Actualizar requestService.js
- [ ] Actualizar walletService.js
- [ ] Actualizar chatService.js
- [ ] Actualizar todos los hooks personalizados

## Fase 7: Características Especiales 🌟
- [ ] Migrar notificaciones (reemplazar FCM)
- [ ] Migrar real-time listeners
- [ ] Actualizar WebRTC/chat en tiempo real
- [ ] Configurar webhooks de Stripe

## Fase 8: Testing y Limpieza 🧹
- [ ] Probar autenticación completa
- [ ] Probar flujos de viajes
- [ ] Probar sistema de pagos
- [ ] Eliminar dependencias de Firebase
- [ ] Limpiar código legacy
- [ ] Actualizar documentación

---

## 🔑 Variables de Entorno Necesarias

```env
# Supabase
VITE_SUPABASE_URL=your-project-url.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stripe (mantener)
VITE_STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_SECRET_KEY=sk_...

# Otras APIs
VITE_GOOGLE_MAPS_API_KEY=... (si se mantiene)
```

## 📦 Dependencias a Instalar

```bash
pnpm add @supabase/supabase-js
```

## 📦 Dependencias a Remover (después de la migración)

```bash
pnpm remove firebase firebase-admin firebase-functions
```
