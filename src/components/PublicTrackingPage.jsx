import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Car, Clock3, Navigation, RefreshCw, ShieldOff } from 'lucide-react';
import MapComponent from './MapComponent';
import { verifyShareToken } from '../lib/supabaseRPC.js';

const INVALID_LINK_MESSAGE = 'El enlace de seguimiento no es válido, ha caducado o ya no está disponible.';

function PublicTrackingPage() {
    const { rideId } = useParams();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');

    const [ride, setRide] = useState(null);
    const [expiresAt, setExpiresAt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

    useEffect(() => {
        let mounted = true;
        let intervalId;
        let hasLoaded = false;

        const loadSnapshot = async () => {
            if (!rideId || !token) {
                if (mounted) {
                    setError(INVALID_LINK_MESSAGE);
                    setLoading(false);
                }
                return;
            }

            if (hasLoaded && mounted) setRefreshing(true);

            try {
                const response = await verifyShareToken(rideId, token);
                const payload = response?.data;
                if (payload?.success === false) {
                    const invalidLinkError = new Error(INVALID_LINK_MESSAGE);
                    invalidLinkError.code = 'INVALID_SHARE_LINK';
                    throw invalidLinkError;
                }
                if (!response?.success || !payload?.ride) {
                    throw new Error('No se pudo actualizar el seguimiento.');
                }

                if (!mounted) return;
                setRide(payload.ride);
                setExpiresAt(payload.expires_at || null);
                setLastUpdatedAt(payload.ride.location?.updated_at || null);
                setError(null);
                hasLoaded = true;
            } catch (snapshotError) {
                if (!mounted) return;
                if (snapshotError?.code === 'INVALID_SHARE_LINK') {
                    setRide(null);
                    setError(INVALID_LINK_MESSAGE);
                    window.clearInterval(intervalId);
                } else if (!hasLoaded) {
                    setError(INVALID_LINK_MESSAGE);
                }
            } finally {
                if (!mounted) return;
                setLoading(false);
                setRefreshing(false);
            }
        };

        loadSnapshot();
        intervalId = window.setInterval(loadSnapshot, 5000);

        return () => {
            mounted = false;
            window.clearInterval(intervalId);
        };
    }, [rideId, token]);

    const mapItems = useMemo(() => {
        if (!ride) return [];
        const liveLocation = ride.location
            ? {
                id: `${ride.id}-public-live-location`,
                type: 'live-location',
                current_location: ride.location,
                driver_photo_url: ride.driver?.photo_url,
            }
            : null;
        return liveLocation ? [ride, liveLocation] : [ride];
    }, [ride]);

    const currentLocation = ride?.location || null;
    const expiresLabel = expiresAt
        ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(expiresAt))
        : null;
    const lastUpdatedLabel = lastUpdatedAt
        ? new Intl.DateTimeFormat('es-ES', { timeStyle: 'short' }).format(new Date(lastUpdatedAt))
        : null;
    const isCompleted = ride?.status === 'completed';
    const isScheduled = ride?.status === 'scheduled';

    if (loading) {
        return (
            <div className="flex h-screen flex-col items-center justify-center bg-slate-50">
                <div className="relative">
                    <div className="h-24 w-24 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    <Car className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-primary" />
                </div>
                <p className="mt-6 animate-pulse font-black tracking-tight text-primary">LOCALIZANDO VIAJE...</p>
            </div>
        );
    }

    if (error || !ride) {
        return (
            <div className="flex h-screen flex-col items-center justify-center bg-slate-50 p-8 text-center">
                <div className="max-w-sm rounded-3xl border border-red-100 bg-white p-10 shadow-2xl">
                    <ShieldOff className="mx-auto mb-6 h-20 w-20 text-red-500" />
                    <h2 className="mb-4 text-3xl font-black tracking-tight text-gray-900">Acceso no disponible</h2>
                    <p className="font-medium leading-relaxed text-muted-foreground">{error || INVALID_LINK_MESSAGE}</p>
                    <a href="/" className="mt-8 flex h-12 w-full items-center justify-center rounded-2xl bg-primary font-black text-white shadow-lg shadow-primary/20">
                        IR A INICIO
                    </a>
                </div>
            </div>
        );
    }

    const destinationLabel = ride.destination_address || ride.destination?.address || 'Destino';
    const driverName = ride.driver?.display_name || 'Conductor ShareWay';

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-slate-100 font-sans">
            <header className="absolute left-4 right-4 top-4 z-50 sm:left-6 sm:right-6 sm:top-6">
                <div className="flex min-h-14 items-center gap-4 rounded-3xl border border-white/20 bg-white/90 px-5 py-4 shadow-2xl backdrop-blur-xl sm:px-6">
                    <div className="rounded-2xl bg-primary/10 p-3">
                        <Navigation className="h-6 w-6 text-primary" />
                    </div>
                    <div className="min-w-0 flex-grow">
                        <h1 className="mb-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">En camino a</h1>
                        <p className="truncate text-lg font-black tracking-tight text-gray-800">{destinationLabel}</p>
                    </div>
                    <div className="shrink-0 text-right">
                        <div className="flex items-center justify-end gap-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-600">
                            {refreshing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}
                            {isCompleted ? 'Finalizado' : isScheduled ? 'Programado' : 'En tiempo real'}
                        </div>
                        {lastUpdatedLabel && <p className="mt-1 text-[9px] font-bold text-slate-400">Actualizado {lastUpdatedLabel}</p>}
                    </div>
                </div>
            </header>

            <div className="absolute inset-0 z-0">
                <MapComponent
                    center={currentLocation || ride.origin}
                    zoom={14}
                    itemsToDisplay={mapItems}
                    selectedItemId={ride.id}
                    followLocation={Boolean(currentLocation) && !isCompleted}
                    interactive={false}
                />
            </div>

            <div className="absolute bottom-5 left-4 right-4 z-50 sm:bottom-10 sm:left-6 sm:right-6">
                <div className="rounded-3xl border border-white/20 bg-white/90 p-5 shadow-2xl backdrop-blur-xl sm:p-6">
                    <div className="flex items-center gap-4 sm:gap-5">
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border-4 border-emerald-500/20 bg-white shadow-inner">
                            {ride.driver?.photo_url ? (
                                <img src={ride.driver.photo_url} alt="Conductor" className="h-full w-full object-cover" />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center"><Car className="h-8 w-8 text-primary" /></div>
                            )}
                        </div>
                        <div className="min-w-0 flex-grow">
                            <p className="mb-1 text-xs font-black uppercase tracking-widest text-muted-foreground">Conductor</p>
                            <p className="truncate text-xl font-black tracking-tight text-gray-800">{driverName}</p>
                            <div className={`mt-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${isCompleted ? 'text-slate-500' : isScheduled ? 'text-amber-600' : 'text-emerald-600'}`}>
                                <span className={`h-2 w-2 rounded-full ${isCompleted ? 'bg-slate-400' : isScheduled ? 'bg-amber-400' : 'animate-ping bg-emerald-500'}`} />
                                {isCompleted ? 'Viaje finalizado' : isScheduled ? 'Esperando la salida' : currentLocation ? 'Ubicación en tiempo real' : 'Esperando ubicación'}
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> Enlace privado</span>
                        {expiresLabel && <span>Expira {expiresLabel}</span>}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default PublicTrackingPage;
