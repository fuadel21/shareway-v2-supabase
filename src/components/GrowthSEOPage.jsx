import React, { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Car, Copy, Leaf, MapPin, Plane, Route, Share2, ShieldCheck, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { airportPages, cityToPath, findCity, findRoute, popularRoutes, routeToPath, seoFaqs } from '@/data/growthSeoData';

const SITE_URL = 'https://www.shareway.es';

const setMeta = (name, content, property = false) => {
  const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  let tag = document.querySelector(selector);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(property ? 'property' : 'name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
};

const updateCanonical = (url) => {
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', url);
};

const upsertJsonLd = (id, payload) => {
  let script = document.getElementById(id);
  if (!script) {
    script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(payload);
};

const formatCity = (slug) => findCity(slug)?.name || slug?.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

const getRoutePage = (originSlug, destinationSlug) => {
  const origin = formatCity(originSlug);
  const destination = formatCity(destinationSlug);
  const route = findRoute(originSlug, destinationSlug) || { origin: originSlug, destination: destinationSlug, distanceKm: null, demand: 'creciente', angle: 'ruta compartida' };

  return {
    type: 'route',
    icon: Route,
    eyebrow: 'Ruta compartida popular',
    title: `Compartir coche de ${origin} a ${destination} | ShareWay`,
    h1: `Compartir coche de ${origin} a ${destination}`,
    description: `Encuentra o publica viajes compartidos de ${origin} a ${destination}. Ahorra dinero, reparte gastos y coordina rutas compatibles con ShareWay.`,
    canonicalPath: routeToPath(route),
    primaryCta: 'Buscar esta ruta',
    secondaryCta: 'Publicar viaje',
    shareText: `Mira esta ruta para compartir coche de ${origin} a ${destination} en ShareWay`,
    stats: [
      ['Ruta', `${origin} → ${destination}`],
      ['Demanda', route.demand],
      ['Distancia', route.distanceKm ? `${route.distanceKm} km aprox.` : 'Variable'],
      ['Uso', route.angle]
    ],
    sections: [
      `La ruta ${origin} - ${destination} es una buena oportunidad para compartir gastos cuando varias personas tienen horarios o destinos compatibles.`,
      'ShareWay permite publicar trayectos, buscar plazas disponibles y coordinar detalles antes del viaje.',
      'Esta página está preparada para mostrar viajes reales de la ruta cuando haya actividad disponible en la plataforma.'
    ],
    relatedLinks: popularRoutes.filter((item) => item.origin !== originSlug || item.destination !== destinationSlug).slice(0, 6).map((item) => ({ href: routeToPath(item), label: `${formatCity(item.origin)} → ${formatCity(item.destination)}` }))
  };
};

const getCityPage = (citySlug) => {
  const city = findCity(citySlug);
  const name = city?.name || formatCity(citySlug);
  const cityRoutes = popularRoutes.filter((route) => route.origin === citySlug || route.destination === citySlug).slice(0, 6);
  const nearby = (city?.nearby || []).slice(0, 6).map((slug) => ({ href: cityToPath({ slug }), label: formatCity(slug) }));

  return {
    type: 'city',
    icon: MapPin,
    eyebrow: `Carpooling en ${name}`,
    title: `Compartir coche en ${name} | ShareWay`,
    h1: `Compartir coche en ${name}`,
    description: `Comparte coche, gastos y rutas compatibles en ${name}. Encuentra trayectos al trabajo, universidad, aeropuertos y ciudades cercanas con ShareWay.`,
    canonicalPath: cityToPath({ slug: citySlug }),
    primaryCta: `Buscar viajes en ${name}`,
    secondaryCta: 'Publicar trayecto',
    shareText: `Mira ShareWay para compartir coche en ${name}`,
    stats: [
      ['Ciudad', name],
      ['Zona', city?.region || 'España'],
      ['Uso principal', 'Trabajo, universidad y viajes'],
      ['Modelo', 'Compartir gastos']
    ],
    sections: [
      `${name} concentra desplazamientos diarios, viajes interurbanos y rutas frecuentes que pueden organizarse mejor compartiendo coche.`,
      'ShareWay ayuda a conectar conductores y pasajeros con trayectos compatibles para reducir costes y emisiones.',
      'La página enlaza rutas relevantes y ciudades cercanas para facilitar la navegación interna y la indexación SEO.'
    ],
    relatedLinks: cityRoutes.length > 0 ? cityRoutes.map((item) => ({ href: routeToPath(item), label: `${formatCity(item.origin)} → ${formatCity(item.destination)}` })) : nearby
  };
};

const getAirportPage = (airportSlug) => {
  const airport = airportPages.find((item) => item.slug === airportSlug);
  const city = airport ? formatCity(airport.city) : 'tu ciudad';
  const name = airport?.name || formatCity(airportSlug);

  return {
    type: 'airport',
    icon: Plane,
    eyebrow: 'Compartir trayecto al aeropuerto',
    title: `Compartir coche al ${name} | ShareWay`,
    h1: `Compartir coche al ${name}`,
    description: `Coordina trayectos compartidos al ${name}. Encuentra personas con horarios compatibles, reparte gastos y llega al aeropuerto con ShareWay.`,
    canonicalPath: `/aeropuertos/${airportSlug}/`,
    primaryCta: 'Buscar trayecto al aeropuerto',
    secondaryCta: 'Publicar salida',
    shareText: `Mira esta página para compartir coche al ${name} con ShareWay`,
    stats: [
      ['Destino', name],
      ['Ciudad base', city],
      ['Uso principal', 'Aeropuerto'],
      ['Ahorro', 'Gastos compartidos']
    ],
    sections: [
      `Los desplazamientos al ${name} suelen tener horarios concentrados y son ideales para coordinar viajes compartidos.`,
      'Con ShareWay puedes encontrar personas con vuelos cercanos en horario o con rutas compatibles hacia el aeropuerto.',
      'Compartir el trayecto permite reducir costes, emisiones y viajes duplicados.'
    ],
    relatedLinks: popularRoutes.filter((route) => route.origin === airport?.city || route.destination === airport?.city).slice(0, 6).map((item) => ({ href: routeToPath(item), label: `${formatCity(item.origin)} → ${formatCity(item.destination)}` }))
  };
};

const GrowthSEOPage = ({ pageType }) => {
  const params = useParams();

  const page = useMemo(() => {
    if (pageType === 'route') return getRoutePage(params.origin, params.destination);
    if (pageType === 'airport') return getAirportPage(params.slug);
    return getCityPage(params.slug);
  }, [pageType, params.origin, params.destination, params.slug]);

  const canonicalUrl = `${SITE_URL}${page.canonicalPath}`;
  const Icon = page.icon;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(canonicalUrl);
      toast.success('Enlace copiado');
    } catch (error) {
      toast.error('No se pudo copiar el enlace');
    }
  };

  const handleNativeShare = async () => {
    const payload = { title: page.title, text: page.shareText || page.description, url: canonicalUrl };
    if (navigator.share) {
      try {
        await navigator.share(payload);
      } catch (error) {
        if (error?.name !== 'AbortError') toast.error('No se pudo compartir');
      }
    } else {
      handleCopyLink();
    }
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${page.shareText || page.description}\n${canonicalUrl}`)}`;

  useEffect(() => {
    document.title = page.title;
    setMeta('description', page.description);
    setMeta('robots', 'index, follow');
    setMeta('og:title', page.title, true);
    setMeta('og:description', page.description, true);
    setMeta('og:url', canonicalUrl, true);
    setMeta('twitter:title', page.title);
    setMeta('twitter:description', page.description);
    updateCanonical(canonicalUrl);

    upsertJsonLd('shareway-growth-jsonld', {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${SITE_URL}/#organization`,
          name: 'ShareWay',
          url: SITE_URL,
          description: 'Plataforma para compartir coche, rutas y gastos de trayecto entre usuarios con desplazamientos compatibles.'
        },
        {
          '@type': 'WebPage',
          '@id': `${canonicalUrl}#webpage`,
          url: canonicalUrl,
          name: page.title,
          description: page.description,
          isPartOf: { '@id': `${SITE_URL}/#website` },
          about: { '@id': `${SITE_URL}/#organization` }
        },
        {
          '@type': 'FAQPage',
          mainEntity: seoFaqs.map(([question, answer]) => ({
            '@type': 'Question',
            name: question,
            acceptedAnswer: { '@type': 'Answer', text: answer }
          }))
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_URL },
            { '@type': 'ListItem', position: 2, name: pageType === 'route' ? 'Rutas' : pageType === 'airport' ? 'Aeropuertos' : 'Ciudades', item: `${SITE_URL}/${pageType === 'route' ? 'rutas' : pageType === 'airport' ? 'aeropuertos' : 'ciudades'}/` },
            { '@type': 'ListItem', position: 3, name: page.h1, item: canonicalUrl }
          ]
        }
      ]
    });
  }, [page, canonicalUrl, pageType]);

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/90 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link to="/" className="text-xl font-black tracking-tight">ShareWay</Link>
          <nav className="flex items-center gap-3 text-sm font-black">
            <Link to="/carpooling/" className="hidden text-slate-600 hover:text-slate-950 sm:inline">Carpooling</Link>
            <Link to="/rutas/" className="hidden text-slate-600 hover:text-slate-950 sm:inline">Rutas</Link>
            <Link to="/login" className="rounded-full border px-4 py-2">Entrar</Link>
            <Link to="/register" className="rounded-full bg-orange-500 px-4 py-2 text-white">Crear cuenta</Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden bg-slate-950 px-5 py-16 text-white sm:py-24">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,#22c55e,transparent_35%),radial-gradient(circle_at_bottom_left,#f97316,transparent_35%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.25em] text-emerald-300">
              <Icon className="h-4 w-4" /> {page.eyebrow}
            </p>
            <h1 className="max-w-4xl text-4xl font-black leading-[0.95] tracking-tighter sm:text-6xl">{page.h1}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">{page.description}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/register" className="inline-flex h-14 items-center justify-center rounded-2xl bg-emerald-500 px-6 font-black uppercase tracking-widest text-white hover:bg-emerald-600">
                {page.primaryCta} <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
              <Link to="/publish" className="inline-flex h-14 items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-6 font-black uppercase tracking-widest text-white hover:bg-white/20">
                {page.secondaryCta}
              </Link>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button onClick={handleNativeShare} className="inline-flex h-12 items-center justify-center rounded-2xl bg-white/10 px-4 text-xs font-black uppercase tracking-normal text-white hover:bg-white/20">
                <Share2 className="mr-2 h-4 w-4" /> Compartir
              </button>
              <a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center rounded-2xl bg-emerald-500/20 px-4 text-xs font-black uppercase tracking-widest text-emerald-200 hover:bg-emerald-500/30">
                WhatsApp
              </a>
              <button onClick={handleCopyLink} className="inline-flex h-12 items-center justify-center rounded-2xl border border-white/15 px-4 text-xs font-black uppercase tracking-normal text-white hover:bg-white/10">
                <Copy className="mr-2 h-4 w-4" /> Copiar enlace
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl backdrop-blur-xl">
            <div className="grid gap-3 sm:grid-cols-2">
              {page.stats.map(([label, value]) => (
                <article key={label} className="rounded-3xl bg-white p-5 text-slate-950">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                  <p className="mt-2 text-lg font-black tracking-tight">{value}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 py-16">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-3">
          {[
            [Car, 'Rutas compatibles', page.sections[0]],
            [Wallet, 'Ahorro en gastos', page.sections[1]],
            [Leaf, 'Menos emisiones', page.sections[2]]
          ].map(([SectionIcon, title, text]) => (
            <article key={title} className="rounded-3xl border border-slate-100 bg-slate-50 p-7">
              <SectionIcon className="mb-4 h-7 w-7 text-emerald-600" />
              <h2 className="text-xl font-black tracking-tight">{title}</h2>
              <p className="mt-3 leading-7 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="px-5 pb-16">
        <div className="mx-auto max-w-6xl rounded-3xl bg-orange-50 p-7 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-600">Enlaces internos</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight">Rutas y zonas relacionadas</h2>
              <p className="mt-4 leading-8 text-slate-600">Explora trayectos conectados para encontrar alternativas y reforzar la navegación entre páginas relevantes.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {page.relatedLinks.map((item) => (
                <Link key={item.href} to={item.href} className="rounded-2xl bg-white p-4 font-black text-slate-800 shadow-sm hover:text-orange-600">
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 pb-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-3xl font-black tracking-tight">Preguntas frecuentes</h2>
          <div className="mt-7 grid gap-4 md:grid-cols-2">
            {seoFaqs.map(([question, answer]) => (
              <article key={question} className="rounded-3xl border border-slate-100 p-6">
                <h3 className="font-black">{question}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{answer}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 pb-20">
        <div className="mx-auto max-w-6xl rounded-3xl bg-slate-950 p-8 text-white sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <ShieldCheck className="mb-4 h-8 w-8 text-emerald-400" />
              <h2 className="text-3xl font-black tracking-tight">Empieza con ShareWay</h2>
              <p className="mt-3 max-w-2xl text-white/70">Crea una cuenta gratis, publica una ruta o busca trayectos compatibles para ahorrar compartiendo gastos.</p>
            </div>
            <Link to="/register" className="inline-flex h-14 shrink-0 items-center justify-center rounded-2xl bg-orange-500 px-6 font-black uppercase tracking-widest text-white">Crear cuenta</Link>
          </div>
        </div>
      </section>
    </main>
  );
};

export default GrowthSEOPage;
