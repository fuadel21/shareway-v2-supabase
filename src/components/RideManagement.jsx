import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, PlayCircle, ShieldCheck, Settings2, BadgeCheck, UserX, MapPin, MapPinCheck, Radio, Users, CheckCircle2, AlertTriangle } from 'lucide-react';
import PinVerificationDialog from './PinVerificationDialog';
import { startRide, completeRide, verifyPassenger, removePassenger, markNoShow, acceptPassenger } from '@/services/rideService';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

const PassengerItem = ({ passenger, onVerify, onRemove, onNoShow, isRideActive }) => {
    const displayName = passenger.displayName || passenger.display_name || passenger.full_name || 'Pasajero';
    const photoURL = passenger.photoURL || passenger.photo_url || passenger.avatar_url;

    const isVerified = passenger.status === 'on_board' || passenger.status === 'verified' || passenger.status === 'completed';
    const isNoShow = passenger.status === 'no_show';
    const isCancelled = ['cancelled', 'rejected'].includes(passenger.status);
    const isBlocked = (passenger.failed_attempts || 0) >= 3;

    if (isCancelled) return null;

    return (
        <div className={cn(
            "flex items-center justify-between p-5 rounded-3xl border shadow-sm mb-3 transition-opacity bg-white border-slate-100",
            (isNoShow || isBlocked) && "opacity-60 bg-slate-50"
        )}>
            <div className="items-center flex gap-4">
                <Avatar className="h-12 w-12 border-2 border-white shadow-md">
                    <AvatarImage src={photoURL} />
                    <AvatarFallback className="font-bold">{displayName.charAt(0)}</AvatarFallback>
                </Avatar>
                <div>
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
                            {isVerified ? 'VERIFICADO' : isBlocked ? 'BLOQUEADO (3 ERRORES)' : passenger.status === 'pending' ? 'SOLICITUD PENDIENTE' : 'CONFIRMADO'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex gap-2">
                {!isVerified && !isNoShow && !isBlocked && passenger.status !== 'pending' && (
                    <Button size="sm" className="rounded-xl bg-primary text-white font-black text-[10px]" onClick={() => onVerify(passenger)}>VERIFICAR PIN</Button>
                )}
                {isBlocked && (
                    <div className="p-2 text-red-500 bg-red-50 rounded-lg">
                        <AlertTriangle size={14} />
                    </div>
                )}
                {isVerified && (
                    <div className="bg-emerald-50 text-emerald-600 px-4 py-2 rounded-xl flex items-center gap-2 border border-emerald-100">
                        <BadgeCheck size={16} />
                        <span className="text-[10px] font-black uppercase tracking-tighter italic">A bordo</span>
                    </div>
                )}
            </div>
        </div>
    );
};

const RideManagement = ({ ride, profile, onRefresh }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [isPinDialogOpen, setIsPinDialogOpen] = useState(false);
    const [selectedPassenger, setSelectedPassenger] = useState(null);
    const [isSharingLocation, setIsSharingLocation] = useState(false);

    const locationIntervalRef = useRef(null);

    const isRideStarted = ride.status === 'active' || ride.status === 'in_progress';
    const isRideScheduled = ride.status === 'scheduled';
    const isRideCompleted = ride.status === 'completed';

    const stopLocationSharing = useCallback(() => {
        if (locationIntervalRef.current) {
            clearInterval(locationIntervalRef.current);
            locationIntervalRef.current = null;
        }
        setIsSharingLocation(false);
    }, []);

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
                    console.error("GPS Sync failed", e); 
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

    useEffect(() => {
        if (isRideStarted) {
            startLocationSharing();
        } else {
            stopLocationSharing();
        }
        return () => stopLocationSharing();
    }, [isRideStarted, startLocationSharing, stopLocationSharing]);

    const handleStartRide = async () => {
        if (isLoading) return;
        setIsLoading(true);
        try {
            // Sincronizar GPS justo antes de empezar
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
        if (isLoading) return;
        setIsLoading(true);
        const toastId = toast.loading("Verificando ubicación de llegada...");
        try {
            // FORZAR GPS PARA EVITAR ERROR DE GEOFENCING EN SQL
            const gpsOk = await syncGPSNow();
            if (!gpsOk) {
                toast.error("No se pudo obtener tu ubicación GPS. Es obligatoria para cobrar.", { id: toastId });
                setIsLoading(false);
                return;
            }

            await completeRide(ride.id);
            stopLocationSharing();
            toast.success("Viaje completado y pagos procesados.", { id: toastId });
            if (onRefresh) await onRefresh();
        } catch (e) {
            console.error("Complete Ride Error:", e);
            const errorMsg = e.message?.includes('DESTINO_NO_ALCANZADO') 
                ? "Aún no has llegado al destino. Acércate más para finalizar." 
                : e.message;
            toast.error(errorMsg, { id: toastId });
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmPin = async (fullPin) => {
        if (!selectedPassenger || isLoading) return;
        setIsLoading(true);
        try {
            await verifyPassenger(ride.id, selectedPassenger.id, fullPin);
            toast.success("Pasajero verificado correctamente");
            setIsPinDialogOpen(false);
            setSelectedPassenger(null);
            if (onRefresh) await onRefresh();
        } catch (error) {
            console.error("PIN Verification Error:", error);
            if (error.message?.includes('PIN_BLOQUEADO')) {
                toast.error("Pasajero bloqueado: Demasiados intentos fallidos.");
                setIsPinDialogOpen(false);
            } else {
                toast.error(error.message || "PIN incorrecto");
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Card className="rounded-[2.5rem] border-none shadow-2xl bg-white overflow-hidden p-8 space-y-8 relative animate-in fade-in duration-500">
            {isSharingLocation && (
                <div className="absolute top-6 right-8 flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                    <Radio size={12} className="animate-pulse" />
                    <span className="text-[8px] font-black uppercase tracking-widest">GPS ACTIVO</span>
                </div>
            )}

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-slate-900 p-2.5 rounded-2xl shadow-lg"><Settings2 className="text-primary h-5 w-5" /></div>
                    <h3 className="font-black text-xl text-slate-900 tracking-tighter italic uppercase">Gestión de Ruta</h3>
                </div>
                <div className={cn("px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border", isRideStarted ? "bg-emerald-50 text-emerald-600 border-emerald-100" : isRideCompleted ? "bg-slate-50 text-slate-400 border-slate-100" : "bg-indigo-50 text-indigo-600 border-indigo-100")}>
                    {isRideStarted ? 'EN MARCHA' : isRideCompleted ? 'VIAJE CERRADO' : 'ESPERANDO'}
                </div>
            </div>

            <div className="space-y-4">
                {ride.passengers && ride.passengers.length > 0 ? (
                    ride.passengers.filter(p => p.status !== 'cancelled' && p.status !== 'rejected').map(pax => (
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
                    <div className="p-8 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                        <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest italic">Sin pasajeros aún</p>
                    </div>
                )}
            </div>

            <div className="pt-4">
                {isRideScheduled && (
                    <Button
                        onClick={handleStartRide}
                        disabled={isLoading}
                        className="w-full h-20 rounded-[2rem] bg-slate-900 text-white font-black text-lg shadow-2xl active:scale-95 transition-all border-none italic uppercase"
                    >
                        {isLoading ? <Loader2 className="animate-spin" /> : "INICIAR TRAYECTO"}
                    </Button>
                )}

                {isRideStarted && (
                    <Button 
                        onClick={handleCompleteRide} 
                        disabled={isLoading} 
                        className="w-full h-20 rounded-[2rem] bg-emerald-600 hover:bg-emerald-700 text-white font-black text-lg shadow-2xl active:scale-95 transition-all border-none italic uppercase"
                    >
                        {isLoading ? <Loader2 className="animate-spin" /> : "FINALIZAR VIAJE"}
                    </Button>
                )}
            </div>

            <PinVerificationDialog
                open={isPinDialogOpen}
                onOpenChange={setIsPinDialogOpen}
                onConfirm={handleConfirmPin}
                isLoading={isLoading}
                title={`Verificar a ${selectedPassenger?.displayName || 'Pasajero'}`}
            />
        </Card>
    );
};

export default RideManagement;
