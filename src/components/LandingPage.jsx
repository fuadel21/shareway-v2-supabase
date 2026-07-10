function LandingPage() {
  const quickBenefits = [
    ['Carpooling flexible', 'Comparte coche, taxi o trayecto con personas de ruta compatible.'],
    ['Rutas compatibles', 'Conecta con personas que van hacia zonas similares.'],
    ['Aeropuertos', 'Organiza trayectos compartidos al aeropuerto.'],
    ['Ciudades y rutas frecuentes', 'Úsalo en desplazamientos diarios o recurrentes.'],
  ];

  const trustCards = [
    ['Perfiles de usuario', 'Antes de coordinar un trayecto, puedes revisar la información disponible del usuario.'],
    ['Detalles del viaje', 'Acuerda horario, punto de encuentro y destino antes de compartir ruta.'],
    ['Uso responsable', 'La plataforma está pensada para facilitar conexiones claras y responsables entre usuarios.'],
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

  const reasons = [
    ['Ahorra compartiendo', 'Divide gastos de coche, taxi o trayecto con otros usuarios.'],
    ['Encuentra rutas', 'Conecta con personas que van hacia zonas parecidas.'],
    ['Organiza mejor', 'Publica, solicita y gestiona desplazamientos desde una sola plataforma.'],
    ['Muévete con confianza', 'Usa perfiles y herramientas de seguridad para coordinar mejor cada viaje.'],
  ];

  const audiences = [
    ['Estudiantes', 'Para compartir trayectos hacia universidades, academias o zonas de estudio.'],
    ['Trabajadores', 'Para organizar desplazamientos recurrentes al trabajo o zonas empresariales.'],
    ['Viajeros al aeropuerto', 'Para coordinar trayectos hacia aeropuertos y repartir gastos del viaje.'],
    ['Rutas repetidas', 'Para personas que hacen recorridos similares cada semana o cada día.'],
  ];

  const useCases = [
    ['Ir al trabajo', 'Coordina rutas hacia oficinas, polígonos o zonas empresariales.'],
    ['Ir al aeropuerto', 'Busca usuarios con horarios compatibles para compartir el trayecto al aeropuerto.'],
    ['Salir de eventos', 'Organiza vueltas desde conciertos, partidos, ferias o eventos grandes.'],
    ['Barrios y ciudades cercanas', 'Comparte rutas entre zonas próximas o trayectos interurbanos habituales.'],
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
    ['/rutas-compartidas-trabajo/', 'Rutas compartidas al trabajo'],
    ['/compartir-trayecto-trabajo/', 'Compartir trayecto al trabajo'],
    ['/compartir-trayecto-universidad/', 'Compartir trayecto a la universidad'],
    ['/compartir-taxi-barato/', 'Compartir taxi barato'],
    ['/ahorrar-compartiendo-taxi/', 'Ahorrar compartiendo taxi'],
  ];

  const carpoolingRoutes = [
    ['/carpooling-madrid/', 'Carpooling en Madrid'],
    ['/carpooling-barcelona/', 'Carpooling en Barcelona'],
    ['/carpooling-valencia/', 'Carpooling en Valencia'],
    ['/carpooling-alicante/', 'Carpooling en Alicante'],
    ['/carpooling-bilbao/', 'Carpooling en Bilbao'],
    ['/carpooling-zaragoza/', 'Carpooling en Zaragoza'],
  ];

  const sharedCarRoutes = [
    ['/compartir-coche-madrid/', 'Compartir coche en Madrid'],
    ['/compartir-coche-barcelona/', 'Compartir coche en Barcelona'],
    ['/compartir-coche-valencia/', 'Compartir coche en Valencia'],
    ['/compartir-coche-sevilla/', 'Compartir coche en Sevilla'],
    ['/compartir-coche-malaga/', 'Compartir coche en Malaga'],
    ['/compartir-coche-alicante/', 'Compartir coche en Alicante'],
    ['/compartir-coche-bilbao/', 'Compartir coche en Bilbao'],
    ['/compartir-coche-zaragoza/', 'Compartir coche en Zaragoza'],
  ];

  const sharedTripRoutes = [
    ['/viajes-compartidos-madrid/', 'Viajes compartidos en Madrid'],
    ['/viajes-compartidos-barcelona/', 'Viajes compartidos en Barcelona'],
    ['/viajes-compartidos-valencia/', 'Viajes compartidos en Valencia'],
    ['/viajes-compartidos-sevilla/', 'Viajes compartidos en Sevilla'],
    ['/viajes-compartidos-malaga/', 'Viajes compartidos en Malaga'],
    ['/viajes-compartidos-alicante/', 'Viajes compartidos en Alicante'],
    ['/viajes-compartidos-bilbao/', 'Viajes compartidos en Bilbao'],
    ['/viajes-compartidos-zaragoza/', 'Viajes compartidos en Zaragoza'],
  ];

  const sharedRoutePages = [
    ['/rutas-compartidas-madrid/', 'Rutas compartidas en Madrid'],
    ['/rutas-compartidas-barcelona/', 'Rutas compartidas en Barcelona'],
    ['/rutas-compartidas-valencia/', 'Rutas compartidas en Valencia'],
    ['/rutas-compartidas-sevilla/', 'Rutas compartidas en Sevilla'],
    ['/rutas-compartidas-malaga/', 'Rutas compartidas en Malaga'],
    ['/rutas-compartidas-alicante/', 'Rutas compartidas en Alicante'],
    ['/rutas-compartidas-bilbao/', 'Rutas compartidas en Bilbao'],
    ['/rutas-compartidas-zaragoza/', 'Rutas compartidas en Zaragoza'],
  ];

  const cityRoutes = [
    ['/taxi-compartido-madrid/', 'Taxi compartido en Madrid'],
    ['/taxi-compartido-barcelona/', 'Taxi compartido en Barcelona'],
    ['/taxi-compartido-valencia/', 'Taxi compartido en Valencia'],
    ['/taxi-compartido-sevilla/', 'Taxi compartido en Sevilla'],
    ['/taxi-compartido-malaga/', 'Taxi compartido en Málaga'],
    ['/taxi-compartido-alicante/', 'Taxi compartido en Alicante'],
    ['/taxi-compartido-bilbao/', 'Taxi compartido en Bilbao'],
    ['/taxi-compartido-zaragoza/', 'Taxi compartido en Zaragoza'],
  ];

  const airportRoutes = [
    ['/compartir-taxi-aeropuerto-madrid/', 'Compartir taxi al aeropuerto de Madrid'],
    ['/compartir-taxi-aeropuerto-barcelona/', 'Compartir taxi al aeropuerto de Barcelona'],
    ['/compartir-taxi-aeropuerto-valencia/', 'Compartir taxi al aeropuerto de Valencia'],
    ['/compartir-taxi-aeropuerto-sevilla/', 'Compartir taxi al aeropuerto de Sevilla'],
    ['/compartir-taxi-aeropuerto-malaga/', 'Compartir taxi al aeropuerto de Málaga'],
    ['/compartir-taxi-aeropuerto-alicante/', 'Compartir taxi al aeropuerto de Alicante'],
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
          <div className="grid gap-4 md:grid-cols-4">
            {quickBenefits.map(([title, text]) => <article key={title} className="rounded-3xl border border-orange-100 bg-orange-50 p-5"><p className="text-sm font-black text-orange-600">{title}</p><p className="mt-2 text-sm leading-6 text-slate-600">{text}</p></article>)}
          </div>
          <div className="mt-8 rounded-3xl bg-slate-950 p-6 text-white"><p className="text-xl font-black">Empieza ahora con ShareWay</p><p className="mt-2 text-white/70">Crea tu cuenta gratis y encuentra rutas compatibles para compartir trayecto.</p><a href="/register" className="mt-5 inline-flex rounded-full bg-orange-500 px-6 py-4 font-black text-white">Crear cuenta gratis</a></div>
        </div>
      </section>

      <section className="px-6 pb-16"><div className="mx-auto max-w-5xl rounded-[2rem] border border-slate-100 p-8"><h2 className="text-3xl font-black tracking-tight">Carpooling con más confianza</h2><p className="mt-4 max-w-3xl leading-8 text-slate-600">ShareWay está pensado para que puedas organizar rutas de forma clara, revisar información del usuario y coordinar los detalles antes del viaje.</p><div className="mt-8 grid gap-5 md:grid-cols-3">{trustCards.map(([title, text]) => <article key={title} className="rounded-3xl bg-slate-50 p-6"><h3 className="font-black">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{text}</p></article>)}</div></div></section>

      <section className="px-6 pb-16"><div className="mx-auto max-w-5xl rounded-[2rem] bg-orange-50 p-8"><h2 className="text-3xl font-black tracking-tight">Cómo empezar en menos de 1 minuto</h2><p className="mt-4 max-w-3xl leading-8 text-slate-700">Crea tu cuenta y empieza a organizar trayectos de forma rápida.</p><div className="mt-8 grid gap-5 md:grid-cols-3">{steps.map(([step, title, text]) => <article key={step} className="rounded-3xl bg-white p-6 shadow-sm"><p className="text-sm font-black text-orange-600">{step}</p><h3 className="mt-2 text-xl font-black">{title}</h3><p className="mt-3 leading-7 text-slate-600">{text}</p></article>)}</div><a href="/register" className="mt-8 inline-flex rounded-full bg-orange-500 px-6 py-4 font-black text-white">Crear cuenta gratis</a></div></section>

      <section className="px-6 pb-16"><div className="mx-auto max-w-5xl"><h2 className="text-3xl font-black tracking-tight">Qué puedes hacer en ShareWay</h2><p className="mt-4 max-w-3xl leading-8 text-slate-600">Dentro de tu cuenta puedes ofrecer plazas, buscar plazas disponibles y gestionar tus trayectos desde el panel principal.</p><div className="mt-8 grid gap-5 md:grid-cols-3">{productActions.map(([title, text, cta], index) => <article key={title} className="rounded-3xl border border-orange-100 bg-white p-6 shadow-sm"><h3 className="text-xl font-black">{title}</h3><p className="mt-3 leading-7 text-slate-600">{text}</p><a href="/register" className={index === 0 ? "mt-5 inline-flex rounded-full bg-orange-500 px-5 py-3 text-sm font-black text-white" : index === 1 ? "mt-5 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white" : "mt-5 inline-flex rounded-full border px-5 py-3 text-sm font-black"}>{cta}</a></article>)}</div></div></section>

      <section id="como-funciona" className="bg-slate-50 px-6 py-16"><div className="mx-auto max-w-5xl"><h2 className="text-3xl font-black tracking-tight">Cómo funciona ShareWay</h2><div className="mt-8 grid gap-5 md:grid-cols-3"><article className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-black">1. Crea tu cuenta</h3><p className="mt-3 leading-7 text-slate-600">Regístrate para acceder a la comunidad y gestionar tus trayectos.</p></article><article className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-black">2. Publica o solicita ruta</h3><p className="mt-3 leading-7 text-slate-600">Indica tu trayecto para encontrar personas con ruta compatible.</p></article><article className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-black">3. Coordina el viaje</h3><p className="mt-3 leading-7 text-slate-600">Habla con el usuario y acuerda detalles antes del desplazamiento.</p></article></div></div></section>

      <section className="px-6 py-16"><div className="mx-auto max-w-5xl"><h2 className="text-3xl font-black tracking-tight">Ventajas del carpooling</h2><div className="mt-8 grid gap-5 md:grid-cols-2">{advantages.map(([title, text]) => <article key={title} className="rounded-3xl border p-6"><h3 className="text-xl font-black">{title}</h3><p className="mt-3 leading-7 text-slate-600">{text}</p></article>)}</div></div></section>

      <section className="bg-orange-50 px-6 py-16"><div className="mx-auto max-w-5xl"><h2 className="text-3xl font-black tracking-tight">¿Por qué usar ShareWay?</h2><p className="mt-4 max-w-3xl leading-8 text-slate-700">ShareWay está pensado para personas que quieren moverse mejor, ahorrar y encontrar acompañantes con rutas compatibles sin complicarse.</p><div className="mt-8 grid gap-5 md:grid-cols-4">{reasons.map(([title, text]) => <article key={title} className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="font-black">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{text}</p></article>)}</div><div className="mt-8"><a href="/register" className="inline-flex rounded-full bg-orange-500 px-6 py-4 font-black text-white">Crear cuenta gratis</a></div></div></section>

      <section className="px-6 py-16"><div className="mx-auto max-w-5xl"><h2 className="text-3xl font-black tracking-tight">Para quién es ShareWay</h2><p className="mt-4 max-w-3xl leading-8 text-slate-600">ShareWay puede ayudar a distintos perfiles que repiten rutas, se mueven a diario o quieren dividir costes en trayectos concretos.</p><div className="mt-8 grid gap-5 md:grid-cols-4">{audiences.map(([title, text]) => <article key={title} className="rounded-3xl border p-6"><h3 className="font-black">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{text}</p></article>)}</div></div></section>

      <section className="bg-white px-6 py-16"><div className="mx-auto max-w-5xl"><h2 className="text-3xl font-black tracking-tight">Casos de uso frecuentes</h2><p className="mt-4 max-w-3xl leading-8 text-slate-600">ShareWay puede servir para organizar desplazamientos concretos del día a día y encontrar personas con necesidades parecidas.</p><div className="mt-8 grid gap-5 md:grid-cols-4">{useCases.map(([title, text]) => <article key={title} className="rounded-3xl bg-slate-50 p-6"><h3 className="font-black">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{text}</p></article>)}</div></div></section>

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
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div className="rounded-[2rem] bg-white p-6 text-slate-950">
              <h3 className="text-xl font-black">Ciudades para compartir coche</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">Páginas locales para captar búsquedas de carpooling y viajes compartidos por ciudad.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {localCityLinks.map(([href, label]) => <a key={href} href={href} className="rounded-full border px-4 py-2 text-sm font-black hover:bg-slate-50">{label}</a>)}
              </div>
            </div>
            <div className="rounded-[2rem] bg-orange-500 p-6 text-white">
              <h3 className="text-xl font-black">Aeropuertos y trayectos frecuentes</h3>
              <p className="mt-2 text-sm leading-6 text-white/80">Enlaces a páginas de aeropuertos para captar usuarios con horarios compatibles y viajes puntuales.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {localAirportLinks.map(([href, label]) => <a key={href} href={href} className="rounded-full bg-white px-4 py-2 text-sm font-black text-orange-600 hover:bg-orange-50">{label}</a>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-16"><div className="mx-auto max-w-5xl"><h2 className="text-3xl font-black tracking-tight">Guías útiles para compartir trayectos</h2><p className="mt-4 max-w-3xl leading-8 text-slate-600">Contenido orientado a búsquedas frecuentes sobre carpooling, compartir coche, viajes compartidos, rutas compartidas, ahorro, trabajo y universidad.</p><div className="mt-8 grid gap-5 md:grid-cols-5">{guides.map(([href, label]) => <a key={href} href={href} className="rounded-3xl border p-6 font-black hover:bg-slate-50">{label}</a>)}</div></div></section>

      <section className="bg-slate-50 px-6 py-16"><div className="mx-auto max-w-5xl"><h2 className="text-3xl font-black tracking-tight">Rutas populares</h2><p className="mt-4 max-w-2xl leading-7 text-slate-600">Consulta páginas específicas para compartir trayectos, coche, taxi y carpooling en ciudades y destinos frecuentes.</p><div className="mt-8 grid gap-5 md:grid-cols-3">{[...carpoolingRoutes, ...sharedCarRoutes, ...sharedTripRoutes, ...sharedRoutePages, ...cityRoutes, ...airportRoutes].map(([href, label]) => <a key={href} href={href} className="rounded-3xl bg-white p-6 font-black shadow-sm hover:shadow-md">{label}</a>)}</div><a href="/rutas/" className="mt-8 inline-flex rounded-full bg-slate-950 px-6 py-4 font-black text-white">Ver todas las rutas y guías</a></div></section>

      <section className="bg-slate-950 px-6 py-16 text-white"><div className="mx-auto max-w-5xl"><h2 className="text-3xl font-black tracking-tight">Confianza y uso responsable</h2><p className="mt-5 max-w-3xl leading-8 text-white/70">ShareWay está diseñado para facilitar conexiones entre usuarios de forma responsable, con información clara, perfiles y canales de contacto.</p><div className="mt-8 grid gap-5 md:grid-cols-3"><article className="rounded-3xl bg-white/10 p-6"><h3 className="font-black">Perfiles de usuario</h3><p className="mt-3 text-sm leading-6 text-white/70">Ayudan a conocer mejor con quién se coordina cada trayecto.</p></article><article className="rounded-3xl bg-white/10 p-6"><h3 className="font-black">Comunicación clara</h3><p className="mt-3 text-sm leading-6 text-white/70">Organiza horarios, puntos de encuentro y detalles antes de viajar.</p></article><article className="rounded-3xl bg-white/10 p-6"><h3 className="font-black">Soporte y contacto</h3><p className="mt-3 text-sm leading-6 text-white/70">La página de contacto permite consultar dudas o comunicar incidencias.</p></article></div></div></section>

      <section className="px-6 py-16"><div className="mx-auto max-w-5xl"><h2 className="text-3xl font-black tracking-tight">Preguntas frecuentes</h2><div className="mt-8 space-y-5">{faqs.map(([question, answer]) => <article key={question} className="rounded-3xl bg-slate-50 p-6"><h3 className="text-xl font-black">{question}</h3><p className="mt-3 leading-7 text-slate-600">{answer}</p></article>)}</div></div></section>

      <section className="px-6 py-20"><div className="mx-auto max-w-5xl rounded-[2rem] bg-orange-500 p-10 text-white md:p-14"><h2 className="text-4xl font-black tracking-tight">Empieza a compartir trayectos hoy</h2><p className="mt-5 max-w-2xl text-lg leading-8 text-white/90">Crea tu cuenta, publica una ruta o encuentra personas con trayectos compatibles. ShareWay te ayuda a moverte de forma más eficiente.</p><div className="mt-8 flex flex-wrap gap-4"><a href="/register" className="rounded-full bg-white px-6 py-4 font-black text-orange-600">Crear cuenta gratis</a><a href="/login" className="rounded-full border border-white/60 px-6 py-4 font-black text-white">Ya tengo cuenta</a></div></div></section>

      <footer className="border-t border-slate-100 px-6 py-10"><div className="mx-auto flex max-w-5xl flex-col gap-4 text-sm text-slate-500 md:flex-row md:items-center md:justify-between"><p>© ShareWay</p><nav className="flex flex-wrap gap-4"><a href="/carpooling/" className="hover:text-slate-950">Carpooling</a><a href="/viajes-compartidos/" className="hover:text-slate-950">Viajes compartidos</a><a href="/rutas-compartidas/" className="hover:text-slate-950">Rutas compartidas</a><a href="/rutas/" className="hover:text-slate-950">Rutas</a><a href="/ciudades/barcelona/" className="hover:text-slate-950">Barcelona</a><a href="/rutas/pineda-de-mar/barcelona/" className="hover:text-slate-950">Pineda - Barcelona</a><a href="/rutas/girona/barcelona/" className="hover:text-slate-950">Girona - Barcelona</a><a href="/contacto/" className="hover:text-slate-950">Contacto</a><a href="/aviso-legal/" className="hover:text-slate-950">Aviso Legal</a><a href="/privacidad/" className="hover:text-slate-950">Privacidad</a><a href="/cookies/" className="hover:text-slate-950">Cookies</a><a href="/terminos/" className="hover:text-slate-950">Términos</a></nav></div></footer>
    </main>
  );
}

export default LandingPage;
