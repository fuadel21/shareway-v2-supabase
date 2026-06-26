import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Car, Gift, Leaf, ShieldCheck, Users } from 'lucide-react';
import { savePendingReferralCode } from '@/lib/referrals.js';

const InviteLandingPage = () => {
  const { code } = useParams();

  useEffect(() => {
    savePendingReferralCode(code);
    document.title = 'Invitación a ShareWay | Compartir coche y ahorrar';
    const description = 'Únete a ShareWay con una invitación y empieza a compartir coche, ahorrar en trayectos y reducir emisiones.';
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', description);
  }, [code]);

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <section className="relative overflow-hidden bg-slate-950 px-6 py-20 text-white sm:py-28">
        <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_top_right,#22c55e,transparent_35%),radial-gradient(circle_at_bottom_left,#f97316,transparent_30%)]" />
        <div className="relative mx-auto max-w-5xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.25em] text-orange-300">
            <Gift className="h-4 w-4" /> Invitación ShareWay
          </p>
          <h1 className="mx-auto mt-7 max-w-4xl text-4xl font-black leading-[0.95] tracking-tighter sm:text-6xl">
            Te han invitado a compartir coche y ahorrar en tus trayectos
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Crea tu cuenta gratis en ShareWay, publica o busca rutas compatibles y empieza a dividir gastos con personas que van en la misma dirección.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to={`/register?ref=${encodeURIComponent(code || '')}`} className="inline-flex h-14 items-center justify-center rounded-2xl bg-orange-500 px-6 font-black uppercase tracking-widest text-white hover:bg-orange-600">
              Crear cuenta gratis <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
            <Link to="/login" className="inline-flex h-14 items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-6 font-black uppercase tracking-widest text-white hover:bg-white/20">
              Ya tengo cuenta
            </Link>
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-4">
          {[
            [Car, 'Comparte rutas', 'Publica trayectos y aprovecha plazas libres.'],
            [Users, 'Encuentra usuarios', 'Conecta con personas de ruta compatible.'],
            [Leaf, 'Reduce CO₂', 'Menos coches para el mismo desplazamiento.'],
            [ShieldCheck, 'Más confianza', 'Perfiles, chat y herramientas de seguridad.']
          ].map(([Icon, title, text]) => (
            <article key={title} className="rounded-3xl border border-slate-100 bg-slate-50 p-6">
              <Icon className="mb-4 h-7 w-7 text-orange-500" />
              <h2 className="font-black tracking-tight">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
};

export default InviteLandingPage;
