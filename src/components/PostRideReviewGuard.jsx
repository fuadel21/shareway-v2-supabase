import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { fetchPostRideReviewAccess } from '../lib/postRideReviewAccess.js';

const PostRideReviewGuard = ({ children }) => {
  const { rideId, revieweeId } = useParams();
  const { user } = useOutletContext();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, allowed: false, reason: null });

  useEffect(() => {
    let active = true;

    const check = async () => {
      setState({ loading: true, allowed: false, reason: null });
      try {
        const result = await fetchPostRideReviewAccess({
          rideId,
          reviewerId: user?.id,
          revieweeId,
        });
        if (active) setState({ loading: false, allowed: result.allowed, reason: result.reason });
      } catch (error) {
        console.error('Post-ride review access check failed:', error);
        if (active) {
          setState({
            loading: false,
            allowed: false,
            reason: 'No pudimos verificar este viaje. Vuelve a intentarlo desde Mis viajes.',
          });
        }
      }
    };

    check();
    return () => { active = false; };
  }, [rideId, revieweeId, user?.id]);

  if (state.loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Verificando viaje completado…</p>
      </div>
    );
  }

  if (!state.allowed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
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
          <Button className="mt-7 h-13 w-full rounded-2xl font-black uppercase" onClick={() => navigate('/my-rides', { replace: true })}>
            Volver a Mis viajes
          </Button>
        </div>
      </div>
    );
  }

  return children;
};

export default PostRideReviewGuard;
