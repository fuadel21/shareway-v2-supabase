# SEO/PWA consistency guide

ShareWay debe posicionarse como una plataforma de coche compartido, rutas compatibles y reparto de gastos entre particulares.

## Posicionamiento permitido

- compartir coche
- coche compartido
- carpooling
- viajes compartidos
- rutas compartidas
- trayectos compartidos
- ahorrar compartiendo viaje
- movilidad colaborativa
- reducir emisiones

## Posicionamiento a evitar

No usar ShareWay como si fuera una empresa de taxi, VTC o transporte profesional.

Evitar especialmente:

- taxi compartido
- taxi barato
- compartir taxi
- empresa de taxi
- reservar taxi
- conductor profesional
- VTC

La app puede explicar que no es taxi/VTC cuando sea necesario por claridad legal, pero no debe usar esos términos como objetivo SEO principal.

## Manifest PWA

El manifest debe mantenerse coherente con coche compartido:

- `name` y `description` deben hablar de compartir coche y trayectos.
- `start_url` debe apuntar a `/` para evitar sesiones rotas al instalar la PWA.
- Los shortcuts deben apuntar a acciones reales: dashboard, publicar viaje, pedir plaza y mis viajes.

## Sitemaps públicos

- `public/sitemap.xml` es el índice principal.
- `public/seo-sitemap.xml` debe evitar URLs de taxi.
- Los sitemaps growth deben reforzar ciudades, rutas, aeropuertos y guías desde enfoque carpooling.

## Regla de mantenimiento

Antes de añadir páginas públicas nuevas, confirmar que el copy se alinea con coche compartido entre particulares y no con taxi/VTC profesional.
