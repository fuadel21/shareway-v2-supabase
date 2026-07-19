# CI and audit checks

ShareWay usa `ci:production` como barrera rápida antes de desplegar. El objetivo es detectar errores de seguridad, SEO/PWA, assets e imports antes de gastar un intento de Vercel o publicar una build rota.

## Comando principal

```bash
pnpm run ci:production
```

Ejecuta, en orden:

1. `audit:production`
2. `audit:sensitive`
3. `audit:seo-pwa`
4. `audit:assets`
5. `build`

## `audit:production`

Script: `scripts/check-production-readiness.mjs`

Comprueba configuración básica de producción para evitar publicar una app incompleta o insegura.

Qué hacer si falla:

- Leer el mensaje exacto del script.
- Revisar variables públicas permitidas.
- Confirmar que no se ha añadido configuración temporal de desarrollo.
- Repetir `pnpm run audit:production` antes de abrir PR nuevo.

## `audit:sensitive`

Script: `scripts/check-sensitive-client-writes.mjs`

Busca patrones sensibles en cliente para evitar operaciones peligrosas o secretos expuestos en el frontend.

Qué hacer si falla:

- No mover secretos a `VITE_*`.
- No usar service role en cliente.
- Mover lógica sensible a Supabase RPC o backend seguro.
- Revisar el archivo señalado por el error.

## `audit:seo-pwa`

Script: `scripts/check-seo-pwa-consistency.mjs`

Protege el posicionamiento público de ShareWay como coche compartido/carpooling y evita volver a posicionar la app como taxi/VTC.

Qué hacer si falla:

- Revisar `public/manifest.json`, `public/seo-sitemap.xml`, `public/sitemap.xml`, `public/robots.txt` e `index.html`.
- Sustituir copy tipo taxi/VTC por compartir coche, rutas compartidas o carpooling.
- Mantener `start_url` del manifest en `/`.
- Confirmar que los shortcuts apuntan a rutas reales.

## `audit:assets`

Script: `scripts/check-asset-import-health.mjs`

Comprueba que los CSS importados desde `src/main.jsx` existen y que los archivos públicos críticos están presentes.

Qué hacer si falla:

- Revisar imports de `src/main.jsx`.
- Confirmar que el archivo importado existe en `src/`.
- Confirmar que `public/manifest.json`, `robots.txt` y sitemaps existen.
- No borrar un CSS importado sin quitar también su import.

## `build`

Comando: `vite build`

Genera la build final.

Qué hacer si falla:

- Leer el primer error real, no solo el resumen final.
- Revisar imports rotos, JSX inválido o dependencias faltantes.
- Si el error es de CSS, revisar los últimos archivos en `src/styles/`.
- Si el error es de Supabase/env, confirmar variables en Vercel.

## Checklist rápido antes de gastar Vercel

```bash
pnpm run ci:production
```

Si pasa en GitHub, el deploy tiene muchas más probabilidades de salir verde.

## Regla de mantenimiento

Cuando se añada un nuevo audit, documentarlo en este archivo y conectarlo dentro de `ci:production` antes de `build`.
