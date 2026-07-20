# Production CI audits

Esta guía resume los checks que protegen ShareWay antes de un deploy de producción.

## Comando principal

```bash
pnpm run ci:production
```

Este comando ejecuta todos los audits críticos y después el build de Vite.

## Audits incluidos

### `audit:production`

Ejecuta `scripts/check-production-readiness.mjs`.

Protege la configuración general de producción y evita errores básicos antes del deploy.

### `audit:sensitive`

Ejecuta `scripts/check-sensitive-client-writes.mjs`.

Ayuda a detectar escrituras sensibles desde cliente que podrían saltarse flujos seguros.

### `audit:seo-pwa`

Ejecuta `scripts/check-seo-pwa-consistency.mjs`.

Comprueba que los archivos públicos de SEO/PWA mantienen el posicionamiento correcto de ShareWay como coche compartido, no taxi/VTC.

### `audit:assets`

Ejecuta `scripts/check-asset-import-health.mjs`.

Comprueba que los imports de assets y estilos críticos existen y que no falta ningún archivo público básico.

### `audit:routes`

Ejecuta `scripts/check-public-route-health.mjs`.

Comprueba que las rutas públicas principales y los archivos relacionados siguen presentes.

## Cuándo ejecutarlo

Ejecutar antes de:

- mergear bloques grandes de SEO, PWA o assets,
- cambios en `public/`, `index.html`, `main.jsx`, `package.json` o `scripts/`,
- deploy manual a Vercel,
- publicar build PWA o Android/WebView.

## Flujo recomendado desde móvil

1. Crear PR con bloque grande.
2. Revisar que GitHub Actions queda verde.
3. Si falla un audit, no hacer merge.
4. Corregir en el mismo PR si es pequeño.
5. Mergear cuando `ci:production` y build estén verdes.

## Regla de mantenimiento

Cada audit debe tener una responsabilidad concreta. Si un check nuevo protege otra zona distinta, crear un script separado y añadirlo al `ci:production`.
