import React, { useEffect, useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, BookOpen, CheckCircle2, HelpCircle, MapPin, Route } from 'lucide-react';
import { findSeoGuide, guideToPath, seoGuides } from '@/data/seoGuidesData';

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

function GuideSEOPage() {
  const { slug } = useParams();
  const guide = useMemo(() => findSeoGuide(slug), [slug]);

  if (!guide) return <Navigate to="/" replace />;

  const canonicalUrl = `${SITE_URL}${guideToPath(guide)}`;
  const relatedGuides = seoGuides.filter((item) => item.slug !== guide.slug).slice(0, 5);

  useEffect(() => {
    document.title = guide.title;
    setMeta('description', guide.description);
    setMeta('robots', 'index, follow');
    setMeta('og:title', guide.title, true);
    setMeta('og:description', guide.description, true);
    setMeta('og:url', canonicalUrl, true);
    setMeta('twitter:title', guide.title);
    setMeta('twitter:description', guide.description);
    updateCanonical(canonicalUrl);

    upsertJsonLd('shareway-guide-jsonld', {
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
          '@type': 'Article',
          '@id': `${canonicalUrl}#article`,
          headline: guide.h1,
          description: guide.description,
          url: canonicalUrl,
          author: { '@id': `${SITE_URL}/#organization` },
          publisher: { '@id': `${SITE_URL}/#organization` },
          mainEntityOfPage: canonicalUrl
        },
        {
          '@type': 'FAQPage',
          mainEntity: guide.faqs.map(([question, answer]) => ({
            '@type': 'Question',
            name: question,
            acceptedAnswer: { '@type': 'Answer', text: answer }
          }))
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_URL },
            { '@type': 'ListItem', position: 2, name: 'Guías', item: `${SITE_URL}/guias/` },
            { '@type': 'ListItem', position: 3, name: guide.h1, item: canonicalUrl }
          ]
        }
      ]
    });
  }, [guide, canonicalUrl]);

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/90 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link to="/" className="text-xl font-black tracking-tight">ShareWay</Link>
          <nav className="flex items-center gap-3 text-sm font-black">
            <Link to="/rutas/" className="hidden text-slate-600 hover:text-slate-950 sm:inline">Rutas</Link>
            <Link to="/ciudades/barcelona/" className="hidden text-slate-600 hover:text-slate-950 sm:inline">Barcelona</Link>
            <Link to="/login" className="rounded-full border px-4 py-2">Entrar</Link>
            <Link to="/register" className="rounded-full bg-orange-500 px-4 py-2 text-white">Crear cuenta</Link>
          </nav>
        </div>
      </header>

      <section className="bg-slate-950 px-5 py-16 text-white sm:py-24">
        <div className="mx-auto max-w-5xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.25em] text-orange-300">
            <BookOpen className="h-4 w-4" /> Guía ShareWay
          </p>
          <h1 className="mt-6 max-w-4xl text-4xl font-black leading-[0.95] tracking-tighter sm:text-6xl">{guide.h1}</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">{guide.description}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to={guide.routeHref} className="inline-flex h-14 items-center justify-center rounded-2xl bg-orange-500 px-6 font-black uppercase tracking-widest text-white hover:bg-orange-600">
              Ver ruta <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
            <Link to="/register" className="inline-flex h-14 items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-6 font-black uppercase tracking-widest text-white hover:bg-white/20">
              Crear cuenta gratis
            </Link>
          </div>
        </div>
      </section>

      <section className="px-5 py-14">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1fr_320px]">
          <article className="space-y-8">
            <div className="rounded-3xl border border-slate-100 p-7 shadow-sm">
              <p className="text-sm font-black uppercase tracking-widest text-orange-500">{guide.area}</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight">Por qué esta ruta puede funcionar compartiendo coche</h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">{guide.intro}</p>
            </div>

            <div className="rounded-3xl bg-slate-50 p-7">
              <h2 className="text-3xl font-black tracking-tight">Consejos para organizar el trayecto</h2>
              <div className="mt-6 space-y-4">
                {guide.points.map((point) => (
                  <div key={point} className="flex gap-3 rounded-3xl bg-white p-5 shadow-sm">
                    <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-orange-500" />
                    <p className="leading-7 text-slate-700">{point}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-100 p-7">
              <h2 className="text-3xl font-black tracking-tight">Preguntas frecuentes</h2>
              <div className="mt-6 space-y-4">
                {guide.faqs.map(([question, answer]) => (
                  <article key={question} className="rounded-3xl bg-slate-50 p-6">
                    <h3 className="flex items-start gap-2 text-xl font-black"><HelpCircle className="mt-1 h-5 w-5 text-orange-500" /> {question}</h3>
                    <p className="mt-3 leading-7 text-slate-600">{answer}</p>
                  </article>
                ))}
              </div>
            </div>
          </article>

          <aside className="space-y-5">
            <div className="rounded-3xl bg-orange-500 p-6 text-white">
              <h2 className="text-2xl font-black">Ruta relacionada</h2>
              <p className="mt-2 text-white/80">{guide.intent}</p>
              <Link to={guide.routeHref} className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-white px-5 py-4 font-black text-orange-600">
                <Route className="mr-2 h-5 w-5" /> {guide.routeLabel}
              </Link>
            </div>
            <div className="rounded-3xl border border-slate-100 p-6 shadow-sm">
              <h2 className="text-2xl font-black">Ciudad relacionada</h2>
              <Link to={guide.cityHref} className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-4 font-black text-white">
                <MapPin className="mr-2 h-5 w-5" /> {guide.cityLabel}
              </Link>
            </div>
            <div className="rounded-3xl bg-slate-50 p-6">
              <h2 className="text-2xl font-black">Más guías</h2>
              <div className="mt-5 space-y-3">
                {relatedGuides.map((item) => (
                  <Link key={item.slug} to={guideToPath(item)} className="block rounded-2xl bg-white p-4 text-sm font-black shadow-sm hover:shadow-md">
                    {item.h1}
                  </Link>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

export default GuideSEOPage;
