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

const getRequestTabLabel = (tab) => {
  if (tab === 'accepted') return ['aceptadas', 'accepted', 'المقبولة'];
  if (tab === 'history') return ['historial', 'history', 'السجل'];
  return ['activas', 'active', 'النشطة'];
};

const clickTabByLabels = (labels) => {
  const tabButton = Array.from(document.querySelectorAll('button')).find((button) => {
    const text = normalizeButtonText(button.textContent || '');
    return labels.some((label) => text.includes(normalizeButtonText(label)));
  });

  tabButton?.click?.();
};

const getActivityCopy = () => {
  const lang = document.documentElement.lang || navigator.language || 'es';
  if (lang.startsWith('en')) {
    return {
      title: 'What do you want to do now?',
      desc: 'Create a ride or request a seat to start seeing activity here.',
      publish: 'Publish ride',
      request: 'Request seat',
    };
  }
  if (lang.startsWith('ar')) {
    return {
      title: 'ماذا تريد أن تفعل الآن؟',
      desc: 'انشر رحلة أو أنشئ طلبًا لبدء ظهور النشاط هنا.',
      publish: 'نشر رحلة',
      request: 'طلب مقعد',
    };
  }
  return {
    title: '¿Qué quieres hacer ahora?',
    desc: 'Publica un viaje o pide plaza para empezar a ver actividad aquí.',
    publish: 'Publicar viaje',
    request: 'Pedir plaza',
  };
};

const injectActivityEmptyStateCtas = () => {
  if (window.location.pathname !== '/my-rides') return;
  const emptyTitle = Array.from(document.querySelectorAll('h3, p')).find((node) => {
    const text = normalizeButtonText(node.textContent || '');
    return text.includes('sin resultados') || text.includes('no results') || text.includes('لا توجد نتائج');
  });

  const card = emptyTitle?.closest?.('div');
  if (!card || card.querySelector('[data-shareway-empty-activity]')) return;

  const copy = getActivityCopy();
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-shareway-empty-activity', 'true');
  wrapper.className = 'mt-6 px-5 pb-2 space-y-3';
  wrapper.innerHTML = `
    <div class="rounded-3xl bg-slate-950 text-white px-5 py-4 shadow-xl text-left">
      <p class="text-[10px] font-black uppercase tracking-[0.22em] text-orange-400">ShareWay</p>
      <h4 class="mt-1 text-base font-black italic uppercase tracking-tight">${copy.title}</h4>
      <p class="mt-2 text-[11px] font-bold text-slate-300 leading-relaxed">${copy.desc}</p>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <button type="button" data-shareway-nav="/publish" class="h-12 rounded-2xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all">${copy.publish}</button>
      <button type="button" data-shareway-nav="/request" class="h-12 rounded-2xl bg-white text-slate-900 border border-slate-100 text-[9px] font-black uppercase tracking-widest shadow active:scale-95 transition-all">${copy.request}</button>
    </div>
  `;
  card.appendChild(wrapper);
};

const getRequestGuideCopy = () => {
  const lang = document.documentElement.lang || navigator.language || 'es';
  if (lang.startsWith('en')) {
    return {
      eyebrow: 'Request guide',
      title: 'Tell drivers what route you need',
      desc: 'Add origin, destination, time, seats and a fair suggested price. Drivers will be able to find your request.',
      step1: 'Route',
      step2: 'Time',
      step3: 'Price',
      myRequests: 'My requests',
    };
  }
  if (lang.startsWith('ar')) {
    return {
      eyebrow: 'دليل الطلب',
      title: 'أخبر السائقين بالمسار الذي تحتاجه',
      desc: 'أضف نقطة الانطلاق والوجهة والوقت والمقاعد وسعرًا مناسبًا. سيتمكن السائقون من العثور على طلبك.',
      step1: 'المسار',
      step2: 'الوقت',
      step3: 'السعر',
      myRequests: 'طلباتي',
    };
  }
  return {
    eyebrow: 'Guía rápida',
    title: 'Di a los conductores qué ruta necesitas',
    desc: 'Añade origen, destino, hora, plazas y un precio razonable. Así los conductores podrán encontrarte.',
    step1: 'Ruta',
    step2: 'Hora',
    step3: 'Precio',
    myRequests: 'Mis solicitudes',
  };
};

const injectRequestGuide = () => {
  if (window.location.pathname !== '/request') return;
  if (document.querySelector('[data-shareway-request-guide]')) return;

  const form = document.querySelector('main form');
  if (!form) return;

  const copy = getRequestGuideCopy();
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-shareway-request-guide', 'true');
  wrapper.className = 'rounded-[2.5rem] bg-white border border-slate-100 shadow-xl p-5 space-y-4 text-left';
  wrapper.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-[9px] font-black uppercase tracking-[0.25em] text-orange-500">${copy.eyebrow}</p>
        <h2 class="mt-1 text-xl font-black italic uppercase tracking-tighter text-slate-900 leading-none">${copy.title}</h2>
        <p class="mt-2 text-[11px] font-bold text-slate-400 leading-relaxed">${copy.desc}</p>
      </div>
      <button type="button" data-shareway-nav="/my-requests?tab=active" class="shrink-0 h-11 px-3 rounded-2xl bg-slate-900 text-white text-[8px] font-black uppercase tracking-widest active:scale-95 transition-all">${copy.myRequests}</button>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <div class="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-center"><p class="text-lg font-black text-slate-900">1</p><p class="text-[8px] font-black uppercase tracking-widest text-slate-400">${copy.step1}</p></div>
      <div class="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-center"><p class="text-lg font-black text-slate-900">2</p><p class="text-[8px] font-black uppercase tracking-widest text-slate-400">${copy.step2}</p></div>
      <div class="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-center"><p class="text-lg font-black text-slate-900">3</p><p class="text-[8px] font-black uppercase tracking-widest text-slate-400">${copy.step3}</p></div>
    </div>
  `;
  form.prepend(wrapper);
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
      clickTabByLabels(getActivityTabLabel(targetTab));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const targetTab = params.get('tab');
    if (location.pathname !== '/my-requests' || !targetTab) return undefined;

    const timer = window.setTimeout(() => {
      clickTabByLabels(getRequestTabLabel(targetTab));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (location.pathname !== '/my-rides') return undefined;
    const timer = window.setTimeout(injectActivityEmptyStateCtas, 350);
    const observer = new MutationObserver(() => injectActivityEmptyStateCtas());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (location.pathname !== '/request') return undefined;
    const timer = window.setTimeout(injectRequestGuide, 350);
    const observer = new MutationObserver(() => injectRequestGuide());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleClick = (event) => {
      const injectedNav = event.target?.closest?.('[data-shareway-nav]');
      if (injectedNav) {
        event.preventDefault();
        event.stopPropagation();
        window.location.assign(injectedNav.getAttribute('data-shareway-nav'));
        return;
      }

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
