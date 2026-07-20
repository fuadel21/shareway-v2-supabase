# Production audit checklist

Esta guía resume los checks que deben pasar antes de considerar un deploy de ShareWay como seguro.

## Comando principal

```bash
pnpm run ci:production
```

Este comando debe ejecutarse antes de cerrar una tanda grande de cambios o antes de publicar un deploy importante.

## Checks incluidos

### `audit:production`

Valida reglas generales de preparación para producción.

Objetivo:

- detectar configuración insegura
- evitar cambios incompletos de producción
- proteger archivos críticos

### `audit:sensitive`

Busca escrituras sensibles desde cliente.

Objetivo:

- evitar operaciones peligrosas desde frontend
- reducir riesgo de saltarse RLS
- mantener lógica sensible en RPC/backend

### `audit:seo-pwa`

Valida coherencia pública SEO/PWA.

Objetivo:

- mantener ShareWay posicionado como coche compartido
- evitar que vuelvan términos tipo taxi/VTC al SEO principal
- confirmar manifest y shortcuts PWA básicos

### `audit:assets`

Valida assets e imports críticos.

Objetivo:

- comprobar que los CSS importados existen
- confirmar archivos públicos críticos
- evitar deploys rotos por imports eliminados

### `audit:routes`

Valida salud de rutas públicas.

Objetivo:

- confirmar rutas públicas esperadas
- evitar enlaces públicos rotos
- proteger sitemaps y páginas SEO

### `build`

Ejecuta el build de Vite.

Objetivo:

- confirmar que la app compila
- detectar errores de imports, JSX o dependencias

## Checklist antes de mergear bloques grandes

- El PR sale desde una rama limpia basada en `main`.
- No se toca `main` directamente.
- El PR indica si requiere SQL o no.
- Si toca SEO/PWA, revisar que no posiciona ShareWay como taxi/VTC.
- Si toca CSS global, confirmar que no rompe el orden documentado en `docs/responsive-style-layers.md`.
- Si toca archivos públicos, confirmar sitemap/robots/manifest.
- Si toca Supabase, añadir instrucciones SQL claras y separadas.

## Si falla Vercel

1. Revisar primero el error exacto del build.
2. Si falla por auditoría, corregir la causa y no saltar el check.
3. Si falla por imports/assets, revisar `main.jsx`, `public/` y `src/styles/`.
4. Si falla por SEO/PWA, revisar `manifest.json`, `seo-sitemap.xml`, `sitemap.xml`, `robots.txt` e `index.html`.
5. Si falla por Supabase/RLS, no parchear en frontend: revisar RPC, políticas y migraciones.

## Regla práctica

Cuando haya límite de Vercel, agrupar mejoras compatibles en un solo PR grande, pero mantener cada bloque reversible y bien documentado.
