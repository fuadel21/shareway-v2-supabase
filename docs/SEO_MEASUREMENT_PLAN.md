# SEO Measurement Plan

Este bloque define cómo medir el tráfico SEO de ShareWay y convertirlo en usuarios registrados.

## Objetivos

- Saber qué páginas SEO reciben visitas.
- Saber qué guías, rutas y ciudades generan clics hacia registro o rutas.
- Detectar qué páginas convierten mejor.
- Priorizar nuevas guías según datos reales de Search Console y eventos internos.

## Eventos internos

| Evento | Cuándo se dispara | Uso |
|---|---|---|
| `page_view` | Al cargar una página | Medir tráfico por URL |
| `seo_cta_click` | Al pulsar login/registro desde una página SEO | Medir intención de conversión |
| `seo_route_click` | Al pulsar enlace a una ruta | Medir interés por rutas |
| `seo_city_click` | Al pulsar enlace a una ciudad | Medir interés por ciudades |
| `seo_airport_click` | Al pulsar enlace a aeropuerto | Medir interés por aeropuertos |
| `seo_guide_click` | Al pulsar enlace a una guía | Medir interés por guías long-tail |
| `seo_internal_link_click` | Al pulsar otro enlace interno SEO | Medir navegación interna |

## Revisión semanal

1. Search Console → Rendimiento → Consultas.
2. Search Console → Páginas → URLs con impresiones.
3. Supabase → `growth_events` → eventos por path.
4. Crear nuevas guías para consultas con impresiones y bajo CTR.
5. Reforzar enlaces internos hacia URLs con mejor potencial.

## SQL útil en Supabase

```sql
select
  path,
  event_name,
  count(*) as events
from public.growth_events
where created_at >= now() - interval '30 days'
group by path, event_name
order by events desc;
```

```sql
select
  metadata->>'targetPath' as target_path,
  event_name,
  count(*) as clicks
from public.growth_events
where event_name like 'seo_%_click'
  and created_at >= now() - interval '30 days'
group by metadata->>'targetPath', event_name
order by clicks desc;
```

## Páginas clave a vigilar

- `/rutas/pineda-de-mar/barcelona/`
- `/rutas/malgrat-de-mar/barcelona/`
- `/rutas/mataro/barcelona/`
- `/rutas/girona/barcelona/`
- `/guias/como-ir-de-pineda-de-mar-a-barcelona-barato/`
- `/guias/compartir-coche-malgrat-de-mar-barcelona/`
- `/guias/viajes-compartidos-mataro-barcelona/`
- `/guias/compartir-coche-girona-barcelona/`

## Nota

Los eventos internos no sustituyen Search Console ni GA4. Sirven para medir acciones dentro de ShareWay y detectar páginas SEO que empujan al usuario hacia registro, ruta o contacto.
