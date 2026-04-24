
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Card } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { 
    ShieldAlert, MessageCircle, Navigation, Loader2, PlayCircle, 
    BadgeCheck, Radio, Users, Clock, MapPinned, Lock, 
    Phone, Share2, MoreVertical, ChevronRight, Zap,
    UserPlus, UserCheck, UserMinus, MessageSquare
} from 'lucide-react';
import PinVerificationDialog from './PinVerificationDialog';
import { startRide, completeRide, verifyPassenger, markNoShow, acceptPassenger, rejectPassenger } from '@/services/rideService';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';

const PassengerItem = ({ passenger, onVerify, onAccept, onReject, rideId }) => {
    const navigate = useNavigate();
    const isVerified = ['verified', 'on_board', 'completed'].includes(passenger.status);
    const isPending = passenger.status === 'pending';
    const isConfirmed = passenger.status === 'confirmed';
    const photoURL = passenger.photoURL || passenger.photo_url;
    
    return (
        <div className={cn(
            "flex flex-col p-4 rounded-3xl border mb-3 transition-all",
            isPending ? "bg-indigo-50/30 border-indigo-100 ring-1 ring-indigo-50" : "bg-white border-slate-100 shadow-sm"
        )}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Avatar className="h-12 w-12 border-2 border-white shadow-md">
                        <AvatarImage src={photoURL} />
                        <AvatarFallback className="font-black bg-slate-100 text-slate-400">{passenger.displayName?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="text-left flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <p className="font-black text-sm uppercase italic tracking-tighter text-slate-900 truncate">{passenger.displayName}</p>
                            {isVerified && <BadgeCheck size={14} className="text-emerald-500" />}
                        </div>
                        <p className={cn("text-[9px] font-black uppercase tracking-widest", 
                            isVerified ? "text-emerald-600" : isPending ? "text-indigo-600 animate-pulse" : "text-amber-600")}>
                            {isVerified ? 'En el vehículo' : isPending ? 'Solicitud Pendiente' : 'Reserva Confirmada'}
                        </p>
                    </div>
                </div>

                <div className="flex gap-2">
                    {/* Botón de Chat Individual */}
                    <Button 
                        size="icon" 
                        variant="ghost" 
                        className="size-10 rounded-xl bg-slate-50 text-slate-400 hover:text-primary hover:bg-primary/5"
                        onClick={() => navigate(`/ride-chat/${rideId}/${passenger.id}`)}
                    >
                        <MessageSquare size={18} />
                    </Button>

                    {isPending && (
                        <div className="flex gap-1.5">
                            <Button size="icon" onClick={() => onAccept(passenger)} className="size-10 rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-200 active:scale-90">
                                <UserCheck size={18} />
                            </Button>
                            <Button size="icon" onClick={() => onReject(passenger)} className="size-10 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 active:scale-90">
                                <UserMinus size={18} />
                            </Button>
                        </div>
                    )}

                    {isConfirmed && !isVerified && (
                        <Button onClick={() => onVerify(passenger)} className="h-10 px-4 rounded-xl bg-slate-900 text-white font-black text-[10px] uppercase shadow-lg active:scale-95">
                            VALIDAR PIN
                        </Button>
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
    const [currentCoords, setCurrentCoords] = useState(null);
    const [distMeters, setDistMeters] = useState(null);

    const isRideStarted = ride.status === 'active' || ride.status === 'in_progress';
    const isRideScheduled = ride.status === 'scheduled';

    const passengers = useMemo(() => ride.passengers || [], [ride.passengers]);
    const pendingRequests = useMemo(() => passengers.filter(p => p.status === 'pending'), [passengers]);
    const onboardPassengers = useMemo(() => passengers.filter(p => !['pending', 'cancelled', 'rejected'].includes(p.status)), [passengers]);

    // Lógica GPS para finalización
    useEffect(() => {
        if (!currentCoords || !ride.destination?.coordinates) return;
        const dest = ride.destination.coordinates;
        const R = 6371e3;
        const φ1 = currentCoords.lat * Math.PI/180;
        const φ2 = dest.lat * Math.PI/180;
        const Δφ = (dest.lat - currentCoords.lat) * Math.PI/180;
        const Δλ = (dest.lng - currentCoords.lng) * Math.PI/180;
        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
        setDistMeters(Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))));
    }, [currentCoords, ride.destination]);

    const canCompleteRide = useMemo(() => {
        const verifiedCount = onboardPassengers.filter(p => ['verified', 'on_board', 'completed'].includes(p.status)).length;
        return (distMeters !== null && distMeters <= 500) || (onboardPassengers.length > 0 && verifiedCount === onboardPassengers.length);
    }, [distMeters, onboardPassengers]);

    const handleAccept = async (p) => {
        setIsLoading(true);
        try {
            await acceptPassenger(ride.id, p.id);
            toast.success(`${p.displayName} aceptado`);
            onRefresh();
        } catch (e) { toast.error(e.message); }
        finally { setIsLoading(false); }
    };

    const handleReject = async (p) => {
        if (!window.confirm("¿Rechazar esta solicitud?")) return;
        setIsLoading(true);
        try {
            await rejectPassenger(ride.id, p.id);
            onRefresh();
        } catch (e) { toast.error(e.message); }
        finally { setIsLoading(false); }
    };

    return (
        <Card className="rounded-[3rem] border-none shadow-diamond bg-white p-8 space-y-8 relative overflow-hidden">
            <div className="flex items-center justify-between">
                <div className="text-left">
                    <h3 className="font-black text-2xl text-slate-900 uppercase italic tracking-tighter leading-none">Gestión Élite</h3>
                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">Control del Conductor</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={() => navigate(`/ride-chat/${ride.id}`)} variant="outline" className="h-12 w-12 rounded-2xl border-2 border-orange-50 bg-orange-50/50 text-orange-600 shadow-sm">
                        <MessageCircle size={20} />
                    </Button>
                    {isRideStarted && (
                        <div className="flex items-center gap-2 px-4 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100 animate-pulse">
                            <Radio size={12} /> <span className="text-[10px] font-black uppercase">En Vivo</span>
                        </div>
                    )}
                </div>
            </div>

            {/* SECCIÓN: SOLICITUDES PENDIENTES */}
            {pendingRequests.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 px-2">
                        <UserPlus size={14} className="text-indigo-500" />
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Solicitudes por Aprobar ({pendingRequests.length})</h4>
                    </div>
                    {pendingRequests.map(p => (
                        <PassengerItem key={p.id} passenger={p} rideId={ride.id} onAccept={handleAccept} onReject={handleReject} />
                    ))}
                </div>
            )}

            {/* SECCIÓN: PASAJEROS CONFIRMADOS */}
            <div className="space-y-4">
                <div className="flex items-center gap-2 px-2">
                    <Users size={14} className="text-slate-400" />
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pasajeros del Viaje ({onboardPassengers.length})</h4>
                </div>
                {onboardPassengers.length > 0 ? (
                    onboardPassengers.map(p => (
                        <PassengerItem key={p.id} passenger={p} rideId={ride.id} onVerify={(pax) => { setSelectedPassenger(pax); setIsPinDialogOpen(true); }} />
                    ))
                ) : (
                    <div className="p-8 text-center bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-100">
                        <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest leading-relaxed">No hay pasajeros confirmados<br/>todavía.</p>
                    </div>
                )}
            </div>

            {/* BOTONES DE ACCIÓN MAESTROS */}
            <div className="pt-4 space-y-4">
                {isRideScheduled && (
                    <Button 
                        onClick={async () => {
                            try {
                                setIsLoading(true);
                                await startRide(ride.id);
                                onRefresh();
                            } catch(e) {
                                toast.error(e.message || 'No se pudo iniciar el viaje');
                            } finally {
                                setIsLoading(false);
                            }
                        }}
                        disabled={onboardPassengers.length === 0 || isLoading}
                        className="w-full h-20 rounded-[2rem] bg-slate-900 text-white font-black text-xl uppercase italic shadow-2xl active:scale-95 transition-all border-none"
                    >
                        INICIAR VIAJE <PlayCircle className="ml-3 text-primary h-6 w-6" />
                    </Button>
                )}

                {isRideStarted && (
                    <div className="space-y-4">
                        {distMeters !== null && (
                            <div className={cn("p-6 rounded-[2rem] border-2 flex items-center justify-between", distMeters <= 500 ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-100")}>
                                <div className="text-left">
                                    <p className="text-[9px] font-black uppercase text-slate-400">Distancia al destino</p>
                                    <p className="font-black text-2xl italic text-slate-900">{distMeters > 1000 ? `${(distMeters/1000).toFixed(1)} km` : `${distMeters} m`}</p>
                                </div>
                                <Navigation size={24} className={distMeters <= 500 ? "text-emerald-500 animate-bounce" : "text-slate-300"} />
                            </div>
                        )}
                        <Button
                            onClick={async () => {
                                try {
                                    setIsLoading(true);
                                    await completeRide(ride.id); // Bug Fix #9: solo acepta rideId
                                    navigate('/my-rides');
                                } catch(e) {
                                    toast.error(e.message || 'No se pudo finalizar el viaje');
                                } finally {
                                    setIsLoading(false);
                                }
                            }}
                            disabled={!canCompleteRide || isLoading}
                            className={cn("w-full h-20 rounded-[2rem] font-black text-xl uppercase italic shadow-2xl transition-all border-none", 
                                !canCompleteRide ? "bg-slate-100 text-slate-300" : "bg-emerald-600 text-white")}
                        >
                            {canCompleteRide ? "FINALIZAR Y COBRAR" : "BLOQUEADO HASTA DESTINO"}
                        </Button>
                    </div>
                )}
            </div>

            <PinVerificationDialog
                open={isPinDialogOpen}
                onOpenChange={setIsPinDialogOpen}
                onConfirm={async (pin) => {
                    // Bug Fix #10: null guard + manejo de error + parámetros correctos
                    if (!selectedPassenger?.id) return;
                    try {
                        await verifyPassenger(ride.id, selectedPassenger.id, pin);
                        setIsPinDialogOpen(false);
                        onRefresh();
                    } catch(e) {
                        const msg = e.message?.includes('PIN_INCORRECTO')
                            ? 'PIN incorrecto. Solicítalo de nuevo al pasajero.'
                            : (e.message || 'Error al verificar PIN');
                        toast.error(msg);
                    }
                }}
            />
        </Card>
    );
};

export default RideManagement;
