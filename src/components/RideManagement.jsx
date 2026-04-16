
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ShieldAlert, MessageCircle, Navigation, Loader2, PlayCircle, ShieldCheck, Settings2, BadgeCheck, UserX, MapPin, MapPinCheck, Radio, Users, CheckCircle2, AlertTriangle, Clock, Star, Info, MapPinned, Lock } from 'lucide-react';
import PinVerificationDialog from './PinVerificationDialog';
import { startRide, completeRide, verifyPassenger, removePassenger, markNoShow, acceptPassenger, cancelRide } from '@/services/rideService';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const PassengerItem = ({ passenger, onVerify, onNoShow, isRideActive, rideId }) => {
    const navigate = useNavigate();
    const displayName = passenger.displayName || passenger.display_name || passenger.full_name || 'Pasajero';
    const photoURL = passenger.photoURL || passenger.photo_url || passenger.avatar_url;

    const isVerified = passenger.status === 'on_board' || passenger.status === 'verified' || passenger.status === 'completed';
    const isNoShow = passenger.status === 'no_show';
    const isCancelled = ['cancelled', 'rejected'].includes(passenger.status);
    const isBlocked = (passenger.failed_attempts || 0) >= 3;

    const pickup = passenger.pickup_location || passenger.pickupLocation;

    if (isCancelled) return null;

    return (
        <div className={cn(
            "flex flex-col p-4 lg:p-5 rounded-2xl lg:rounded-3xl border shadow-sm mb-3 transition-all bg-white border-slate-100 text-left",
            (isNoShow || isBlocked) && "opacity-60 bg-slate-50"
        )}>
            <div className="flex items-center justify-between gap-3">
                <div className="items-center flex gap-3 lg:gap-4 text-left flex-1 min-w-0">
                    <Avatar className="h-10 w-10 lg:h-12 lg:w-12 border-2 border-white shadow-md shrink-0">
                        <AvatarImage src={photoURL} />
                        <AvatarFallback className="font-bold">{displayName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="text-left flex-1 min-w-0">
                        <div className="flex items-center justify-between lg:justify-start gap-2">
                            <p className="font-black text-slate-900 text-xs lg:text-sm uppercase italic tracking-tighter truncate">{displayName}</p>
                            <div className="flex gap-1 shrink-0">
                                <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="size-7 lg:size-8 rounded-lg bg-slate-50 text-primary hover:bg-primary/10 transition-colors"
                                    onClick={() => navigate(`/ride-chat/${rideId}/${passenger.id}`)}
                                >
                                    <MessageCircle size={12} className="lg:size-[14px]" />
                                </Button>
                                {pickup && (
                                    <Button 
                                        size="icon" 
                                        variant="ghost" 
                                        className="size-7 lg:size-8 rounded-lg bg-slate-50 text-emerald-500 hover:bg-emerald-50 transition-colors"
                                        onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${pickup.lat},${pickup.lng}`, '_blank')}
                                    >
                                        <Navigation size={12} className="lg:size-[14px]" />
                                    </Button>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                            <div className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                isVerified ? "bg-emerald-500" : isBlocked ? "bg-red-500" : passenger.status === 'pending' ? "bg-indigo-500 animate-pulse" : "bg-amber-400"
                            )} />
                            <span className={cn(
                                "text-[8px] lg:text-[10px] font-bold uppercase tracking-widest truncate",
                                isBlocked ? "text-red-500" : "text-slate-400"
                            )}>
                                {isVerified ? 'VERIFICADO' : isBlocked ? 'BLOQUEADO' : passenger.status === 'pending' ? 'PENDIENTE' : 'CONFIRMADO'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex shrink-0">
                    {!isVerified && !isNoShow && !isBlocked && passenger.status !== 'pending' && (
                        <div className="flex flex-col gap-2">
                            <Button size="sm" className="h-8 lg:h-9 rounded-xl bg-primary text-white font-black text-[9px] lg:text-[10px] px-3 lg:px-4" onClick={() => onVerify(passenger)}>VERIFICAR</Button>
                            <Button size="sm" variant="ghost" className="h-7 rounded-xl text-red-500 font-bold text-[8px] uppercase" onClick={() => onNoShow(passenger)}>No se presentó</Button>
                        </div>
                    )}
                    {isVerified && (
                        <div className="bg-emerald-50 text-emerald-600 px-3 py-1.5 lg:px-4 lg:py-2 rounded-xl flex items-center gap-1.5 border border-emerald-100">
                            <BadgeCheck size={14} className="lg:size-[16px]" />
                            <span className="text-[8px] lg:text-[10px] font-black uppercase tracking-tighter italic">A bordo</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const RideManagement = ({ ride, onRefresh }) => {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [isPinDialogOpen, setIsPinDialogOpen] = useState(false);
    const [selectedPassenger, setSelectedPassenger] = useState(null);
    const [isSharingLocation, setIsSharingLocation] = useState(false);
    const [currentCoords, setCurrentCoords] = useState(null);

    const locationIntervalRef = useRef(null);

    const isRideStarted = ride.status === 'active' || ride.status === 'in_progress';
    const isRideScheduled = ride.status === 'scheduled';
    const isRideCompleted = ride.status === 'completed';

    const hasPassengers = useMemo(() => {
        return (ride.passengers || []).some(p => !['cancelled', 'rejected', 'pending'].includes(p.status));
    }, [ride.passengers]);

    const pendingVerifications = useMemo(() => {
        return (ride.passengers || []).filter(p => p.status === 'confirmed').length;
    }, [ride.passengers]);

    // Lógica 1: Ventana de tiempo de 15 minutos para iniciar
    const isTimeWindowOpen = useMemo(() => {
        if (!ride.departure_time) return false;
        const depTime = new Date(ride.departure_time).getTime();
        const now = new Date().getTime();
        return now >= (depTime - (15 * 60 * 1000));
    }, [ride.departure_time]);

    // Lógica 2: Geovalla de llegada (500 metros del destino)
    const isAtDestination = useMemo(() => {
        if (!currentCoords || !ride.destination?.coordinates) return false;
        const dest = ride.destination.coordinates;
        
        // Haversine distance simplified
        const R = 6371e3; // metres
        const φ1 = currentCoords.lat * Math.PI/180;
        const φ2 = dest.lat * Math.PI/180;
        const Δφ = (dest.lat - currentCoords.lat) * Math.PI/180;
        const Δλ = (dest.lng - currentCoords.lng) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const d = R * c;

        return d <= 500; // 500 metros
    }, [currentCoords, ride.destination]);

    // Lógica 3: ¿Se puede finalizar? (GPS o Verificación manual del pasajero)
    const canCompleteRide = useMemo(() => {
        // Si ya verificó a todos los pasajeros, permitimos finalizar (autorización manual)
        if (pendingVerifications === 0 && hasPassengers) return true;
        // O si está físicamente en el destino
        return isAtDestination;
    }, [pendingVerifications, hasPassengers, isAtDestination]);

    const syncGPSNow = async () => {
        return new Promise((resolve) => {
            if (!navigator.geolocation) return resolve(false);
            navigator.geolocation.getCurrentPosition(async (position) => {
                const { latitude, longitude } = position.coords;
                setCurrentCoords({ lat: latitude, lng: longitude });
                try {
                    await supabase.rpc('update_ride_location', { p_ride_id: ride.id, p_lat: latitude, p_lng: longitude });
                    setIsSharingLocation(true);
                    resolve(true);
                } catch (e) {
                    resolve(false);
                }
            }, () => resolve(false), { enableHighAccuracy: true, timeout: 5000 });
        });
    };

    const startLocationSharing = useCallback(() => {
        if (locationIntervalRef.current) return;
        syncGPSNow();
        locationIntervalRef.current = setInterval(syncGPSNow, 20000);
    }, [ride.id]);

    const stopLocationSharing = useCallback(() => {
        if (locationIntervalRef.current) {
            clearInterval(locationIntervalRef.current);
            locationIntervalRef.current = null;
        }
        setIsSharingLocation(false);
    }, []);

    useEffect(() => {
        if (isRideStarted) startLocationSharing();
        else stopLocationSharing();
        return () => stopLocationSharing();
    }, [isRideStarted, startLocationSharing, stopLocationSharing]);

    const handleStartRide = async () => {
        if (isLoading) return;
        if (!isTimeWindowOpen) {
            return toast.error("Demasiado pronto", { description: "Estará disponible 15 min antes de la hora." });
        }
        setIsLoading(true);
        try {
            await syncGPSNow();
            await startRide(ride.id);
            toast.success("¡Buen viaje! GPS activado.");
            if (onRefresh) await onRefresh();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCompleteRide = async () => {
        if (!canCompleteRide) {
            return toast.error("Acción bloqueada", { 
                description: "Debes estar en el destino o verificar a todos los pasajeros." 
            });
        }
        setIsLoading(true);
        try {
            await syncGPSNow();
            await completeRide(ride.id);
            stopLocationSharing();
            toast.success("Viaje finalizado y pagos procesados.");
            navigate('/my-rides');
        } catch (e) {
            toast.error(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Card className="rounded-[2.5rem] border-none shadow-2xl bg-white overflow-hidden p-6 lg:p-10 space-y-8 relative">
            {isSharingLocation && (
                <div className="absolute top-6 right-8 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100 shadow-sm">
                    <Radio size={12} className="animate-pulse" />
                    <span className="text-[9px] font-black uppercase tracking-widest">GPS ACTIVO</span>
                </div>
            )}

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-slate-900 p-3 rounded-2xl shadow-lg"><Settings2 className="text-primary h-5 w-5" /></div>
                    <h3 className="font-black text-xl text-slate-900 tracking-tighter uppercase italic leading-none">Gestión del Viaje</h3>
                </div>
            </div>

            <div className="space-y-3">
                {ride.passengers && ride.passengers.length > 0 ? (
                    ride.passengers.filter(p => !['cancelled', 'rejected'].includes(p.status)).map(pax => (
                        <PassengerItem
                            key={pax.id}
                            passenger={pax}
                            rideId={ride.id}
                            isRideActive={isRideStarted}
                            onVerify={(p) => {
                                setSelectedPassenger({ ...p, displayName: p.displayName || p.display_name || p.full_name });
                                setIsPinDialogOpen(true);
                            }}
                            onNoShow={async (p) => {
                                if (window.confirm(`¿Confirmas que ${p.displayName} no se ha presentado?`)) {
                                    setIsLoading(true);
                                    try {
                                        await markNoShow(ride.id, p.id);
                                        toast.success("No-show registrado");
                                        if (onRefresh) await onRefresh();
                                    } catch (e) { toast.error(e.message); }
                                    finally { setIsLoading(false); }
                                }
                            }}
                        />
                    ))
                ) : (
                    <div className="p-12 text-center bg-slate-50 rounded-[2.5rem] border-2 border-dashed border-slate-100">
                        <Users className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Esperando pasajeros...</p>
                    </div>
                )}
            </div>

            <div className="pt-4 space-y-4">
                {isRideScheduled && (
                    <div className="space-y-3">
                        <Button
                            onClick={handleStartRide}
                            disabled={isLoading || !hasPassengers || !isTimeWindowOpen}
                            className={cn(
                                "w-full h-16 rounded-[1.8rem] font-black text-lg shadow-xl active:scale-95 transition-all uppercase italic",
                                !isTimeWindowOpen || !hasPassengers ? "bg-slate-100 text-slate-300 border-none" : "bg-slate-900 text-white"
                            )}
                        >
                            {isLoading ? <Loader2 className="animate-spin" /> : <>INICIAR VIAJE <PlayCircle className="ml-2 text-primary h-5 w-5" /></>}
                        </Button>
                        {!isTimeWindowOpen && hasPassengers && (
                            <div className="flex items-center gap-2 justify-center py-2 text-amber-600 bg-amber-50 rounded-xl animate-pulse">
                                <Clock size={14} />
                                <span className="text-[9px] font-black uppercase tracking-widest">Disponible 15 min antes de la salida</span>
                            </div>
                        )}
                    </div>
                )}

                {isRideStarted && (
                    <div className="space-y-3">
                        <Button
                            onClick={handleCompleteRide}
                            disabled={isLoading}
                            className={cn(
                                "w-full h-16 rounded-[1.8rem] font-black text-lg shadow-xl active:scale-95 transition-all uppercase italic",
                                !canCompleteRide ? "bg-slate-200 text-slate-400 cursor-not-allowed border-none" : "bg-emerald-600 text-white"
                            )}
                        >
                            {isLoading ? <Loader2 className="animate-spin" /> : (canCompleteRide ? "FINALIZAR VIAJE" : "BLOQUEADO HASTA LLEGADA")}
                        </Button>
                        
                        {!canCompleteRide && (
                            <div className="p-4 bg-slate-100 rounded-2xl flex items-start gap-3 border border-slate-200">
                                <MapPinned size={18} className="text-slate-400 shrink-0 mt-0.5" />
                                <div className="text-left">
                                    <p className="text-[10px] font-black text-slate-900 uppercase tracking-tighter italic">Seguridad de Pago</p>
                                    <p className="text-[9px] font-bold text-slate-500 leading-snug">El botón se activará cuando llegues al destino (GPS) o cuando verifiques a los pasajeros.</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <PinVerificationDialog
                open={isPinDialogOpen}
                onOpenChange={setIsPinDialogOpen}
                onConfirm={handleConfirmPin}
                isLoading={isLoading}
                title={`Verificar a ${selectedPassenger?.displayName}`}
            />
        </Card>
    );
};

export default RideManagement;
