import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { supabase } from '../lib/supabase.js';
import { fetchPostRideReviewAccess } from '../lib/postRideReviewAccess.js';
import { subscribeToNavigation } from '../lib/navigationEvents.js';

const getReviewRoute = () => {
  const match = window.location.pathname.match(/^\/leave-review\/([^/]+)\/([^/]+)$/);
  return match ? { rideId: match[1], revieweeId: match[2] } : null;
};

const PostRideReviewGuard = () => {
  const [state, setState] = useState({ active: false, loading: false, allowed: true, reason: null });

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const route = getReviewRoute();
      if (!route) {
        if (mounted) setState({ active: false, loading: false, allowed: true, reason: null });
        return;
      }

      if (mounted) setState({ active: true, loading: true, allowed: false, reason: null });

      try {
        const { data: { user } } = await supabase.auth.getUser();
        const result = await fetchPostRideReviewAccess({
          ...route,
          reviewerId: user?.id,
        });
        if (mounted) setState({ active: true, loading: false, allowed: result.allowed, reason: result.reason });
      } catch (error) {
        console.error('Post-ride review access check failed:', error);
        if (mounted) {
          setState({
            active: true,
            loading: false,
            allowed: false,
            reason: 'No pudimos verificar este viaje. Vuelve a intentarlo desde Mis viajes.',
          });
        }
      }
    };

    check();
    const unsubscribe = subscribeToNavigation(check);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  if (!state.active || state.allowed) return null;

  if (state.loading) {
    return (
      <div className="fixed inset-0 z-[300] bg-slate-50 flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Verificando viaje completado…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[300] bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-[2.5rem] bg-white p-8 text-center shadow-2xl border border-slate-100">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-red-50 text-red-500">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-black uppercase italic text-slate-900">Valoración no disponible</h1>
        <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-500">{state.reason}</p>
        <div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-left text-xs font-bold text-emerald-700 flex gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0" />
          Las valoraciones solo se abren entre participantes de un viaje realmente completado.
        </div>
        <Button className="mt-7 h-13 w-full rounded-2xl font-black uppercase" onClick={() => window.location.assign('/my-rides')}>
          Volver a Mis viajes
        </Button>
      </div>
    </div>
  );
};

export default PostRideReviewGuard;
