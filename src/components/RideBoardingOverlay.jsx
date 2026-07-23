import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BadgeCheck, ChevronDown, ChevronUp, Fingerprint, Loader2, Lock, UserX, Users } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import {
  getRideDetailsSecure,
  getRideStartReadiness,
  handlePassengerNoShow,
  verifyPassenger,
} from '../lib/supabaseRPC.js';

const getRideIdFromPath = () => {
  const match = window.location.pathname.match(/^\/ride\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
};

const passengerName = (passenger) =>
  passenger?.displayName || passenger?.display_name || passenger?.name || 'Pasajero';

const passengerStatus = (passenger) => String(passenger?.status || '').toLowerCase();

const RideBoardingOverlay = () => {
  const [rideId, setRideId] = useState(getRideIdFromPath);
  const [ride, setRide] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [selectedPassengerId, setSelectedPassengerId] = useState(null);
  const [pin, setPin] = useState('');
  const [busyPassengerId, setBusyPassengerId] = useState(null);

  useEffect(() => {
    let previous = window.location.pathname;
    const timer = window.setInterval(() => {
      if (window.location.pathname !== previous) {
        previous = window.location.pathname;
        setRideId(getRideIdFromPath());
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setCurrentUserId(data?.user?.id || null);
    });
    return () => { mounted = false; };
  }, [rideId]);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!rideId) {
      setRide(null);
      setReadiness(null);
      return;
    }

    if (!quiet) setLoading(true);
    try {
      const detailsResponse = await getRideDetailsSecure(rideId);
      const payload = detailsResponse?.data;
      const rideData = payload?.success ? payload.data : null;
      setRide(rideData);

      if (!rideData || String(rideData.driver_id) !== String(currentUserId)) {
        setReadiness(null);
        return;
      }

      const readinessResponse = await getRideStartReadiness(rideId);
      if (readinessResponse?.success) {
        setReadiness(readinessResponse.data);
      } else {
        setReadiness({
          ready: false,
          unavailable: true,
          unresolved_count: null,
          unresolved_passengers: [],
          error: readinessResponse?.error || 'No se pudo comprobar el embarque.',
        });
      }
    } catch (error) {
      setReadiness({
        ready: false,
        unavailable: true,
        unresolved_count: null,
        unresolved_passengers: [],
        error: error?.message || 'No se pudo comprobar el embarque.',
      });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [rideId, currentUserId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!rideId) return undefined;
    const channel = supabase
      .channel(`boarding_overlay_${rideId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: `id=eq.${rideId}`,
      }, () => refresh({ quiet: true }))
      .subscribe();

    const onFocus = () => refresh({ quiet: true });
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      supabase.removeChannel(channel);
    };
  }, [rideId, refresh]);

  const isDriver = ride && currentUserId && String(ride.driver_id) === String(currentUserId);
  const isScheduled = ride?.status === 'scheduled';

  const unresolvedPassengers = useMemo(() => {
    const fromReadiness = Array.isArray(readiness?.unresolved_passengers)
      ? readiness.unresolved_passengers
      : [];
    if (fromReadiness.length > 0) return fromReadiness;
    return (Array.isArray(ride?.passengers) ? ride.passengers : []).filter((passenger) =>
      ['confirmed', 'accepted', 'pending_boarding'].includes(passengerStatus(passenger))
    );
  }, [readiness, ride]);

  const verifiedCount = Number(readiness?.verified_count ||
    (Array.isArray(ride?.passengers)
      ? ride.passengers.filter((passenger) => ['verified', 'completed'].includes(passengerStatus(passenger))).length
      : 0));

  const departureTime = ride?.departure_time ? new Date(ride.departure_time).getTime() : Number.NaN;
  const now = Date.now();
  const canVerify = Number.isFinite(departureTime) && now >= departureTime - 15 * 60 * 1000;
  const canMarkNoShow = Number.isFinite(departureTime) && now >= departureTime;
  const startBlocked = isScheduled && readiness?.ready !== true;

  const submitPin = async (passenger) => {
    const cleanPin = pin.trim();
    if (!/^\d{4,8}$/.test(cleanPin)) {
      toast.error('Introduce un PIN válido');
      return;
    }

    setBusyPassengerId(passenger.id);
    try {
      const result = await verifyPassenger(rideId, cleanPin, passenger.id);
      if (!result?.success) throw new Error(result?.error || result?.message || 'PIN incorrecto');
      toast.success(`${passengerName(passenger)} verificado`);
      setPin('');
      setSelectedPassengerId(null);
      await refresh({ quiet: true });
    } catch (error) {
      toast.error('No se pudo verificar el PIN', { description: error?.message });
    } finally {
      setBusyPassengerId(null);
    }
  };

  const markNoShow = async (passenger) => {
    if (!canMarkNoShow) {
      toast.error('Todavía no puedes marcar no-show', {
        description: 'Esta opción se habilita al llegar la hora de salida.',
      });
      return;
    }

    const confirmed = window.confirm(`¿Confirmas que ${passengerName(passenger)} no se ha presentado?`);
    if (!confirmed) return;

    setBusyPassengerId(passenger.id);
    try {
      const result = await handlePassengerNoShow(rideId, passenger.id);
      if (!result?.success) throw new Error(result?.error || 'No se pudo registrar el no-show');
      toast.success('No-show registrado');
      await refresh({ quiet: true });
    } catch (error) {
      toast.error('No se pudo registrar el no-show', { description: error?.message });
    } finally {
      setBusyPassengerId(null);
    }
  };

  if (!rideId || !isDriver || !isScheduled) return null;

  return (
    <>
      <section className="fixed left-4 right-4 bottom-40 z-[65] mx-auto max-w-xl rounded-[2rem] border-2 border-white bg-white/95 p-4 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3">
            <div className={`flex size-11 items-center justify-center rounded-2xl ${readiness?.ready ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
              {loading ? <Loader2 className="size-5 animate-spin" /> : readiness?.ready ? <BadgeCheck className="size-5" /> : <Users className="size-5" />}
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Control de embarque</p>
              <p className="text-sm font-black text-slate-900">
                {readiness?.ready
                  ? `Todo listo · ${verifiedCount} verificado(s)`
                  : readiness?.unavailable
                    ? 'Comprobación no disponible'
                    : `${unresolvedPassengers.length} pasajero(s) pendiente(s)`}
              </p>
            </div>
          </div>
          {expanded ? <ChevronDown className="size-5 text-slate-400" /> : <ChevronUp className="size-5 text-slate-400" />}
        </button>

        {expanded && (
          <div className="mt-4 max-h-56 space-y-3 overflow-y-auto border-t border-slate-100 pt-4">
            {readiness?.unavailable && (
              <div className="rounded-2xl bg-red-50 p-3 text-xs font-bold text-red-600">
                {readiness.error} El inicio permanecerá bloqueado por seguridad.
              </div>
            )}

            {!readiness?.unavailable && unresolvedPassengers.length === 0 && (
              <div className="rounded-2xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                Todos los pasajeros están verificados o resueltos. Ya puedes iniciar el viaje.
              </div>
            )}

            {unresolvedPassengers.map((passenger) => {
              const isBusy = busyPassengerId === passenger.id;
              const isSelected = selectedPassengerId === passenger.id;
              return (
                <div key={passenger.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900">{passengerName(passenger)}</p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">Pendiente de PIN</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!canVerify || isBusy}
                        onClick={() => setSelectedPassengerId(isSelected ? null : passenger.id)}
                        className="flex h-10 items-center gap-1 rounded-xl bg-primary px-3 text-[9px] font-black uppercase text-white disabled:cursor-not-allowed disabled:bg-slate-200"
                      >
                        <Fingerprint className="size-4" /> PIN
                      </button>
                      <button
                        type="button"
                        disabled={!canMarkNoShow || isBusy}
                        onClick={() => markNoShow(passenger)}
                        className="flex h-10 items-center gap-1 rounded-xl bg-red-50 px-3 text-[9px] font-black uppercase text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <UserX className="size-4" /> No-show
                      </button>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="mt-3 flex gap-2">
                      <input
                        value={pin}
                        onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="PIN del pasajero"
                        className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-center text-sm font-black tracking-[0.3em] outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => submitPin(passenger)}
                        className="h-11 rounded-xl bg-emerald-500 px-4 text-[9px] font-black uppercase text-white disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="size-4 animate-spin" /> : 'Verificar'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {!canVerify && unresolvedPassengers.length > 0 && (
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                La verificación se habilita 15 minutos antes de la salida.
              </p>
            )}
            {canVerify && !canMarkNoShow && unresolvedPassengers.length > 0 && (
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                El no-show se habilita al llegar la hora de salida.
              </p>
            )}
          </div>
        )}
      </section>

      {startBlocked && (
        <div className="pointer-events-none fixed bottom-20 left-0 right-0 z-[70] px-6">
          <div className="mx-auto flex max-w-xl gap-3">
            <div className="flex-1" />
            <div className="pointer-events-auto flex-[2]">
              <button
                type="button"
                disabled
                className="flex h-16 w-full items-center justify-center gap-2 rounded-3xl bg-slate-300 px-4 text-center text-[10px] font-black uppercase tracking-wider text-slate-600 shadow-2xl"
              >
                <Lock className="size-4" />
                {readiness?.unavailable
                  ? 'Comprobando embarque'
                  : `Faltan ${unresolvedPassengers.length} pasajero(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default RideBoardingOverlay;
