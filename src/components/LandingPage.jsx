function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-slate-950 px-6 py-20">
      <section className="mx-auto max-w-5xl">
        <h1 className="text-5xl font-black tracking-tight">Comparte trayectos con ShareWay</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">ShareWay ayuda a conectar personas que quieren compartir ruta, ahorrar en sus desplazamientos y moverse de forma más eficiente.</p>
        <div className="mt-8 flex gap-4">
          <a href="/register" className="rounded-full bg-orange-500 px-6 py-4 font-black text-white">Crear cuenta</a>
          <a href="/login" className="rounded-full border px-6 py-4 font-black">Iniciar sesión</a>
        </div>
      </section>
    </main>
  );
}

export default LandingPage;
