import { createElement, useEffect, useState } from 'react';
import { Radio, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import MapComponent from './MapComponent.jsx';
import { supabase } from '../lib/supabase.js';
import { getPublicRegisteredUserCount } from '../lib/supabaseRPC.js';

const LANDING_MAP_CENTER = { lat: 41.3874, lng: 2.1687 };

const readRegisteredUserCount = (data) => {
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : { count: data };
  const count = Number(payload?.count);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
};

function PublicCommunityMap() {
  const { t, i18n } = useTranslation();
  const [registeredUsers, setRegisteredUsers] = useState(null);
  const [countError, setCountError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const refreshCount = async () => {
      const response = await getPublicRegisteredUserCount();
      if (!isMounted) return;

      const count = response.success ? readRegisteredUserCount(response.data) : null;
      if (count === null) {
        setCountError(true);
        return;
      }

      setRegisteredUsers(count);
      setCountError(false);
    };

    refreshCount();

    // Realtime carries only an aggregate stats row. The client deliberately
    // asks the allow-listed RPC for the value instead of using any row payload.
    const channel = supabase
      .channel('public-registered-user-count')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'public_platform_stats' },
        refreshCount
      )
      .subscribe();

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshCount();
    };
    const interval = window.setInterval(refreshCount, 30000);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      supabase.removeChannel(channel);
    };
  }, []);

  const locale = i18n.language?.startsWith('ar')
    ? 'ar'
    : i18n.language?.startsWith('en')
      ? 'en'
      : 'es';
  const formattedCount = registeredUsers === null
    ? null
    : new Intl.NumberFormat(locale).format(registeredUsers);
  const countLabel = registeredUsers === 1
    ? t('landing.registered_users_one')
    : t('landing.registered_users');

  return (
    <div className="relative h-[390px] overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-200 shadow-xl sm:h-[470px]">
      {createElement(MapComponent, { center: LANDING_MAP_CENTER, zoom: 6, itemsToDisplay: [] })}
      <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex justify-end sm:inset-x-6 sm:top-6">
        <div className="max-w-xs rounded-3xl border border-white/70 bg-white/95 px-5 py-4 text-right shadow-xl backdrop-blur-md sm:max-w-sm sm:px-6 sm:py-5">
          <div className="flex items-center justify-end gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">
            {createElement(Radio, { className: 'h-4 w-4', 'aria-hidden': true })}
            <span>{t('landing.map_title')}</span>
          </div>
          <p className="mt-2 text-lg font-black leading-tight text-slate-950 sm:text-xl">{t('landing.community_title')}</p>
          <div className="mt-3 flex items-center justify-end gap-2 text-slate-600" aria-live="polite">
            {createElement(Users, { className: 'h-5 w-5 shrink-0 text-orange-500', 'aria-hidden': true })}
            {formattedCount === null ? (
              <span className="text-sm font-bold">
                {countError ? t('landing.registered_users_error') : t('landing.registered_users_loading')}
              </span>
            ) : (
              <span className="text-base font-black text-slate-950 sm:text-lg">
                {formattedCount} {countLabel}
              </span>
            )}
          </div>
          {formattedCount !== null && (
            <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600">{t('landing.registered_users_live')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function LandingPage() {
  const quickBenefits = [
    ['Carpooling flexible', 'Comparte coche, taxi o trayecto con personas de ruta compatible.'],
    ['Rutas compatibles', 'Conecta con personas que van hacia zonas similares.'],
    ['Aeropuertos', 'Organiza trayectos compartidos al aeropuerto.'],
    ['Ciudades y rutas frecuentes', 'Úsalo en desplazamientos diarios o recurrentes.'],
  ];

  const steps = [
    ['Paso 1', 'Crea tu cuenta gratis', 'Regístrate para acceder y preparar tu perfil.'],
    ['Paso 2', 'Indica tu ruta', 'Publica o busca el trayecto que necesitas compartir.'],
    ['Paso 3', 'Encuentra personas compatibles', 'Coordina horario, punto de encuentro y destino.'],
  ];

  const productActions = [
    ['Ofrecer plaza', 'Publica tu trayecto, indica origen, destino, horario y plazas disponibles.', 'Ofrecer plaza'],
    ['Buscar plaza', 'Solicita un trayecto y encuentra personas con rutas compatibles.', 'Buscar plaza'],
    ['Gestionar tus viajes', 'Consulta tus trayectos, solicitudes y conversaciones desde tu cuenta.', 'Crear cuenta gratis'],
  ];

  const advantages = [
    ['Ahorro en desplazamientos', 'Compartir coche, taxi o ruta permite dividir gastos y aprovechar mejor cada viaje.'],
    ['Rutas compatibles', 'Busca usuarios que se mueven hacia zonas cercanas o destinos similares.'],
    ['Comunidad verificada', 'ShareWay está pensado para crear confianza mediante perfiles y actividad.'],
    ['Movilidad más eficiente', 'El carpooling reduce viajes duplicados y mejora la organización diaria.'],
  ];

  const localRouteLinks = [
    ['/rutas/pineda-de-mar/barcelona/', 'Pineda de Mar → Barcelona', 'Maresme norte'],
    ['/rutas/malgrat-de-mar/barcelona/', 'Malgrat de Mar → Barcelona', 'Maresme norte'],
    ['/rutas/calella/barcelona/', 'Calella → Barcelona', 'Maresme'],
    ['/rutas/mataro/barcelona/', 'Mataró → Barcelona', 'Maresme diario'],
    ['/rutas/girona/barcelona/', 'Girona → Barcelona', 'Girona y Barcelona'],
    ['/rutas/barcelona/girona/', 'Barcelona → Girona', 'Ruta interurbana'],
    ['/rutas/barcelona/tarragona/', 'Barcelona → Tarragona', 'Costa Daurada'],
    ['/rutas/lloret-de-mar/barcelona/', 'Lloret de Mar → Barcelona', 'Costa Brava'],
    ['/rutas/blanes/barcelona/', 'Blanes → Barcelona', 'Costa Brava sur'],
  ];

  const seoGuideLinks = [
    ['/guias/como-ir-de-pineda-de-mar-a-barcelona-barato/', 'Cómo ir de Pineda de Mar a Barcelona barato', 'Guía de ahorro para moverte desde el Maresme hacia Barcelona.'],
    ['/guias/compartir-coche-malgrat-de-mar-barcelona/', 'Compartir coche de Malgrat de Mar a Barcelona', 'Consejos para publicar o encontrar trayectos compatibles.'],
    ['/guias/viajes-compartidos-mataro-barcelona/', 'Viajes compartidos de Mataró a Barcelona', 'Ruta diaria útil para trabajo, estudios y desplazamientos recurrentes.'],
    ['/guias/compartir-coche-girona-barcelona/', 'Compartir coche entre Girona y Barcelona', 'Ideas para coordinar viajes interurbanos y ahorrar gastos.'],
    ['/guias/compartir-coche-costa-brava-barcelona/', 'Compartir coche Costa Brava Barcelona', 'Rutas desde Lloret, Blanes, Girona y Costa Brava hacia Barcelona.'],
    ['/guias/compartir-coche-aeropuerto-girona-costa-brava/', 'Compartir coche al Aeropuerto Girona-Costa Brava', 'Guía para vuelos, horarios compatibles y traslados compartidos.'],
  ];

  const localCityLinks = [
    ['/ciudades/barcelona/', 'Barcelona'],
    ['/ciudades/girona/', 'Girona'],
    ['/ciudades/mataro/', 'Mataró'],
    ['/ciudades/pineda-de-mar/', 'Pineda de Mar'],
    ['/ciudades/malgrat-de-mar/', 'Malgrat de Mar'],
    ['/ciudades/calella/', 'Calella'],
    ['/ciudades/blanes/', 'Blanes'],
    ['/ciudades/lloret-de-mar/', 'Lloret de Mar'],
    ['/ciudades/sabadell/', 'Sabadell'],
    ['/ciudades/terrassa/', 'Terrassa'],
    ['/ciudades/tarragona/', 'Tarragona'],
    ['/ciudades/reus/', 'Reus'],
  ];

  const localAirportLinks = [
    ['/aeropuertos/aeropuerto-barcelona-el-prat/', 'Aeropuerto Barcelona-El Prat'],
    ['/aeropuertos/aeropuerto-girona-costa-brava/', 'Aeropuerto Girona-Costa Brava'],
    ['/aeropuertos/aeropuerto-reus/', 'Aeropuerto de Reus'],
  ];

  const guides = [
    ['/carpooling/', 'Carpooling y trayectos compartidos'],
    ['/compartir-coche/', 'Compartir coche'],
    ['/viajes-compartidos/', 'Viajes compartidos'],
    ['/rutas-compartidas/', 'Rutas compartidas'],
    ['/carpooling-trabajo/', 'Carpooling al trabajo'],
    ['/carpooling-universidad/', 'Carpooling para universidad'],
    ['/compartir-coche-trabajo/', 'Compartir coche al trabajo'],
    ['/compartir-coche-universidad/', 'Compartir coche a la universidad'],
    ['/compartir-taxi-barato/', 'Compartir taxi barato'],
    ['/ahorrar-compartiendo-taxi/', 'Ahorrar compartiendo taxi'],
  ];

  const faqs = [
    ['¿Qué es ShareWay?', 'ShareWay es una plataforma de carpooling para compartir coche, taxi o trayectos con usuarios que tienen rutas compatibles.'],
    ['¿Es gratis crear una cuenta?', 'Sí, el registro está planteado para que puedas empezar a crear tu perfil y explorar trayectos.'],
    ['¿Puedo usar ShareWay para ir al aeropuerto?', 'Sí. Puedes buscar o publicar trayectos hacia aeropuertos para compartir gastos con personas con horarios compatibles.'],
    ['¿En qué ciudades funciona?', 'ShareWay está pensado para funcionar en distintas ciudades y rutas. Ya tenemos páginas específicas para Barcelona, Girona, Mataró, Pineda de Mar, Malgrat de Mar, Lloret de Mar, Madrid, Valencia, Sevilla, Málaga, Alicante, Bilbao y Zaragoza.'],
    ['¿Puedo compartir trayectos al trabajo o a la universidad?', 'Sí. ShareWay permite organizar trayectos compatibles para trabajo, universidad, aeropuertos, eventos y rutas frecuentes.'],
    ['¿ShareWay es una empresa de taxi?', 'No. ShareWay es una plataforma de carpooling para conectar usuarios que quieren compartir trayectos o coordinar desplazamientos compatibles.'],
  ];

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <a href="/" className="text-xl font-black tracking-tight">ShareWay</a>
          <nav className="flex items-center gap-3 text-sm font-black">
            <a href="#como-funciona" className="hidden text-slate-600 hover:text-slate-950 sm:inline">Cómo funciona</a>
            <a href="/carpooling/" className="hidden text-slate-600 hover:text-slate-950 sm:inline">Carpooling</a>
            <a href="/rutas/" className="hidden text-slate-600 hover:text-slate-950 sm:inline">Rutas</a>
            <a href="/login" className="rounded-full border px-4 py-2">Entrar</a>
            <a href="/register" className="rounded-full bg-orange-500 px-4 py-2 text-white">Crear cuenta gratis</a>
          </nav>
        </div>
      </header>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <p className="mb-5 text-sm font-black uppercase tracking-widest text-orange-500">Carpooling, viajes compartidos y rutas compatibles</p>
          <h1 className="text-5xl font-black tracking-tight">Carpooling para compartir trayectos y ahorrar en cada viaje</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">Encuentra personas con rutas compatibles, comparte coche, taxi o trayectos urbanos y reduce costes en aeropuertos, trabajo, universidad y rutas frecuentes.</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <a href="/register" className="rounded-full bg-orange-500 px-6 py-4 font-black text-white">Crear cuenta gratis</a>
            <a href="#como-funciona" className="rounded-full border px-6 py-4 font-black">Ver cómo funciona</a>
            <a href="/rutas/" className="rounded-full border px-6 py-4 font-black">Ver rutas</a>
          </div>
        </div>
      </section>

      <section className="px-6 pb-16">
        <div className="mx-auto max-w-5xl">
          {createElement(PublicCommunityMap)}
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {quickBenefits.map(([title, text]) => (
              <article key={title} className="rounded-3xl border border-orange-100 bg-orange-50 p-5">
                <p className="text-sm font-black text-orange-600">{title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
          <div className="mt-8 rounded-3xl bg-slate-950 p-6 text-white">
            <p className="text-xl font-black">Empieza ahora con ShareWay</p>
            <p className="mt-2 text-white/70">Crea tu cuenta gratis y encuentra rutas compatibles para compartir trayecto.</p>
            <a href="/register" className="mt-5 inline-flex rounded-full bg-orange-500 px-6 py-4 font-black text-white">Crear cuenta gratis</a>
          </div>
        </div>
      </section>

      <section id="como-funciona" className="bg-slate-50 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-black tracking-tight">Cómo funciona ShareWay</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {steps.map(([step, title, text]) => (
              <article key={step} className="rounded-3xl bg-white p-6 shadow-sm">
                <p className="text-sm font-black text-orange-600">{step}</p>
                <h3 className="mt-2 text-xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-black tracking-tight">Qué puedes hacer en ShareWay</h2>
          <p className="mt-4 max-w-3xl leading-8 text-slate-600">Dentro de tu cuenta puedes ofrecer plazas, buscar plazas disponibles y gestionar tus trayectos desde el panel principal.</p>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {productActions.map(([title, text, cta], index) => (
              <article key={title} className="rounded-3xl border border-orange-100 bg-white p-6 shadow-sm">
                <h3 className="text-xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{text}</p>
                <a href="/register" className={index === 0 ? "mt-5 inline-flex rounded-full bg-orange-500 px-5 py-3 text-sm font-black text-white" : index === 1 ? "mt-5 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white" : "mt-5 inline-flex rounded-full border px-5 py-3 text-sm font-black"}>{cta}</a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-orange-50 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-black tracking-tight">Ventajas del carpooling</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {advantages.map(([title, text]) => (
              <article key={title} className="rounded-3xl bg-white p-6 shadow-sm">
                <h3 className="text-xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-black uppercase tracking-widest text-orange-300">Rutas reales para empezar</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight">Rutas populares para compartir coche en Catalunya</h2>
          <p className="mt-4 max-w-3xl leading-8 text-white/70">Empieza por las páginas más buscadas de Barcelona, Maresme, Girona, Costa Brava y Tarragona. Estos enlaces ayudan a los usuarios y también refuerzan la indexación SEO.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {localRouteLinks.map(([href, label, zone]) => (
              <a key={href} href={href} className="rounded-3xl border border-white/10 bg-white/10 p-6 font-black text-white hover:bg-white/15">
                <span className="block text-xs uppercase tracking-widest text-orange-300">{zone}</span>
                <span className="mt-2 block text-lg">{label}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-black uppercase tracking-widest text-orange-500">Guías SEO nuevas</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight">Guías para ahorrar compartiendo coche</h2>
          <p className="mt-4 max-w-3xl leading-8 text-slate-600">Guías prácticas para búsquedas concretas de rutas locales. Sirven para ayudar al usuario y reforzar las páginas long-tail en Google.</p>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {seoGuideLinks.map(([href, title, description]) => (
              <a key={href} href={href} className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm hover:shadow-md">
                <span className="text-xl font-black text-slate-950">{title}</span>
                <span className="mt-3 block leading-7 text-slate-600">{description}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-6 py-16">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
          <div className="rounded-[2rem] bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">Ciudades para compartir coche</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Páginas locales para captar búsquedas de carpooling y viajes compartidos por ciudad.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {localCityLinks.map(([href, label]) => <a key={href} href={href} className="rounded-full border px-4 py-2 text-sm font-black hover:bg-slate-50">{label}</a>)}
            </div>
          </div>
          <div className="rounded-[2rem] bg-orange-500 p-6 text-white">
            <h2 className="text-2xl font-black">Aeropuertos y trayectos frecuentes</h2>
            <p className="mt-2 text-sm leading-6 text-white/80">Enlaces a páginas de aeropuertos para captar usuarios con horarios compatibles y viajes puntuales.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {localAirportLinks.map(([href, label]) => <a key={href} href={href} className="rounded-full bg-white px-4 py-2 text-sm font-black text-orange-600 hover:bg-orange-50">{label}</a>)}
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-black tracking-tight">Guías útiles para compartir trayectos</h2>
          <p className="mt-4 max-w-3xl leading-8 text-slate-600">Contenido orientado a búsquedas frecuentes sobre carpooling, compartir coche, viajes compartidos, rutas compartidas, ahorro, trabajo y universidad.</p>
          <div className="mt-8 grid gap-5 md:grid-cols-5">
            {guides.map(([href, label]) => <a key={href} href={href} className="rounded-3xl border p-6 font-black hover:bg-slate-50">{label}</a>)}
          </div>
        </div>
      </section>

      <section className="bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-black tracking-tight">Confianza y uso responsable</h2>
          <p className="mt-5 max-w-3xl leading-8 text-white/70">ShareWay está diseñado para facilitar conexiones entre usuarios de forma responsable, con información clara, perfiles y canales de contacto.</p>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            <article className="rounded-3xl bg-white/10 p-6"><h3 className="font-black">Perfiles de usuario</h3><p className="mt-3 text-sm leading-6 text-white/70">Ayudan a conocer mejor con quién se coordina cada trayecto.</p></article>
            <article className="rounded-3xl bg-white/10 p-6"><h3 className="font-black">Comunicación clara</h3><p className="mt-3 text-sm leading-6 text-white/70">Organiza horarios, puntos de encuentro y detalles antes de viajar.</p></article>
            <article className="rounded-3xl bg-white/10 p-6"><h3 className="font-black">Soporte y contacto</h3><p className="mt-3 text-sm leading-6 text-white/70">La página de contacto permite consultar dudas o comunicar incidencias.</p></article>
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-black tracking-tight">Preguntas frecuentes</h2>
          <div className="mt-8 space-y-5">
            {faqs.map(([question, answer]) => <article key={question} className="rounded-3xl bg-slate-50 p-6"><h3 className="text-xl font-black">{question}</h3><p className="mt-3 leading-7 text-slate-600">{answer}</p></article>)}
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl rounded-[2rem] bg-orange-500 p-10 text-white md:p-14">
          <h2 className="text-4xl font-black tracking-tight">Empieza a compartir trayectos hoy</h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-white/90">Crea tu cuenta, publica una ruta o encuentra personas con trayectos compatibles. ShareWay te ayuda a moverte de forma más eficiente.</p>
          <div className="mt-8 flex flex-wrap gap-4"><a href="/register" className="rounded-full bg-white px-6 py-4 font-black text-orange-600">Crear cuenta gratis</a><a href="/login" className="rounded-full border border-white/60 px-6 py-4 font-black text-white">Ya tengo cuenta</a></div>
        </div>
      </section>

      <footer className="border-t border-slate-100 px-6 py-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
          <p>© ShareWay</p>
          <nav className="flex flex-wrap gap-4">
            <a href="/carpooling/" className="hover:text-slate-950">Carpooling</a>
            <a href="/viajes-compartidos/" className="hover:text-slate-950">Viajes compartidos</a>
            <a href="/rutas-compartidas/" className="hover:text-slate-950">Rutas compartidas</a>
            <a href="/rutas/" className="hover:text-slate-950">Rutas</a>
            <a href="/guias/como-ir-de-pineda-de-mar-a-barcelona-barato/" className="hover:text-slate-950">Guía Pineda - Barcelona</a>
            <a href="/guias/compartir-coche-girona-barcelona/" className="hover:text-slate-950">Guía Girona - Barcelona</a>
            <a href="/contacto/" className="hover:text-slate-950">Contacto</a>
            <a href="/privacidad/" className="hover:text-slate-950">Privacidad</a>
            <a href="/terminos/" className="hover:text-slate-950">Términos</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}

export default LandingPage;
