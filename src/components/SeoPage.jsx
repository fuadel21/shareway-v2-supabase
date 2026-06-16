function SeoPage({ eyebrow, title, description, sections }) {
  return (
    <main className="min-h-screen bg-white text-slate-950">
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <a href="/" className="text-sm font-black text-orange-500">← ShareWay</a>
          <p className="mt-10 text-sm font-black uppercase tracking-widest text-orange-500">{eyebrow}</p>
          <h1 className="mt-5 max-w-4xl text-5xl font-black tracking-tight">{title}</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">{description}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <a href="/register" className="rounded-full bg-orange-500 px-6 py-4 font-black text-white">Crear cuenta</a>
            <a href="/login" className="rounded-full border px-6 py-4 font-black">Iniciar sesión</a>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-6 py-16">
        <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3">
          {sections.map((item) => (
            <article key={item.title} className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">{item.title}</h2>
              <p className="mt-3 leading-7 text-slate-600">{item.text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default SeoPage;
