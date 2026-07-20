# Release and deploy checklist

Checklist para publicar cambios en ShareWay sin gastar intentos de Vercel ni romper SEO/PWA.

## Objetivo

Antes de mergear bloques grandes, confirmar que el cambio es coherente, revisable y no mezcla riesgos innecesarios.

## 1. Antes de abrir PR

- Agrupar cambios compatibles en un solo bloque grande.
- Evitar micro-PRs salvo bug crítico.
- Separar cambios de runtime, SQL, SEO y estilos cuando puedan tener riesgos distintos.
- No tocar `main` directamente.
- Empezar siempre desde el último `main`.
- Confirmar que el copy público no posiciona ShareWay como taxi/VTC.

## 2. Antes de mergear

Revisar que el PR indique claramente:

- Qué toca.
- Qué no toca.
- Si requiere SQL o no.
- Si afecta a runtime, PWA, SEO, Supabase, estilos, scripts o solo documentación.
- Si puede gastar deploy de Vercel de forma útil.

## 3. Checks recomendados

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

También se pueden ejecutar por separado:

```bash
pnpm run audit:production
pnpm run audit:sensitive
pnpm run audit:seo-pwa
pnpm run audit:assets
pnpm run build
```

## 4. Si falla Vercel

Revisar en este orden:

1. Variables de entorno faltantes.
2. Archivo importado que no existe.
3. Error de sintaxis JS/JSX/CSS.
4. Fallo de `audit:seo-pwa`.
5. Fallo de `audit:assets`.
6. Supabase URL/anon key incorrectas.
7. Problema de dependencias o lockfile.

## 5. Si falla `audit:seo-pwa`

Revisar:

- `public/manifest.json`
- `public/robots.txt`
- `public/sitemap.xml`
- `public/seo-sitemap.xml`

No usar términos de taxi/VTC como objetivo SEO. ShareWay debe hablar de compartir coche, carpooling y trayectos compartidos.

## 6. Si falla `audit:assets`

Revisar:

- Imports CSS en `src/main.jsx`.
- Archivos dentro de `src/styles/`.
- Assets públicos críticos dentro de `public/`.
- Sitemaps hijos listados en `public/sitemap.xml`.

## 7. Si móvil se ve mal después del deploy

Revisar en este orden:

1. Último archivo CSS polish añadido.
2. Orden de imports en `src/main.jsx`.
3. Selectores demasiado amplios.
4. Reglas con `!important` que pisan componentes.
5. Safe-area inferior y overlays del mapa.

Evitar tocar React hasta identificar si el problema viene solo de CSS.

## 8. Después del merge

- Confirmar que el PR aparece como `merged`.
- Esperar el deploy de Vercel si el cambio toca runtime.
- Para cambios solo de docs o checks, se puede seguir con otro bloque cuando GitHub esté limpio.

## 9. En producción

Comprobar rápido:

- La home carga.
- El dashboard carga.
- La PWA sigue instalable.
- El mapa no queda tapado por overlays móviles.
- Los botones principales responden en móvil.
- Formularios funcionan con teclado móvil abierto.
- SEO sigue hablando de coche compartido y no taxi/VTC.

## Regla práctica

Si el cambio puede gastar deploy y no es urgente, agruparlo dentro de un bloque grande con otros cambios compatibles.
