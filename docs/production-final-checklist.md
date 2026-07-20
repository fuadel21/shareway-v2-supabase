# ShareWay production final checklist

Este documento cierra la fase de preparación técnica de producción de **shareway.es**.

## CI obligatorio

El workflow `.github/workflows/production-ci.yml` se ejecuta en:

- pull requests hacia `main`,
- pushes a `main`,
- ejecución manual desde GitHub Actions.

La comprobación incluye:

1. instalación reproducible con `pnpm install --frozen-lockfile`,
2. cadena completa `pnpm run ci:production`,
3. tests unitarios con `pnpm test`.

## Contenido de `ci:production`

- preparación general para producción,
- control de escrituras sensibles desde cliente,
- coherencia SEO y PWA,
- integridad de assets e imports,
- salud de rutas públicas,
- build final de Vite.

## Checklist antes de mergear

- [ ] El PR nace del último `main`.
- [ ] No mezcla SQL con cambios de frontend sin instrucciones claras.
- [ ] GitHub Actions termina en verde.
- [ ] No se eliminan rutas públicas críticas.
- [ ] Manifest, sitemaps y robots siguen válidos.
- [ ] El copy público mantiene ShareWay como coche compartido, no taxi/VTC.
- [ ] El build no depende de archivos locales o variables no documentadas.
- [ ] Los cambios móviles respetan safe areas, overlays y navegación inferior.

## Checklist después del merge

- [ ] Confirmar deploy verde en Vercel.
- [ ] Abrir la portada en móvil.
- [ ] Probar registro e inicio de sesión.
- [ ] Probar publicar viaje y pedir plaza.
- [ ] Comprobar mapa, calendario, chat y notificaciones.
- [ ] Confirmar que no hay errores visibles en consola o rutas 404.
- [ ] Confirmar instalación PWA y accesos directos principales.

## Criterio de cierre

Esta sección se considera terminada cuando:

- el workflow Production CI está verde,
- el PR está mergeado,
- el deploy de producción funciona,
- no quedan PR antiguos de checklist o documentación abiertos.

A partir de aquí, cualquier cambio nuevo debe responder a un bug real, una mejora de producto priorizada o una necesidad de usuarios; no a más capas de checklist duplicadas.
