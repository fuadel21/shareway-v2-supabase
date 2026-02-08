import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ShieldAlert, MessageCircle, Navigation, Loader2, PlayCircle, ShieldCheck, Settings2, BadgeCheck, UserX, MapPin, MapPinCheck, Radio, Users, CheckCircle2, AlertTriangle, Clock, Star, Info } from 'lucide-react';
import PinVerificationDialog from './PinVerificationDialog';
import { startRide, completeRide, verifyPassenger, removePassenger, markNoShow, acceptPassenger } from '@/services/rideService';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const PassengerItem = ({ passenger, onVerify, isRideActive }) => {
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
            "flex flex-col p-5 rounded-3xl border shadow-sm mb-3 transition-all bg-white border-slate-100 text-left",
            (isNoShow || isBlocked) && "opacity-60 bg-slate-50"
        )}>
            <div className="flex items-center justify-between">
                <div className="items-center flex gap-4 text-left">
                    <Avatar className="h-12 w-12 border-2 border-white shadow-md">
                        <AvatarImage src={photoURL} />
                        <AvatarFallback className="font-bold">{displayName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="text-left">
                        <p className="font-black text-slate-900 text-sm uppercase italic tracking-tighter">{displayName}</p>
                        <div className="flex items-center gap-1">
                            <div className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                isVerified ? "bg-emerald-500" : isBlocked ? "bg-red-500" : passenger.status === 'pending' ? "bg-indigo-500 animate-pulse" : "bg-amber-400"
                            )} />
                            <span className={cn(
                                "text-[10px] font-bold uppercase tracking-widest",
                                isBlocked ? "text-red-500" : "text-slate-400"
                            )}>
                                {isVerified ? 'VERIFICADO' : isBlocked ? 'BLOQUEADO' : passenger.status === 'pending' ? 'PENDIENTE' : 'CONFIRMADO'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2">
                    {!isVerified && !isNoShow && !isBlocked && passenger.status !== 'pending' && (
                        <Button size="sm" className="rounded-xl bg-primary text-white font-black text-[10px] px-4" onClick={() => onVerify(passenger)}>VERIFICAR PIN</Button>
                    )}
                    {isVerified && (
                        <div className="bg-emerald-50 text-emerald-600 px-4 py-2 rounded-xl flex items-center gap-2 border border-emerald-100">
                            <BadgeCheck size={16} />
                            <span className="text-[10px] font-black uppercase tracking-tighter italic">A bordo</span>
                        </div>
                    )}
                </div>
            </div>

            {pickup && (
                <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="bg-primary/10 p-1.5 rounded-lg">
                            <MapPin size={12} className="text-primary" />
                        </div>
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Punto de recogida personalizado</p>
                    </div>
                    <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${pickup.lat},${pickup.lng}`, '_blank')}
                        className="h-8 rounded-xl border-slate-100 bg-slate-50 font-black text-[8px] uppercase tracking-widest gap-2"
                    >
                        <Navigation size={10} className="text-emerald-500" /> NAVEGAR
                    </Button>
                </div>
            )}
        </div>
    );
};

const RideManagement = ({ ride, onRefresh }) => {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [isPinDialogOpen, setIsPinDialogOpen] = useState(false);
    const [selectedPassenger, setSelectedPassenger] = useState(null);
    const [isSharingLocation, setIsSharingLocation] = useState(false);

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

    // RESTAURADO: 15 MINUTOS DE ANTELACIÓN ESTRICTA
    const isTimeWindowOpen = useMemo(() => {
        if (!ride.departure_time) return false;
        const depTime = new Date(ride.departure_time).getTime();
        const now = new Date().getTime();
        return now >= (depTime - (15 * 60 * 1000));
    }, [ride.departure_time]);

    const syncGPSNow = async () => {
        return new Promise((resolve) => {
            if (!navigator.geolocation) return resolve(false);
            navigator.geolocation.getCurrentPosition(async (position) => {
                const { latitude, longitude } = position.coords;
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

        // PROTOCOLO DE SEGURIDAD 1: TIEMPO ESTRICTO
        if (!isTimeWindowOpen) {
            return toast.error("Acceso denegado", {
                description: "Solo puedes iniciar 15 minutos antes de la hora programada."
            });
        }

        // PROTOCOLO DE SEGURIDAD 2: VERIFICACIÓN OBLIGATORIA (RESTAURADO)
        if (pendingVerifications > 0) {
            return toast.warning("Acción bloqueada", {
                description: `Debes verificar el PIN de tus ${pendingVerifications} pasajero(s) antes de arrancar.`
            });
        }

        setIsLoading(true);
        try {
            await syncGPSNow();
            await startRide(ride.id);
            toast.success("¡Trayecto iniciado!");
            if (onRefresh) await onRefresh();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCompleteRide = async () => {
        if (isLoading) return;
        setIsLoading(true);
        try {
            await syncGPSNow();
            await completeRide(ride.id);
            stopLocationSharing();
            toast.success("Viaje finalizado.");

            // EL CONDUCTOR YA NO VALORA A LOS PASAJEROS (Req. Usuario)
            // Redirigimos directamente a sus viajes
            navigate('/my-rides');
        } catch (e) {
            toast.error(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmPin = async (fullPin) => {
        if (!selectedPassenger || isLoading) return;
        setIsLoading(true);
        try {
            await verifyPassenger(ride.id, selectedPassenger.id, fullPin);
            toast.success("Verificado");
            setIsPinDialogOpen(false);
            setSelectedPassenger(null);
            if (onRefresh) await onRefresh();
        } catch (error) {
            toast.error(error.message || "PIN inválido");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Card className="rounded-[2.5rem] border-none shadow-2xl bg-white overflow-hidden p-8 space-y-8 relative">
            {isSharingLocation && (
                <div className="absolute top-6 right-8 flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                    <Radio size={12} className="animate-pulse" />
                    <span className="text-[8px] font-black uppercase tracking-widest">GPS ONLINE</span>
                </div>
            )}

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-slate-900 p-2.5 rounded-2xl shadow-lg"><Settings2 className="text-primary h-5 w-5" /></div>
                    <h3 className="font-black text-xl text-slate-900 tracking-tighter uppercase italic">Gestión de Ruta</h3>
                </div>
                <div className={cn("px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border", isRideStarted ? "bg-emerald-50 text-emerald-600 border-emerald-100" : isRideCompleted ? "bg-slate-50 text-slate-400 border-slate-100" : "bg-indigo-50 text-indigo-600 border-indigo-100")}>
                    {isRideStarted ? 'EN MARCHA' : isRideCompleted ? 'CERRADO' : 'ESPERANDO'}
                </div>
            </div>

            <div className="space-y-3">
                {ride.passengers && ride.passengers.length > 0 ? (
                    ride.passengers.filter(p => !['cancelled', 'rejected'].includes(p.status)).map(pax => (
                        <PassengerItem
                            key={pax.id}
                            passenger={pax}
                            isRideActive={isRideStarted}
                            onVerify={(p) => {
                                setSelectedPassenger({ ...p, displayName: p.displayName || p.display_name || p.full_name });
                                setIsPinDialogOpen(true);
                            }}
                        />
                    ))
                ) : (
                    <div className="p-10 text-center bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-100">
                        <Users className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Sin pasajeros confirmados</p>
                    </div>
                )}
            </div>

            <div className="pt-4 space-y-4">
                {hasPassengers && (
                    <div className="grid grid-cols-2 gap-4">
                        <Button onClick={() => navigate(`/ride-chat/${ride.id}`)} variant="secondary" className="h-14 rounded-2xl font-black text-[10px] uppercase tracking-widest bg-white border-2 border-slate-50">
                            <MessageCircle className="mr-2 h-4 w-4 text-primary" /> CHAT
                        </Button>
                        <Button onClick={() => {
                            const target = isRideStarted ? ride.destination : ride.origin;
                            window.open(`https://www.google.com/maps/dir/?api=1&destination=${target.coordinates?.lat || target.lat},${target.coordinates?.lng || target.lng}`, '_blank');
                        }} variant="secondary" className="h-14 rounded-2xl font-black text-[10px] uppercase tracking-widest bg-white border-2 border-slate-50">
                            <Navigation className="mr-2 h-4 w-4 text-emerald-500" /> GPS
                        </Button>
                    </div>
                )}

                {isRideScheduled && (
                    <div className="space-y-4">
                        <Button
                            onClick={handleStartRide}
                            disabled={isLoading || !hasPassengers || !isTimeWindowOpen || pendingVerifications > 0}
                            className={cn(
                                "w-full h-20 rounded-[2.2rem] font-black text-lg shadow-2xl active:scale-95 transition-all border-none italic uppercase",
                                !isTimeWindowOpen || pendingVerifications > 0 || !hasPassengers
                                    ? "bg-slate-100 text-slate-300"
                                    : "bg-slate-900 text-white"
                            )}
                        >
                            {isLoading ? <Loader2 className="animate-spin h-8 w-8" /> : <>INICIAR VIAJE <PlayCircle className="ml-2 text-primary" /></>}
                        </Button>

                        {(!isTimeWindowOpen || pendingVerifications > 0) && (
                            <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 flex gap-3">
                                <ShieldAlert className="size-4 text-amber-600 shrink-0" />
                                <p className="text-[9px] font-bold text-amber-800 uppercase leading-normal">
                                    {!isTimeWindowOpen ? "Podrás iniciar 15 min antes de la salida." : `Falta verificar a ${pendingVerifications} pasajero(s).`}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {isRideStarted && (
                    <Button
                        onClick={handleCompleteRide}
                        disabled={isLoading}
                        className="w-full h-20 rounded-[2.2rem] bg-emerald-600 hover:bg-emerald-700 text-white font-black text-lg shadow-2xl active:scale-95 transition-all border-none italic uppercase"
                    >
                        {isLoading ? <Loader2 className="animate-spin h-8 w-8" /> : "FINALIZAR VIAJE"}
                    </Button>
                )}

                {isRideScheduled && (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                variant="ghost"
                                className="w-full h-12 rounded-2xl text-red-500 font-bold text-[10px] uppercase tracking-widest hover:bg-red-50 hover:text-red-700 transition-colors"
                            >
                                Cancelar Viaje
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="rounded-[2.5rem] border-none">
                            <AlertDialogHeader>
                                <AlertDialogTitle className="text-xl font-black uppercase italic tracking-tighter">¿Cancelar este viaje?</AlertDialogTitle>
                                <AlertDialogDescription className="text-slate-500 font-medium">
                                    <div className="space-y-3 pt-2">
                                        <p>Esta acción notificará a todos los pasajeros y procesará sus reembolsos íntegros.</p>
                                        <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 text-[10px] font-black uppercase tracking-wider text-amber-700">
                                            ⚠️ PENALIZACIÓN DE SHAREWAY:<br />
                                            - Antes de 24h: 2.00€<br />
                                            - Antes de 2h: 5.00€
                                        </div>
                                    </div>
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="gap-2">
                                <AlertDialogCancel className="rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-slate-100">Cerrar</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={async () => {
                                        setIsLoading(true);
                                        try {
                                            await cancelRide(ride.id);
                                            toast.success("Viaje cancelado correctamente.");
                                            navigate('/my-rides');
                                        } catch (e) {
                                            toast.error(e.message);
                                        } finally {
                                            setIsLoading(false);
                                        }
                                    }}
                                    className="rounded-xl font-bold uppercase text-[10px] tracking-widest bg-red-600 hover:bg-red-700 text-white"
                                >
                                    Confirmar Cancelación
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}

                {isRideCompleted && (
                    <Button
                        onClick={() => navigate('/my-rides')}
                        className="w-full h-20 rounded-[2.2rem] bg-slate-100 text-slate-400 font-black text-lg shadow-inner border-none uppercase italic"
                    >
                        VIAJE COMPLETADO
                    </Button>
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
