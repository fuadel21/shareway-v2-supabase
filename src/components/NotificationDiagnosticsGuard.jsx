import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { supabase } from '../lib/supabase.js';

const isAdminProfile = (profile) => {
  const role = String(profile?.role || '').toLowerCase();
  return profile?.is_admin === true || role === 'admin' || role === 'super_admin';
};

const NotificationDiagnosticsGuard = () => {
  const [state, setState] = useState({ active: false, loading: false, allowed: true });

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const active = window.location.pathname === '/settings/notification-test';
      if (!active) {
        if (mounted) setState({ active: false, loading: false, allowed: true });
        return;
      }

      if (mounted) setState({ active: true, loading: true, allowed: false });

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) throw new Error('Sesión no válida');

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('role,is_admin')
          .eq('id', user.id)
          .maybeSingle();

        if (error) throw error;
        if (mounted) setState({ active: true, loading: false, allowed: isAdminProfile(profile) });
      } catch (error) {
        console.error('Notification diagnostics access check failed:', error);
        if (mounted) setState({ active: true, loading: false, allowed: false });
      }
    };

    check();
    window.addEventListener('popstate', check);
    window.addEventListener('shareway:navigation', check);
    return () => {
      mounted = false;
      window.removeEventListener('popstate', check);
      window.removeEventListener('shareway:navigation', check);
    };
  }, []);

  if (!state.active || state.allowed) return null;

  if (state.loading) {
    return (
      <div className="fixed inset-0 z-[310] bg-slate-950 flex flex-col items-center justify-center gap-4 text-white">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="text-[10px] font-black uppercase tracking-widest">Verificando acceso administrativo…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[310] bg-slate-950 flex items-center justify-center px-4 text-white">
      <div className="w-full max-w-md rounded-[2.5rem] border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-400/10 text-amber-300">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-black uppercase italic">Herramienta administrativa</h1>
        <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-300">
          Las pruebas de inserción y Realtime están reservadas al Centro de mando.
        </p>
        <Button className="mt-7 h-13 w-full rounded-2xl bg-white text-slate-950 font-black uppercase hover:bg-slate-100" onClick={() => window.location.assign('/settings')}>
          Volver a Ajustes
        </Button>
      </div>
    </div>
  );
};

export default NotificationDiagnosticsGuard;
