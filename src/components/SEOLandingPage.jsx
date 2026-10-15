import React, { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Car, Leaf, MapPin, ShieldCheck, Users, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';

const cities = {
    madrid: 'Madrid',
    barcelona: 'Barcelona',
    valencia: 'Valencia',
    sevilla: 'Sevilla',
    malaga: 'Málaga',
    alicante: 'Alicante',
    bilbao: 'Bilbao',
    zaragoza: 'Zaragoza'
};

const intentConfig = {
    'compartir-coche': {
        keyword: 'compartir coche',
        h1: 'Compartir coche en España con rutas compatibles',
        title: 'Compartir coche en España | ShareWay',
        description: 'Comparte coche con personas que hacen trayectos compatibles. Ahorra dinero, reduce emisiones y organiza viajes al trabajo, universidad, aeropuertos y rutas frecuentes.',
        intro: 'ShareWay te ayuda a encontrar personas con rutas compatibles para compartir coche de forma sencilla y segura.',
        cta: 'Empezar a compartir coche'
    },
    carpooling: {
        keyword: 'carpooling',
        h1: 'Carpooling en España para ahorrar en tus trayectos',
        title: 'Carpooling en España | ShareWay',
        description: 'Plataforma de carpooling para compartir trayectos con personas de rutas compatibles en España. Ideal para trabajo, universidad, aeropuerto y viajes frecuentes.',
        intro: 'El carpooling permite aprovechar plazas libres y dividir gastos entre personas que van en la misma dirección.',
        cta: 'Buscar rutas compatibles'
    },
    'viajes-compartidos': {
        keyword: 'viajes compartidos',
        h1: 'Viajes compartidos para moverte mejor y gastar menos',
        title: 'Viajes compartidos en España | ShareWay',
        description: 'Organiza viajes compartidos con usuarios de rutas compatibles. ShareWay facilita trayectos al trabajo, universidad, aeropuertos y rutas habituales.',
        intro: 'Con ShareWay puedes publicar o encontrar viajes compartidos y conectar con personas que tienen horarios y rutas parecidas.',
        cta: 'Publicar o buscar viaje'
    },
    'rutas-compartidas': {
        keyword: 'rutas compartidas',
        h1: 'Rutas compartidas para trabajo, universidad y aeropuertos',
        title: 'Rutas compartidas en España | ShareWay',
        description: 'Encuentra rutas compartidas y personas con trayectos compatibles. Ahorra en desplazamientos frecuentes y reduce emisiones.',
        intro: 'Las rutas compartidas son una alternativa práctica para trayectos repetidos o desplazamientos con origen y destino similares.',
        cta: 'Crear ruta compartida'
    },
    'compartir-trayecto': {
        keyword: 'compartir trayecto',
        h1: 'Compartir trayecto con personas de ruta compatible',
        title: 'Compartir trayecto | ShareWay',
        description: 'Comparte trayectos con personas que se mueven por zonas compatibles. Divide gastos y viaja acompañado con ShareWay.',
        intro: 'ShareWay está pensado para conectar trayectos compatibles y convertir desplazamientos individuales en rutas compartidas.',
        cta: 'Compartir trayecto'
    },
    'taxi-compartido': {
        keyword: 'taxi compartido',
        h1: 'Taxi compartido y trayectos coordinados con rutas compatibles',
        title: 'Taxi compartido y trayectos compartidos | ShareWay',
        description: 'Coordina trayectos compartidos y divide gastos en rutas compatibles. Útil para aeropuertos, eventos y desplazamientos frecuentes.',
        intro: 'ShareWay no es una empresa de taxi: es una plataforma para conectar personas que quieren coordinar desplazamientos compatibles y compartir costes.',
        cta: 'Buscar trayecto compartido'
    },
    'compartir-taxi-aeropuerto': {
        keyword: 'compartir taxi aeropuerto',
        h1: 'Compartir taxi al aeropuerto con personas de horario compatible',
        title: 'Compartir taxi al aeropuerto | ShareWay',
        description: 'Encuentra personas con horarios compatibles para compartir trayectos hacia aeropuertos. Ahorra y coordina tu desplazamiento con ShareWay.',
        intro: 'Los trayectos al aeropuerto suelen ser más baratos y cómodos cuando se coordinan con personas que viajan a horas similares.',
        cta: 'Buscar ruta al aeropuerto'
    },
    'compartir-taxi-barato': {
        keyword: 'compartir taxi barato',
        h1: 'Compartir taxi barato dividiendo gastos de trayecto',
        title: 'Compartir taxi barato | ShareWay',
        description: 'Divide gastos en trayectos compatibles y encuentra alternativas para ahorrar en desplazamientos urbanos, aeropuertos y rutas frecuentes.',
        intro: 'Compartir costes puede ayudarte a moverte mejor sin pagar todo el trayecto tú solo.',
        cta: 'Ahorrar en trayectos'
    },
    'ahorrar-compartiendo-taxi': {
        keyword: 'ahorrar compartiendo taxi',
        h1: 'Ahorrar compartiendo taxi y trayectos compatibles',
        title: 'Ahorrar compartiendo taxi | ShareWay',
        description: 'ShareWay ayuda a coordinar rutas compatibles para compartir gastos en trayectos urbanos, aeropuertos y desplazamientos habituales.',
        intro: 'Si varias personas van hacia zonas similares, compartir el trayecto puede reducir el coste individual y las emisiones.',
        cta: 'Empezar a ahorrar'
    }
};

const purposeConfig = {
    trabajo: {
        label: 'trabajo',
        phrase: 'para ir al trabajo',
        benefit: 'ideal para desplazamientos diarios, turnos similares y rutas repetidas entre casa y oficina'
    },
    universidad: {
        label: 'universidad',
        phrase: 'para ir a la universidad',
        benefit: 'útil para estudiantes, campus universitarios y horarios compartidos'
    }
};

const getPageConfig = (pathname) => {
    const slug = pathname.replace(/^\//, '').replace(/\/$/, '') || 'compartir-coche';
    const parts = slug.split('-');
    const cityKey = parts.find((part) => cities[part]);
    const purposeKey = parts.find((part) => purposeConfig[part]);
    const baseKey = Object.keys(intentConfig)
        .sort((a, b) => b.length - a.length)
        .find((key) => slug === key || slug.startsWith(`${key}-`)) || 'compartir-coche';

    const base = intentConfig[baseKey];
    const city = cities[cityKey];
    const purpose = purposeConfig[purposeKey];

    if (city) {
        return {
            ...base,
            h1: `${base.keyword.charAt(0).toUpperCase()}${base.keyword.slice(1)} en ${city}`,
            title: `${base.keyword.charAt(0).toUpperCase()}${base.keyword.slice(1)} en ${city} | ShareWay`,
            description: `Encuentra personas para ${base.keyword} en ${city}. Comparte trayectos compatibles, ahorra dinero y organiza rutas al trabajo, universidad, aeropuerto o viajes frecuentes.`,
            intro: `ShareWay conecta personas que quieren ${base.keyword} en ${city} con rutas y horarios compatibles.`,
            location: city,
            purpose
        };
    }

    if (purpose) {
        return {
            ...base,
            h1: `${base.keyword.charAt(0).toUpperCase()}${base.keyword.slice(1)} ${purpose.phrase}`,
            title: `${base.keyword.charAt(0).toUpperCase()}${base.keyword.slice(1)} ${purpose.phrase} | ShareWay`,
            description: `Organiza rutas para ${base.keyword} ${purpose.phrase}. ShareWay ayuda a conectar personas con trayectos compatibles y horarios similares.`,
            intro: `${base.intro} Esta página está orientada a quienes buscan ${base.keyword} ${purpose.phrase}.`,
            purpose
        };
    }

    return base;
};

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

const SEOLandingPage = () => {
    const location = useLocation();
    const config = useMemo(() => getPageConfig(location.pathname), [location.pathname]);
    const canonicalUrl = `https://www.shareway.es${location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`}`;

    useEffect(() => {
        document.title = config.title;
        setMeta('description', config.description);
        setMeta('og:title', config.title, true);
        setMeta('og:description', config.description, true);
        setMeta('og:url', canonicalUrl, true);
        setMeta('twitter:title', config.title);
        setMeta('twitter:description', config.description);
        updateCanonical(canonicalUrl);
    }, [config, canonicalUrl]);

    const relatedCities = ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Málaga', 'Alicante'];

    return (
        <main className="min-h-screen bg-white text-slate-950">
            <section className="relative overflow-hidden bg-slate-950 text-white px-6 py-20 sm:py-28">
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,#22c55e,transparent_35%),radial-gradient(circle_at_bottom_left,#f97316,transparent_30%)]" />
                <div className="relative max-w-5xl mx-auto grid gap-10 lg:grid-cols-[1.2fr_0.8fr] items-center">
                    <div className="space-y-7">
                        <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.25em] text-emerald-300">
                            <Car className="h-4 w-4" /> ShareWay España
                        </p>
                        <h1 className="text-4xl sm:text-6xl font-black tracking-tighter leading-[0.95]">
                            {config.h1}
                        </h1>
                        <p className="text-lg sm:text-xl text-slate-300 max-w-2xl leading-relaxed">
                            {config.description}
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <Button asChild className="h-14 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase tracking-widest">
                                <Link to="/register">{config.cta} <ArrowRight className="ml-2 h-5 w-5" /></Link>
                            </Button>
                            <Button asChild variant="outline" className="h-14 rounded-2xl border-white/20 bg-white/10 text-white hover:bg-white/20 font-black uppercase tracking-widest">
                                <Link to="/login">Entrar</Link>
                            </Button>
                        </div>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-xl">
                        <div className="grid gap-4">
                            <div className="rounded-3xl bg-white text-slate-950 p-5">
                                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Ahorro estimado</p>
                                <p className="text-4xl font-black tracking-tighter">30–60%</p>
                                <p className="text-sm text-slate-500">al dividir gastos en trayectos compatibles.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="rounded-3xl bg-slate-900 border border-white/10 p-5">
                                    <Users className="h-6 w-6 text-emerald-400 mb-3" />
                                    <p className="text-sm font-black">Rutas compatibles</p>
                                </div>
                                <div className="rounded-3xl bg-slate-900 border border-white/10 p-5">
                                    <Leaf className="h-6 w-6 text-emerald-400 mb-3" />
                                    <p className="text-sm font-black">Menos emisiones</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="px-6 py-16">
                <div className="max-w-5xl mx-auto grid gap-8 md:grid-cols-3">
                    <article className="rounded-3xl border border-slate-100 bg-slate-50 p-7">
                        <MapPin className="h-7 w-7 text-emerald-600 mb-4" />
                        <h2 className="text-xl font-black tracking-tight mb-2">Encuentra rutas compatibles</h2>
                        <p className="text-slate-600 leading-relaxed">{config.intro}</p>
                    </article>
                    <article className="rounded-3xl border border-slate-100 bg-slate-50 p-7">
                        <Wallet className="h-7 w-7 text-emerald-600 mb-4" />
                        <h2 className="text-xl font-black tracking-tight mb-2">Ahorra en cada desplazamiento</h2>
                        <p className="text-slate-600 leading-relaxed">Divide gastos de combustible, aparcamiento, taxi o trayecto con personas que se mueven en la misma dirección.</p>
                    </article>
                    <article className="rounded-3xl border border-slate-100 bg-slate-50 p-7">
                        <ShieldCheck className="h-7 w-7 text-emerald-600 mb-4" />
                        <h2 className="text-xl font-black tracking-tight mb-2">Viaja con más confianza</h2>
                        <p className="text-slate-600 leading-relaxed">Perfiles, valoraciones, mensajería y herramientas de seguridad para organizar trayectos con más tranquilidad.</p>
                    </article>
                </div>
            </section>

            <section className="px-6 py-16 bg-slate-50">
                <div className="max-w-5xl mx-auto grid gap-10 lg:grid-cols-[0.8fr_1.2fr] items-start">
                    <div>
                        <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-600 mb-3">SEO local</p>
                        <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-4">ShareWay para rutas urbanas y frecuentes</h2>
                        <p className="text-slate-600 leading-relaxed">Puedes usar ShareWay para desplazamientos diarios, viajes entre ciudades, rutas al aeropuerto, trabajo, universidad, eventos y trayectos recurrentes.</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {relatedCities.map((city) => (
                            <Link
                                key={city}
                                to={`/compartir-coche-${city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}/`}
                                className="rounded-2xl bg-white border border-slate-100 p-5 font-black text-slate-900 hover:border-emerald-200 hover:shadow-lg transition-all"
                            >
                                Compartir coche en {city}
                            </Link>
                        ))}
                    </div>
                </div>
            </section>

            <section className="px-6 py-16">
                <div className="max-w-4xl mx-auto text-center space-y-6">
                    <h2 className="text-3xl sm:text-4xl font-black tracking-tighter">Empieza a crear rutas compartidas con ShareWay</h2>
                    <p className="text-slate-600 text-lg">Publica un viaje, solicita plaza o encuentra personas con rutas compatibles.</p>
                    <Button asChild className="h-14 rounded-2xl bg-slate-950 text-white hover:bg-slate-800 font-black uppercase tracking-widest">
                        <Link to="/register">Crear cuenta gratis <ArrowRight className="ml-2 h-5 w-5" /></Link>
                    </Button>
                </div>
            </section>
        </main>
    );
};

export default SEOLandingPage;
