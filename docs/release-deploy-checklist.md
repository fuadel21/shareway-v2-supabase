# Release and deploy checklist

Checklist corto para publicar cambios en ShareWay sin gastar intentos de Vercel ni romper SEO/PWA.

## Antes de abrir PR

- Agrupar cambios compatibles en un solo bloque grande.
- Evitar micro-PRs salvo bug crítico.
- Separar cambios de runtime, SQL, SEO y estilos cuando puedan tener riesgos distintos.
- No tocar `main` directamente.
- Confirmar que los cambios no convierten ShareWay en taxi/VTC en copy público.

## Antes de mergear

Revisar que el PR indique claramente:

- Qué toca.
- Qué no toca.
- Si requiere SQL o no.
- Si afecta a runtime, PWA, SEO, Supabase o solo documentación.

## Checks recomendados

Ejecutar o esperar a que CI ejecute:

```bash
pnpm run ci:production
```

Este comando debe cubrir:

- Auditoría de readiness de producción.
- Auditoría de escrituras sensibles cliente.
- Guard SEO/PWA.
- Guard de assets/imports.
- Build Vite.

## Si falla `audit:seo-pwa`

Revisar:

- `public/manifest.json`
- `public/robots.txt`
- `public/sitemap.xml`
- `public/seo-sitemap.xml`

No usar términos de taxi/VTC como objetivo SEO. ShareWay debe hablar de compartir coche, carpooling y trayectos compartidos.

## Si falla `audit:assets`

Revisar:

- Imports CSS en `src/main.jsx`.
- Archivos dentro de `src/styles/`.
- Assets públicos críticos dentro de `public/`.
- Sitemaps hijos listados en `public/sitemap.xml`.

## Después del merge

- Confirmar que el PR aparece como `merged`.
- Esperar el deploy de Vercel antes de abrir otro PR si el cambio toca runtime.
- Para cambios solo de docs o checks, se puede seguir con otro bloque cuando GitHub esté limpio.

## En Vercel

Revisar:

- Build terminado en verde.
- No hay error de rutas públicas.
- No hay fallo por archivo CSS inexistente.
- No hay fallo de sitemap/manifest.

## En producción

Comprobar rápido:

- La home carga.
- El dashboard carga.
- La PWA sigue instalable.
- El mapa no queda tapado por overlays móviles.
- Los botones principales responden en móvil.

## Regla práctica

Si el cambio puede gastar deploy y no es urgente, agruparlo dentro de un bloque grande con otros cambios compatibles.
