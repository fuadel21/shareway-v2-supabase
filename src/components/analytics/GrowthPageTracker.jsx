import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackGrowthEvent, trackPageView } from '@/lib/growthAnalytics.js';

const getSeoPageType = (path) => {
  if (path === '/') return 'home';
  if (path.startsWith('/rutas/')) return 'route';
  if (path.startsWith('/ciudades/')) return 'city';
  if (path.startsWith('/aeropuertos/')) return 'airport';
  if (path.startsWith('/guias/')) return 'guide';
  if (
    path.startsWith('/carpooling') ||
    path.startsWith('/compartir-coche') ||
    path.startsWith('/viajes-compartidos') ||
    path.startsWith('/rutas-compartidas') ||
    path.startsWith('/taxi-compartido') ||
    path.startsWith('/compartir-trayecto') ||
    path.startsWith('/compartir-taxi') ||
    path.startsWith('/ahorrar-compartiendo-taxi')
  ) return 'seo_landing';
  return 'app';
};

const getSeoClickEventName = (targetPath) => {
  if (targetPath === '/register' || targetPath === '/login') return 'seo_cta_click';
  if (targetPath.startsWith('/rutas/')) return 'seo_route_click';
  if (targetPath.startsWith('/ciudades/')) return 'seo_city_click';
  if (targetPath.startsWith('/aeropuertos/')) return 'seo_airport_click';
  if (targetPath.startsWith('/guias/')) return 'seo_guide_click';
  return 'seo_internal_link_click';
};

const isTrackableSeoTarget = (targetPath) => (
  targetPath === '/register' ||
  targetPath === '/login' ||
  targetPath.startsWith('/rutas/') ||
  targetPath.startsWith('/ciudades/') ||
  targetPath.startsWith('/aeropuertos/') ||
  targetPath.startsWith('/guias/') ||
  targetPath.startsWith('/carpooling') ||
  targetPath.startsWith('/compartir-coche') ||
  targetPath.startsWith('/viajes-compartidos') ||
  targetPath.startsWith('/rutas-compartidas') ||
  targetPath.startsWith('/taxi-compartido') ||
  targetPath.startsWith('/compartir-trayecto') ||
  targetPath.startsWith('/compartir-taxi') ||
  targetPath.startsWith('/ahorrar-compartiendo-taxi')
);

const GrowthPageTracker = () => {
  const location = useLocation();

  useEffect(() => {
    const pageType = getSeoPageType(location.pathname);

    trackPageView({
      search: location.search || null,
      hash: location.hash || null,
      pageType,
    });
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    const handleClick = (event) => {
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor) return;

      let targetUrl;
      try {
        targetUrl = new URL(anchor.getAttribute('href'), window.location.origin);
      } catch (error) {
        return;
      }

      if (targetUrl.origin !== window.location.origin) return;

      const sourcePath = window.location.pathname;
      const sourcePageType = getSeoPageType(sourcePath);
      const targetPath = targetUrl.pathname;

      if (sourcePageType === 'app' || !isTrackableSeoTarget(targetPath)) return;

      trackGrowthEvent(getSeoClickEventName(targetPath), {
        metadata: {
          sourcePath,
          sourcePageType,
          targetPath,
          targetText: anchor.textContent?.trim()?.slice(0, 120) || null,
        },
      });
    };

    document.addEventListener('click', handleClick, { capture: true });
    return () => document.removeEventListener('click', handleClick, { capture: true });
  }, []);

  return null;
};

export default GrowthPageTracker;
