# Production CI guide

Este proyecto usa varias comprobaciones antes de considerar una build lista para producción.

## Comandos principales

### `pnpm run audit:production`

Comprueba señales generales de preparación para producción.

### `pnpm run audit:sensitive`

Busca escrituras o patrones sensibles que no deben quedar expuestos en cliente.

### `pnpm run audit:seo-pwa`

Verifica que la capa pública SEO/PWA se mantiene alineada con ShareWay como coche compartido, no taxi/VTC.

### `pnpm run build`

Genera la build final de Vite.

## Comandos agrupados

### `pnpm run ci:quick`

Ejecuta auditorías rápidas sin build. Útil antes de abrir PRs grandes cuando se quiere ahorrar tiempo.

### `pnpm run ci:production`

Ejecuta auditorías + build completa. Este comando debe seguir siendo la referencia para producción y despliegues.

## Orden recomendado

1. `audit:production`
2. `audit:sensitive`
3. `audit:seo-pwa`
4. `build`

Si falla un paso, revisar primero el área concreta que indica el nombre del comando antes de tocar otros bloques.

## Regla de mantenimiento

Cuando se añada una nueva auditoría rápida, incluirla en `ci:quick`. Solo añadirla a `ci:production` si debe bloquear producción.
