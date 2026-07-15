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

const normalizeButtonText = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const getDashboardActivityTarget = (label) => {
  const text = normalizeButtonText(label);
  if (text === 'todos' || text === 'all') return '/my-rides?tab=active';
  if (text === 'viajes' || text === 'rides') return '/my-rides?tab=active';
  if (text === 'solicitudes' || text === 'requests') return '/my-rides?tab=requested';
  return null;
};

const getActivityTabLabel = (tab) => {
  if (tab === 'requested') return ['solicitudes', 'requests'];
  if (tab === 'history') return ['historial', 'history'];
  if (tab === 'cancelled') return ['cancelados', 'cancelled', 'canceladas'];
  return ['proximos', 'upcoming'];
};

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
    const params = new URLSearchParams(location.search || '');
    const targetTab = params.get('tab');
    if (location.pathname !== '/my-rides' || !targetTab) return undefined;

    const timer = window.setTimeout(() => {
      const labels = getActivityTabLabel(targetTab);
      const tabButton = Array.from(document.querySelectorAll('button')).find((button) => {
        const text = normalizeButtonText(button.textContent || '');
        return labels.some((label) => text.includes(label));
      });

      tabButton?.click?.();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleClick = (event) => {
      const button = event.target?.closest?.('button');
      if (window.location.pathname === '/dashboard' && button) {
        const target = getDashboardActivityTarget(button.textContent || '');
        if (target) {
          event.preventDefault();
          event.stopPropagation();
          window.location.assign(target);
          return;
        }
      }

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
