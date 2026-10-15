import React, { useEffect, useMemo } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { ArrowRight, Car, Leaf, MapPin, Plane, Route, ShieldCheck, Users, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { airportPages, airportToPath, cityToPath, findCity, findRoute, popularCities, popularRoutes, routeToPath, seoFaqs } from '@/data/growthSeoData.js';

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

const setCanonical = (url) => {
  let tag = document.querySelector('link[rel="canonical"]');
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', 'canonical');
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', url);
};

const setJsonLd = (id, data) => {
  let tag = document.getElementById(id);
  if (!tag) {
    tag = document.createElement('script');
    tag.id = id;
    tag.type = 'application/ld+json';
    document.head.appendChild(tag);
  }
  tag.textContent = JSON.stringify(data);
};

const removeJsonLd = (id) => {
  const tag = document.getElementById(id);
  if (tag) tag.remove();
};

const slugToCity = (slug) => findCity(slug) || { slug, name: slug?.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') };

const Metric = ({ value, label }) => (
  <div className="rounded-3xl bg-white p-5 shadow-sm border border-slate-100">
    <p className="text-3xl font-black tracking-tighter text-slate-950">{value}</p>
    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
  </div>
);

const FAQBlock = ({ faqs }) => (
  <section className="px-6 py-16 bg-slate-50">
    <div className="mx-auto max-w-5xl">
      <h2 className="text-3xl font-black tracking-tight">Preguntas frecuentes</h2>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {faqs.map(([question, answer]) => (
          <article key={question} className="rounded-3xl bg-white p-6 border border-slate-100">
            <h3 className="font-black text-slate-950">{question}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">{answer}</p>
          </article>
        ))}
      </div>
    </div>
  </section>
);

const InternalLinks = () => (
  <section className="px-6 py-16">
    <div className="mx-auto max-w-5xl grid gap-8 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <p className="text-sm font-black uppercase tracking-widest text-orange-500">Explorar ShareWay</p>
        <h2 className="mt-3 text-3xl font-black tracking-tight">Rutas y ciudades con demanda</h2>
      </div>
      <div className="lg:col-span-2 grid gap-3 sm:grid-cols-2">
        {popularRoutes.slice(0, 8).map((route) => {
          const origin = slugToCity(route.origin);
          const destination = slugToCity(route.destination);
          return <Link key={`${route.origin}-${route.destination}`} to={routeToPath(route)} className="rounded-2xl border border-slate-100 p-4 font-black hover:border-orange-200 hover:bg-orange-50 transition-colors">{origin.name} → {destination.name}</Link>;
        })}
        {popularCities.slice(0, 8).map((city) => <Link key={city.slug} to={cityToPath(city)} className="rounded-2xl border border-slate-100 p-4 font-black hover:border-emerald-200 hover:bg-emerald-50 transition-colors">Compartir coche en {city.name}</Link>)}
      </div>
    </div>
  </section>
);

const GrowthSEOLandingPage = ({ type }) => {
  const params = useParams();

  const page = useMemo(() => {
    if (type === 'city') {
      const city = findCity(params.citySlug);
      if (!city) return null;
      return {
        canonical: `${SITE_URL}${cityToPath(city)}`,
        title: `Compartir coche en ${city.name} | ShareWay`,
        description: `Encuentra rutas para compartir coche en ${city.name}. Ahorra en trayectos al trabajo, universidad, aeropuerto y viajes frecuentes con usuarios compatibles.`,
        h1: `Compartir coche en ${city.name}`,
        eyebrow: `${city.region || 'España'} · Carpooling local`,
        icon: MapPin,
        intro: `ShareWay conecta personas que se mueven por ${city.name} y alrededores para organizar trayectos compatibles, dividir gastos y reducir desplazamientos duplicados.`,
        metrics: [['30-60%', 'ahorro potencial'], ['24/7', 'rutas publicables'], ['CO₂', 'menos emisiones']],
        faqs: [
          [`¿Cómo encontrar viajes compartidos en ${city.name}?`, `Puedes registrarte gratis, buscar rutas activas o publicar tu propio trayecto desde ${city.name}.`],
          [`¿Sirve para ir al trabajo en ${city.name}?`, `Sí. ShareWay está pensado para rutas recurrentes hacia oficinas, universidades, hospitales, estaciones y polígonos.`],
          ...seoFaqs
        ]
      };
    }

    if (type === 'route') {
      const route = findRoute(params.originSlug, params.destinationSlug);
      const origin = slugToCity(params.originSlug);
      const destination = slugToCity(params.destinationSlug);
      if (!route) return null;
      return {
        canonical: `${SITE_URL}${routeToPath(route)}`,
        title: `${origin.name} a ${destination.name} compartiendo coche | ShareWay`,
        description: `Comparte coche de ${origin.name} a ${destination.name}. Encuentra trayectos compatibles, reparte gastos y viaja de forma más económica y sostenible.`,
        h1: `${origin.name} → ${destination.name} compartiendo coche`,
        eyebrow: `${route.distanceKm} km aprox. · demanda ${route.demand}`,
        icon: Route,
        intro: `La ruta ${origin.name} - ${destination.name} es una oportunidad para ahorrar en ${route.angle}, aprovechar plazas libres y coordinar horarios compatibles.`,
        metrics: [[`${route.distanceKm} km`, 'distancia aprox.'], ['30-60%', 'ahorro potencial'], ['CO₂', 'menos emisiones']],
        faqs: [
          [`¿Cómo compartir coche de ${origin.name} a ${destination.name}?`, 'Publica tu trayecto o busca una plaza disponible en ShareWay y coordina punto de encuentro, hora y destino.'],
          [`¿Cuánto puedo ahorrar en la ruta ${origin.name} - ${destination.name}?`, 'Depende de pasajeros, combustible, peajes y gastos acordados, pero compartir puede reducir de forma importante el coste individual.'],
          ...seoFaqs
        ]
      };
    }

    if (type === 'airport') {
      const airport = airportPages.find((item) => item.slug === params.airportSlug);
      if (!airport) return null;
      const city = slugToCity(airport.city);
      return {
        canonical: `${SITE_URL}${airportToPath(airport)}`,
        title: `Compartir coche al ${airport.name} | ShareWay`,
        description: `Coordina trayectos compartidos al ${airport.name}. Encuentra personas con horarios compatibles y divide gastos de desplazamiento al aeropuerto.`,
        h1: `Compartir trayecto al ${airport.name}`,
        eyebrow: `${city.name} · aeropuerto · ahorro`,
        icon: Plane,
        intro: `Los trayectos al ${airport.name} suelen ser más eficientes cuando varias personas coordinan horarios compatibles y comparten gastos.`,
        metrics: [['Vuelos', 'horarios compatibles'], ['30-60%', 'ahorro potencial'], ['CO₂', 'menos emisiones']],
        faqs: [
          [`¿Puedo compartir coche al ${airport.name}?`, `Sí. Puedes buscar usuarios que viajen al ${airport.name} con horarios similares.`],
          ['¿Es útil para salidas muy temprano o llegadas tarde?', 'Sí. Publicar la ruta con antelación aumenta las posibilidades de encontrar personas compatibles.'],
          ...seoFaqs
        ]
      };
    }

    return null;
  }, [params, type]);

  useEffect(() => {
    if (!page) return;
    document.title = page.title;
    setMeta('description', page.description);
    setMeta('og:title', page.title, true);
    setMeta('og:description', page.description, true);
    setMeta('og:url', page.canonical, true);
    setMeta('twitter:title', page.title);
    setMeta('twitter:description', page.description);
    setCanonical(page.canonical);
    setJsonLd('growth-page-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
      description: page.description,
      url: page.canonical,
      publisher: { '@type': 'Organization', name: 'ShareWay', url: SITE_URL }
    });
    setJsonLd('growth-faq-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faqs.map(([question, answer]) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: { '@type': 'Answer', text: answer }
      }))
    });
    return () => {
      removeJsonLd('growth-page-jsonld');
      removeJsonLd('growth-faq-jsonld');
    };
  }, [page]);

  if (!page) return <Navigate to="/" replace />;
  const Icon = page.icon;

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link to="/" className="text-xl font-black tracking-tight">ShareWay</Link>
          <nav className="flex items-center gap-3 text-sm font-black">
            <Link to="/rutas/" className="hidden text-slate-600 hover:text-slate-950 sm:inline">Rutas</Link>
            <Link to="/carpooling/" className="hidden text-slate-600 hover:text-slate-950 sm:inline">Carpooling</Link>
            <Link to="/login" className="rounded-full border px-4 py-2">Entrar</Link>
            <Link to="/register" className="rounded-full bg-orange-500 px-4 py-2 text-white">Crear cuenta</Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden bg-slate-950 px-6 py-20 text-white sm:py-28">
        <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_top_right,#22c55e,transparent_35%),radial-gradient(circle_at_bottom_left,#f97316,transparent_30%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div className="space-y-7">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.25em] text-emerald-300"><Icon className="h-4 w-4" />{page.eyebrow}</p>
            <h1 className="text-4xl font-black tracking-tighter sm:text-6xl leading-[0.95]">{page.h1}</h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-300">{page.intro}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-14 rounded-2xl bg-orange-500 hover:bg-orange-600 font-black uppercase tracking-widest text-white"><Link to="/register">Crear cuenta gratis <ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
              <Button asChild variant="outline" className="h-14 rounded-2xl border-white/20 bg-white/10 text-white hover:bg-white/20 font-black uppercase tracking-widest"><Link to="/login">Entrar</Link></Button>
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              {page.metrics.map(([value, label]) => <Metric key={label} value={value} label={label} />)}
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-6xl grid gap-6 md:grid-cols-3">
          {[
            [Car, 'Publica o busca trayectos', 'Crea una ruta en segundos y encuentra personas con horarios compatibles.'],
            [Wallet, 'Divide gastos', 'Comparte combustible, peajes o desplazamientos frecuentes de forma transparente.'],
            [ShieldCheck, 'Confianza y control', 'Perfiles, chat privado y herramientas de seguridad para coordinar mejor.']
          ].map(([CardIcon, title, text]) => <article key={title} className="rounded-3xl border border-slate-100 bg-slate-50 p-7"><CardIcon className="mb-4 h-7 w-7 text-orange-500" /><h2 className="text-xl font-black tracking-tight">{title}</h2><p className="mt-3 leading-7 text-slate-600">{text}</p></article>)}
        </div>
      </section>

      <InternalLinks />
      <FAQBlock faqs={page.faqs} />

      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl rounded-3xl bg-slate-950 p-8 text-white sm:p-10">
          <p className="text-sm font-black uppercase tracking-widest text-orange-400">Empieza ahora</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight">Convierte tu próximo trayecto en una ruta compartida</h2>
          <p className="mt-4 max-w-2xl leading-8 text-white/70">Publica una ruta, busca una plaza o crea una solicitud para que otros usuarios compatibles puedan encontrarte.</p>
          <Link to="/register" className="mt-6 inline-flex rounded-full bg-orange-500 px-6 py-4 font-black text-white">Crear cuenta gratis</Link>
        </div>
      </section>
    </main>
  );
};

export default GrowthSEOLandingPage;
