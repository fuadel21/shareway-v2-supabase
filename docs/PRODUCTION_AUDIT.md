# ShareWay - Auditoria de produccion

Fecha: 2026-07-07
Rama: audit/production-readiness-20260707

## Estado general

La aplicacion esta en estado beta/pre-produccion. La base React/Vite/Supabase esta bien encaminada, pero no debe abrirse al publico hasta cerrar los puntos criticos de seguridad, datos reales y validacion automatica.

## Puntos criticos detectados

### 1. Respuestas simuladas en servicios reales

En `src/services/rideService.js` hay funciones de ciclo de viaje que devuelven datos simulados para compatibilidad con tests. Antes de produccion deben depender solo de la respuesta real de Supabase/RPC.

Funciones afectadas:

- `completeRide`
- `cancelRide`
- `updateRideLocation`
- `emergencyStopRide`
- `updateRideStatus`

Riesgo: el frontend puede mostrar importes, reembolsos, penalizaciones, pasajeros o metricas que no existen realmente en base de datos.

### 2. Seguridad real depende de Supabase RPC/RLS

El frontend usa muchas funciones RPC para operaciones sensibles:

- crear viaje
- aceptar pasajero
- cancelar viaje
- cancelar reserva
- completar viaje
- pagos y wallet
- admin
- busqueda de usuarios

Cada RPC debe validar `auth.uid()` en servidor y no confiar en datos enviados por el cliente.

### 3. Admin solo debe depender de servidor

La UI comprueba `is_admin`, `role = admin` o `role = super_admin`, pero eso solo sirve para mostrar u ocultar pantallas. Las funciones admin deben estar blindadas con policies/RPC en Supabase.

### 4. CI obligatoria antes de merge a main

Falta un workflow de GitHub Actions que ejecute:

- `pnpm install --frozen-lockfile`
- `pnpm run lint`
- `pnpm run test`
- `pnpm run build`

No se debe desplegar a produccion si cualquiera de estos pasos falla.

### 5. SEO limitado por SPA

`index.html` tiene metadatos correctos, pero las rutas SEO dinamicas dependen de renderizado cliente. Para mejor indexacion se recomienda prerender o paginas estaticas para ciudades/rutas principales.

## Checklist minimo antes de produccion

- [ ] Eliminar todos los datos mock de servicios reales.
- [ ] Confirmar que todas las tablas sensibles tienen RLS activo.
- [ ] Revisar policies de `profiles`, `rides`, `ride_requests`, `bookings`, `payments`, `wallets`, `messages`, `notifications`, `payout_requests` y `platform_settings`.
- [ ] Confirmar que las RPC admin usan validacion server-side de admin.
- [ ] Ejecutar build real en limpio.
- [ ] Ejecutar pruebas unitarias.
- [ ] Probar flujo completo pasajero: registro, login, busqueda, reserva, chat, cancelacion.
- [ ] Probar flujo completo conductor: registro, publicar viaje, aceptar pasajero, iniciar, verificar PIN, finalizar.
- [ ] Probar flujo admin: verificaciones, usuarios, disputas, pagos, mantenimiento.
- [ ] Verificar URLs de Supabase Auth: site URL y redirect URLs.
- [ ] Verificar Edge Functions desplegadas.
- [ ] Verificar variables en Vercel.
- [ ] Verificar textos legales: privacidad, terminos, cookies y aviso legal.

## Workflow recomendado

Crear `.github/workflows/production-checks.yml`:

```yaml
name: Production Checks

on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  validate:
    name: Lint, test and build
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run lint
        run: pnpm run lint

      - name: Run unit tests
        run: pnpm run test

      - name: Build production bundle
        run: pnpm run build
```

## Siguiente bloque tecnico

Sustituir los retornos simulados de `rideService.js` por respuestas normalizadas desde RPC reales.
