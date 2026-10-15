import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, PhoneCall, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button.jsx';
import { supabase } from '@/lib/supabase.js';
import { getRideDetailsSecure } from '@/lib/supabaseRPC.js';
import { triggerSOS } from '@/services/safetyService.js';
import { cn } from '@/lib/utils.js';

const parseRideIdFromPath = (pathname) => {
  const match = pathname.match(/^\/ride\/([^/]+)/);
  return match?.[1] || null;
};

const isActiveRideStatus = (status) => status === 'active' || status === 'in_progress';
const normalizeId = (value) => value?.toString?.().toLowerCase?.() || '';

export default function RideEmergencyQuickAction() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [user, setUser] = useState(null);
  const [ride, setRide] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const rideId = parseRideIdFromPath(pathname);

  useEffect(() => {
    const syncPath = () => setPathname(window.location.pathname);
    const timer = window.setInterval(syncPath, 800);

    window.addEventListener('popstate', syncPath);
    window.addEventListener('hashchange', syncPath);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('popstate', syncPath);
      window.removeEventListener('hashchange', syncPath);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data?.user || null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadRide = async () => {
      setRide(null);
      setIsVisible(false);
      setIsDismissed(false);

      if (!rideId || !user?.id) return;

      try {
        const response = await getRideDetailsSecure(rideId);
        const payload = response?.data;
        const rideData = payload?.success ? payload.data : null;

        if (cancelled || !rideData) return;

        const userId = normalizeId(user.id);
        const driverId = normalizeId(rideData.driver_id);
        const passengers = Array.isArray(rideData.passengers) ? rideData.passengers : [];
        const participantIds = Array.isArray(rideData.participant_ids) ? rideData.participant_ids : [];
        const isDriver = userId && driverId && userId === driverId;
        const isPassenger = participantIds.some((participantId) => normalizeId(participantId) === userId)
          || passengers.some((passenger) => {
            const passengerId = passenger.id || passenger.user_id || passenger.passenger_id;
            return normalizeId(passengerId) === userId && normalizeId(passenger.status) !== 'cancelled';
          });
        const canUseSOS = isActiveRideStatus(rideData.status) && (isDriver || isPassenger);

        setRide(rideData);
        setIsVisible(canUseSOS);
      } catch (error) {
        console.warn('[RideEmergencyQuickAction] SOS visibility check failed:', error);
      }
    };

    loadRide();

    return () => {
      cancelled = true;
    };
  }, [rideId, user?.id]);

  const activateSOS = async () => {
    if (!rideId || isActivating) return;

    setIsActivating(true);
    try {
      const result = await triggerSOS(rideId);
      if (!result?.success) {
        throw new Error(result?.message || result?.error || 'El servidor no confirmó el SOS');
      }

      toast.success('SOS activado', {
        description: 'Se ha abierto el canal de emergencia. Llama al 112 si hay peligro inmediato.',
        duration: 6000,
      });
      setIsConfirmOpen(false);
      window.location.assign(`/emergency/${rideId}`);
    } catch (error) {
      console.error('[RideEmergencyQuickAction] trigger failed:', error);
      toast.error('No se pudo activar SOS', {
        description: error.message || 'Revisa conexión y vuelve a intentarlo.',
      });
    } finally {
      setIsActivating(false);
    }
  };

  if (!rideId || !isVisible || isDismissed) return null;

  return (
    <>
      <div className="fixed right-4 top-[5.25rem] z-[60] max-w-[calc(100vw-2rem)] sm:right-6 sm:top-24">
        <div
          className={cn(
            'w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-[1.75rem] border border-red-200 bg-white shadow-2xl shadow-red-200/60',
            'animate-in fade-in slide-in-from-top-4 duration-300',
          )}
        >
          <div className="flex items-start gap-3 bg-red-600 px-4 py-3 text-white">
            <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <ShieldAlert className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-100">Viaje en curso</p>
              <h3 className="text-base font-black uppercase italic leading-tight">SOS rápido</h3>
            </div>
            <button
              type="button"
              onClick={() => setIsDismissed(true)}
              className="rounded-xl p-2 text-white/80 hover:bg-white/10 hover:text-white active:scale-95"
              aria-label="Ocultar SOS rápido"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-3 p-4">
            <p className="text-xs font-bold leading-relaxed text-slate-600">
              Si estás en peligro durante este viaje, activa SOS y se abrirá el canal de emergencia con registro para soporte.
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button
                type="button"
                onClick={() => setIsConfirmOpen(true)}
                disabled={isActivating}
                className="h-12 rounded-2xl bg-red-600 text-[10px] font-black uppercase tracking-widest text-white shadow-xl shadow-red-100 hover:bg-red-700 active:scale-95"
              >
                {isActivating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <AlertTriangle className="mr-2 size-4" />}
                Activar SOS
              </Button>
              <a
                href="tel:112"
                className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-xl active:scale-95"
                aria-label="Llamar al 112"
              >
                <PhoneCall className="size-4" />
              </a>
            </div>
            {ride?.status && (
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                Disponible durante viaje en curso · {ride.status === 'in_progress' ? 'en progreso' : 'activo'}
              </p>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={isConfirmOpen} onOpenChange={(open) => !isActivating && setIsConfirmOpen(open)}>
        <AlertDialogContent className="rounded-3xl border-none p-8">
          <AlertDialogHeader>
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <AlertDialogTitle className="text-2xl font-black italic uppercase tracking-tighter">
              ¿Activar SOS ahora?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 pt-2 text-slate-500">
              <span className="block font-semibold leading-6">
                Esta acción registrará una alerta de emergencia del viaje, avisará a administradores y abrirá el canal SOS.
              </span>
              <span className="block rounded-2xl bg-red-50 p-4 text-xs font-black uppercase tracking-widest text-red-600">
                Si hay peligro inmediato, llama también al 112.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 gap-3">
            <AlertDialogCancel
              disabled={isActivating}
              className="h-14 rounded-2xl border-2 border-slate-100 text-[10px] font-bold uppercase tracking-widest"
            >
              Cerrar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isActivating}
              onClick={(event) => {
                event.preventDefault();
                activateSOS();
              }}
              className="h-14 rounded-2xl bg-red-600 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-red-700"
            >
              {isActivating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sí, activar SOS'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
