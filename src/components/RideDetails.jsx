
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useOutletContext, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { format, differenceInMinutes, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';

import SubPageHeader from './SubPageHeader';
import MapComponent from './MapComponent';
import BookingPaymentModal from './BookingPaymentModal'; 
import PinVerificationDialog from './PinVerificationDialog.jsx';
import { Button } from './ui/button.jsx';
import { Card } from './ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar.jsx';
import { 
    Loader2, Users, Calendar, Clock, MapPin, 
    ShieldCheck, Star, Car, Heart, Music, 
    ChevronRight, BadgeCheck, MessageCircle, Phone, Lock,
    Share2, Zap, Play, CheckCircle2, AlertCircle, XCircle, Navigation, Fingerprint
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { getRideDetailsSecure, startRide, verifyPassenger } from '../lib/supabaseRPC.js';
import { cancelRide, cancelBooking } from '../services/rideService.js';

const RideDetails = () => {
    const { id: rideId } = useParams();
    const navigate = useNavigate();
    const { user } = useOutletContext();
    const [ride, setRide] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());

    // Estados para la verificación de PIN
    const [isPinDialogOpen, setIsPinDialogOpen] = useState(false);
    const [selectedPassenger, setSelectedPassenger] = useState(null);
    const [isVerifying, setIsVerifying] = useState(false);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    const fetchRide = useCallback(async () => {
        setLoading(true);
        try {
            const response = await getRideDetailsSecure(rideId);
            if (!response?.success) {
                setRide(null);
                toast.error(response?.error || 'No se pudo cargar la información del viaje');
                return;
            }
            setRide(response.data ?? null);
        } catch (error) {
            console.error("Error loading ride:", error);
            toast.error("No se pudo cargar la información del viaje");
        } finally {
            setLoading(false);
        }
    }, [rideId]);

    useEffect(() => {
        if (rideId) fetchRide();
    }, [rideId, fetchRide]);

    const handleStartRide = async () => {
        setIsStarting(true);
        try {
            const { success, error } = await startRide(rideId);
            if (!success) throw new Error(error);
            toast.success("¡Viaje iniciado! Buen camino.");
            fetchRide();
        } catch (error) {
            toast.error(error.message || "No se pudo iniciar el viaje");
        } finally {
            setIsStarting(false);
        }
    };

    const handleVerifyPin = async (pin) => {
        setIsVerifying(true);
        try {
            // USANDO RPC DE VERIFICACIÓN CIEGA
            const { data, success, error } = await verifyPassenger(rideId, pin, selectedPassenger?.id ?? null);
            
            if (!success) {
                if (error?.includes('PIN_INCORRECTO')) {
                    throw new Error("El PIN introducido no coincide. Solicítalo de nuevo al pasajero.");
                }
                throw new Error(error || "Error al verificar");
            }

            toast.success(`¡${selectedPassenger.displayName || 'Pasajero'} verificado!`);
            setIsPinDialogOpen(false);
            await fetchRide(); // Refrescar datos del viaje
        } catch (error) {
            toast.error(error.message);
        } finally {
            setIsVerifying(false);
        }
    };

    if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-primary" /></div>;
    if (!ride) return <SubPageHeader title="No encontrado" backPath="/dashboard" />;

    const isDriver = user?.id && ride?.driver_id && String(user.id) === String(ride.driver_id);
    const passengers = Array.isArray(ride.passengers) ? ride.passengers.filter(p => p.status !== 'cancelled') : [];
    const isPassenger = passengers.some(p => String(p.id) === String(user?.id));
    const confirmedPassengers = passengers.filter(p => p.status === 'confirmed' || p.status === 'verified');
    const isRideCancelled = ride.status === 'cancelled';
    const isRideActive = ride.status === 'active' || ride.status === 'in_progress';

    const departureDate = new Date(ride.departure_time);
    const minutesToDeparture = differenceInMinutes(departureDate, currentTime);
    const canStartRide = (minutesToDeparture <= 15 || isBefore(departureDate, currentTime)) && !isRideActive && !isRideCancelled;

    return (
        <div className="bg-[#F8FAFC] min-h-screen pb-32">
            <SubPageHeader title="Detalles del Viaje" />

            <main className="max-w-xl mx-auto px-4 mt-6 space-y-6 animate-in fade-in duration-500">
                {isRideCancelled && (
                    <div className="bg-red-50 border-2 border-red-100 rounded-[2.5rem] p-6 flex items-center gap-4 text-red-600">
                        <XCircle size={32} className="shrink-0" />
                        <div>
                            <p className="font-black uppercase italic leading-none">Viaje Cancelado</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest mt-1 opacity-70">Este viaje ya no está disponible</p>
                        </div>
                    </div>
                )}

                <div className="h-56 w-full rounded-[2.5rem] overflow-hidden shadow-xl border-4 border-white relative group">
                    <MapComponent center={ride.origin} itemsToDisplay={[ride]} zoom={12} interactive={false} />
                </div>

                {/* INFO TIEMPO Y PRECIO */}
                <Card className="rounded-[2.5rem] border-none shadow-2xl bg-white p-8 space-y-6">
                    <div className="flex justify-between items-start">
                        <div className="text-left space-y-1">
                            <div className="flex items-center gap-2 text-primary font-black uppercase tracking-widest text-[10px]">
                                <Calendar size={12} /> {ride.departure_time ? format(new Date(ride.departure_time), "EEEE d 'de' MMMM", { locale: es }) : 'Fecha pendiente'}
                            </div>
                            <h2 className="text-4xl font-black text-slate-900 tracking-tighter italic leading-none">
                                {ride.departure_time ? format(new Date(ride.departure_time), "HH:mm") : '--:--'}
                            </h2>
                        </div>
                        <div className="text-right">
                            <p className="text-4xl font-black text-primary italic tracking-tighter leading-none">{ride.price}€</p>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1 text-right">Por Plaza</p>
                        </div>
                    </div>
                </Card>

                {/* PERFIL DEL CONDUCTOR (Novedad) */}
                {!isDriver && (
                    <Card className="rounded-[2.5rem] border-none shadow-xl bg-white p-6 overflow-hidden relative group">
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <Avatar className="h-16 w-16 border-4 border-slate-50 shadow-lg transition-transform group-hover:scale-105">
                                    <AvatarImage src={ride.driver_photo} />
                                    <AvatarFallback className="bg-primary/10 text-primary font-black text-xl">
                                        {ride.driver_name?.[0]}
                                    </AvatarFallback>
                                </Avatar>
                                {ride.driver_verified && (
                                    <div className="absolute -bottom-1 -right-1 bg-blue-500 text-white p-1 rounded-full border-2 border-white shadow-sm">
                                        <BadgeCheck size={12} />
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 text-left">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-xl font-black text-slate-900 italic uppercase leading-none">
                                        {ride.driver_name || 'Conductor'}
                                    </h3>
                                </div>
                                <div className="flex items-center gap-3 mt-2">
                                    <div className="flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-100">
                                        <Star size={10} className="text-amber-500 fill-amber-500" />
                                        <span className="text-[10px] font-black text-amber-700">4.8</span>
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                        124 Viajes
                                    </span>
                                </div>
                            </div>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-12 w-12 rounded-2xl bg-slate-50 text-slate-400 hover:text-primary hover:bg-primary/5 border border-slate-100"
                                onClick={() => navigate(`/chat/${ride.id}`)}
                            >
                                <MessageCircle size={20} />
                            </Button>
                        </div>

                        {/* Info de Vehículo (Muestra si existe) */}
                        <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-slate-500">
                                <Car size={14} />
                                <span className="text-[10px] font-black uppercase tracking-widest italic">
                                    {typeof ride.driver_vehicle === 'object' && ride.driver_vehicle !== null
                                        ? `${ride.driver_vehicle.brand} ${ride.driver_vehicle.model} • ${ride.driver_vehicle.plate}`
                                        : (ride.driver_vehicle || 'Vehículo verificado')}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <Music size={14} className="text-slate-200" />
                                <Zap size={14} className="text-slate-200" />
                            </div>
                        </div>
                    </Card>
                )}

                {isDriver ? (
                    !isRideCancelled && (
                        <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
                            <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-xl relative overflow-hidden">
                                <div className="relative z-10">
                                    <div className="flex items-center justify-between mb-8">
                                        <div className="text-left">
                                            <h4 className="text-xl font-black text-slate-900 uppercase italic">Control del Conductor</h4>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{confirmedPassengers.length} pasajeros confirmados</p>
                                        </div>
                                        <div className="bg-indigo-50 px-4 py-2 rounded-2xl flex items-center gap-2 border border-indigo-100">
                                            <Users size={16} className="text-indigo-600" />
                                            <span className="font-black text-indigo-600 text-sm">{ride.seats_available} LIBRES</span>
                                        </div>
                                    </div>

                                    {/* LISTA DE PASAJEROS PARA EL CONDUCTOR */}
                                    <div className="space-y-3 mb-8">
                                        {confirmedPassengers.length > 0 ? (
                                            confirmedPassengers.map((p, idx) => (
                                                <div key={idx} className="flex flex-col gap-2 p-4 bg-slate-50 rounded-3xl border border-slate-100 group hover:bg-slate-100 transition-colors">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <Avatar className="h-10 w-10 border-2 border-white shadow-sm">
                                                                <AvatarImage src={p.photoURL || p.photo_url} />
                                                                <AvatarFallback className="bg-indigo-100 text-indigo-600 font-black text-xs">{p.displayName?.[0]}</AvatarFallback>
                                                            </Avatar>
                                                            <div className="text-left">
                                                                <p className="text-sm font-black text-slate-900 uppercase italic leading-none">{p.displayName || 'Pasajero'}</p>
                                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1 truncate max-w-[150px]">{p.pickup_address || 'Recogida pendiente'}</p>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            {/* SOLO EL CONDUCTOR PUEDE VALIDAR - Soporta 'verified' o 'on_board' */}
                                                            {p.status !== 'verified' && p.status !== 'on_board' ? (
                                                                <Button 
                                                                    onClick={() => { setSelectedPassenger(p); setIsPinDialogOpen(true); }}
                                                                    className="h-10 px-4 rounded-2xl bg-indigo-600 text-white font-black text-[9px] uppercase tracking-widest shadow-md hover:bg-indigo-700"
                                                                >
                                                                    <Fingerprint size={14} className="mr-1.5" /> Validar PIN
                                                                </Button>
                                                            ) : (
                                                                <div className="h-10 px-4 rounded-2xl bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-2 animate-in zoom-in-95 duration-300">
                                                                    <CheckCircle2 size={14} className="fill-emerald-700 text-white" />
                                                                    <span className="text-[9px] font-black uppercase tracking-widest">A bordo</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="py-6 text-center border-2 border-dashed border-slate-100 rounded-3xl">
                                                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Esperando pasajeros...</p>
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className="space-y-4">
                                        <Button 
                                            onClick={handleStartRide}
                                            disabled={!canStartRide || isStarting}
                                            className={cn(
                                                "w-full h-20 rounded-[2.2rem] text-white font-black uppercase italic text-xl tracking-tighter shadow-2xl gap-3 transition-all",
                                                canStartRide ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                                            )}
                                        >
                                            {isStarting ? <Loader2 className="animate-spin" /> : <><Play size={20} className="fill-white" /> Iniciar Viaje</>}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                ) : (
                    /* PANEL DEL PASAJERO */
                    !isRideCancelled && (
                        <div className="space-y-4">
                            {isPassenger && ride.user_pin && (
                                <div className="bg-emerald-50 border-2 border-dashed border-emerald-500 rounded-[2.5rem] p-8 text-center space-y-4 animate-in slide-in-from-bottom-4 duration-700 shadow-inner">
                                    <div className="flex items-center justify-center gap-2 text-emerald-600">
                                        <Lock size={16} className="animate-pulse" />
                                        <p className="text-[11px] font-black uppercase tracking-[0.2em]">Código de Abordaje</p>
                                    </div>
                                    <p className="text-6xl font-black text-emerald-700 tracking-[0.3em] italic drop-shadow-md">
                                        {ride.user_pin}
                                    </p>
                                    <div className="bg-white/50 py-2 px-4 rounded-2xl inline-block border border-emerald-100">
                                        <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest">Muestra este código al conductor para validar tu plaza</p>
                                    </div>
                                </div>
                            )}

                            <Button 
                                onClick={() => !isPassenger && setIsBookingModalOpen(true)}
                                disabled={ride.seats_available <= 0 && !isPassenger}
                                className={cn(
                                    "w-full h-20 rounded-[2.2rem] font-black text-xl italic uppercase shadow-2xl transition-all active:scale-95",
                                    isPassenger 
                                        ? "bg-emerald-500 text-white cursor-default hover:bg-emerald-500" 
                                        : ride.seats_available <= 0 
                                            ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                                            : "bg-slate-900 text-white hover:bg-slate-800"
                                )}
                            >
                                {isPassenger ? (
                                    <div className="flex items-center gap-3">
                                        <CheckCircle2 size={24} />
                                        <span>Plaza Reservada</span>
                                    </div>
                                ) : "Reservar Plaza"}
                            </Button>
                        </div>
                    )
                )}

                {/* MODAL DE VERIFICACIÓN CIEGA */}
                <PinVerificationDialog 
                    open={isPinDialogOpen}
                    onOpenChange={setIsPinDialogOpen}
                    onConfirm={handleVerifyPin}
                    isLoading={isVerifying}
                    title={`Verificar a ${selectedPassenger?.displayName}`}
                />

                <BookingPaymentModal 
                    isOpen={isBookingModalOpen}
                    onClose={() => setIsBookingModalOpen(false)}
                    rideId={ride.id}
                    amount={Number(ride.price)}
                    onSuccess={() => fetchRide()}
                />
            </main>
        </div>
    );
};

export default RideDetails;
