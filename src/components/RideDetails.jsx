
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useOutletContext, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { format, differenceInMinutes, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';

import SubPageHeader from './SubPageHeader';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import MapComponent from './MapComponent';
import BookingPaymentModal from './BookingPaymentModal'; 
import PinVerificationDialog from './PinVerificationDialog.jsx';
import RideRatingModal from './RideRatingModal.jsx';
import { Button } from './ui/button.jsx';
import { Card } from './ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar.jsx';
import { 
    Loader2, Users, Calendar, Clock, MapPin, 
    ShieldCheck, Star, Car, Heart, Music, 
    ChevronRight, BadgeCheck, MessageCircle, Phone, Lock,
    Share2, Zap, Play, CheckCircle2, AlertCircle, XCircle, Navigation, Fingerprint,
    ShieldAlert, UserX
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { supabase } from '../lib/supabase.js';
import { getRideDetailsSecure, startRide, verifyPassenger, handlePassengerNoShow, getOrCreateChat } from '../lib/supabaseRPC.js';
import { cancelRide, cancelBooking } from '../services/rideService.js';

import { triggerSOS } from '../services/safetyService.js';

const RideDetails = () => {
    const { id: rideId } = useParams();
    const navigate = useNavigate();
    const { user } = useOutletContext();
    const [ride, setRide] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [isCompleting, setIsCompleting] = useState(false);
    const [isDroppingOff, setIsDroppingOff] = useState(false);
    const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [hasAutoOpenedRating, setHasAutoOpenedRating] = useState(false);

    // Estados para la verificación de PIN
    const [isPinDialogOpen, setIsPinDialogOpen] = useState(false);
    const [selectedPassenger, setSelectedPassenger] = useState(null);
    const [showRatingModal, setShowRatingModal] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
    // Nuevo estado para la ubicación de recogida seleccionada en el mapa
    const [selectedPickupLocation, setSelectedPickupLocation] = useState(null);
    const [isSOSLoading, setIsSOSLoading] = useState(false);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    const fetchRide = useCallback(async () => {
        if (!rideId || rideId === 'undefined') return;

        setLoading(true);
        try {
            const response = await getRideDetailsSecure(rideId);
            const rpcPayload = response.data;
            if (rpcPayload?.success) {
                const rideData = rpcPayload.data;
                setRide(rideData);

                // AUTO-OPEN RATING: Si el viaje terminó y soy pasajero verificado, abrir rating (solo una vez)
                const myEntry = rideData.passengers?.find(
                    p => p.id?.toString().toLowerCase() === user?.id?.toString().toLowerCase()
                );

                if (rideData.status === 'completed' &&
                    myEntry?.status === 'verified' &&
                    !myEntry?.rated &&
                    !hasAutoOpenedRating) {
                    setIsRatingModalOpen(true);
                    setHasAutoOpenedRating(true);
                }
            }
        } catch (err) {
            console.error("Error fetching ride:", err);
        } finally {
            setLoading(false);
        }
    }, [rideId, user?.id, hasAutoOpenedRating]);

    useEffect(() => {
        if (!rideId) return;

        fetchRide();

        // SUSCRIPCIÓN EN TIEMPO REAL: Actualizar si el viaje cambia (status, plazas, pasajeros)
        const channel = supabase
            .channel(`ride_updates_${rideId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'rides',
                filter: `id=eq.${rideId}`
            }, (payload) => {
                console.log("🛡️ [RideDetails] Real-time update received:", payload.new.status);
                // Si el cambio es crítico (status), refrescamos todo
                fetchRide();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [rideId, fetchRide]);

    const handleStartRide = async () => {
        setIsStarting(true);
        try {
            const { success, error } = await startRide(rideId);
            if (!success) throw new Error(error);
            toast.success("¡Viaje iniciado! Buen camino.");
            fetchRide();
        } catch (error) {
            toast.error(error.message || "No se pudo iniciar");
        } finally {
            setIsStarting(false);
        }
    };

    const handleCompleteRide = async () => {
        setIsCompleting(true);
        try {
            // Se han eliminado las versiones duplicadas de complete_ride en la DB.
            // Invocamos solo con el ID del viaje.
            const { data: response, error: rpcError } = await supabase.rpc('complete_ride', {
                p_ride_id: rideId
            });

            if (rpcError) throw rpcError;

            // Normalizar respuesta (Supabase puede devolver objeto directo o array)
            const result = response?.success !== undefined ? response : response?.[0];

            if (!result?.success) {
                throw new Error(result?.error || "Error inesperado al finalizar");
            }

            const payoutNeto = result.payout || 0;
            const platformFee = payoutNeto / 0.9 * 0.1;
            const totalGross = payoutNeto + platformFee;

            toast.success("¡Viaje finalizado con éxito!", {
                description: (
                    <div className="mt-2 space-y-1 border-t border-emerald-100 pt-2">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            <span>Total Bruto:</span>
                            <span>{totalGross.toFixed(2)}€</span>
                        </div>
                        <div className="flex justify-between text-xs font-black uppercase italic text-emerald-600 pt-1 border-t border-dashed border-emerald-100">
                            <span>Tu Ganancia Neta:</span>
                            <span>{payoutNeto.toFixed(2)}€</span>
                        </div>
                    </div>
                ),
                duration: 6000,
            });

            // DISPARAR RATING AUTOMÁTICAMENTE
            setTimeout(() => {
                setShowRatingModal(true);
            }, 1000);

            fetchRide();
        } catch (error) {
            console.error("🔴 Error en handleCompleteRide:", error);
            toast.error("No se pudo finalizar el viaje", {
                description: error.message || "Error de conexión con el servidor"
            });
        } finally {
            setIsCompleting(false);
        }
    };

    const handleVerifyPin = async (pin) => {
        setIsVerifying(true);
        try {
            const res = await verifyPassenger(rideId, pin, selectedPassenger?.id ?? null);
            
            if (!res.success) {
                // Manejo de errores específicos para una mejor UX
                if (res.error === 'DEMASIADO_PRONTO' || res.message?.includes('antes de la salida')) {
                    toast.error("¡Es demasiado pronto!", {
                        description: "Solo puedes verificar el PIN del pasajero 15 minutos antes de la hora de salida programada.",
                        duration: 5000
                    });
                    setIsPinDialogOpen(false);
                    return;
                }

                if (res.error?.includes('PIN_INCORRECTO') || res.message?.includes('incorrecto')) {
                    throw new Error("El PIN introducido no coincide. Solicítalo de nuevo al pasajero.");
                }
                throw new Error(res.error || res.message || "Error al verificar");
            }

            toast.success(`¡${selectedPassenger?.displayName || 'Pasajero'} verificado!`, {
                description: "Ya puede subir al vehículo.",
                icon: <BadgeCheck className="text-emerald-500" />
            });
            setIsPinDialogOpen(false);
            await fetchRide();
        } catch (error) {
            toast.error("Error de verificación", { description: error.message });
        } finally {
            setIsVerifying(false);
        }
    };

    const handleCancelRide = async () => {
        // Bug Fix #11: usamos estado en lugar de window.confirm (no funciona en Capacitor iOS/Android)
        setIsCancelConfirmOpen(false);
        setIsCancelling(true);
        try {
            const result = await cancelRide(rideId);
            if (result.success) {
                toast.success("Viaje cancelado correctamente");
                fetchRide();
            } else {
                throw new Error(result.message || "Error al cancelar");
            }
        } catch (error) {
            toast.error(error.message || "No se pudo cancelar el viaje");
        } finally {
            setIsCancelling(false);
        }
    };

    const handleTriggerSOS = async () => {
        if (!window.confirm("¿ESTÁS EN PELIGRO? Se notificará a las autoridades y contactos de emergencia.")) return;

        setIsSOSLoading(true);
        try {
            const result = await triggerSOS(rideId);
            if (result.success) {
                navigate(`/emergency/${rideId}`);
            }
        } catch (error) {
            // Error ya manejado en el servicio
        } finally {
            setIsSOSLoading(false);
        }
    };

    const handleOpenPrivateChat = async (otherUserId) => {
        try {
            const { data, success, error } = await getOrCreateChat(otherUserId, rideId);
            if (!success) throw new Error(error);
            if (data?.chatId) {
                navigate(`/rides/${rideId}/chat/${data.chatId}`);
            } else {
                throw new Error("No se pudo obtener el ID del chat");
            }
        } catch (error) {
            toast.error("No se pudo abrir la conversación");
            console.error("Chat error:", error);
        }
    };

    const onPassengerNoShow = async (passenger) => {

        if (!window.confirm(`¿Confirmas que ${passenger.displayName} no se ha presentado? Esta acción es irreversible y le aplicará una penalización económica.`)) {
            return;
        }

        try {
            const res = await handlePassengerNoShow(rideId, passenger.id);
            if (res.success) {
                toast.success("No-Show registrado", {
                    description: `Se ha procesado tu compensación de ${res.data.payout.toFixed(2)}€`
                });
                fetchRide();
            } else {
                throw new Error(res.error || "No se pudo procesar el no-show");
            }
        } catch (error) {
            toast.error(error.message);
        }
    };

    const handlePassengerDropoff = async (passenger) => {
        if (!window.confirm(`¿Confirmas que has dejado a ${passenger.displayName} en su destino? Se liberará su pago inmediatamente.`)) {
            return;
        }

        setIsDroppingOff(true);
        try {
            const { data, error } = await supabase.rpc('complete_passenger_dropoff', {
                p_ride_id: rideId,
                p_passenger_id: passenger.id
            });

            if (error) throw error;

            if (data?.success) {
                toast.success(`¡Pago de ${passenger.displayName} liberado!`, {
                    icon: <CheckCircle2 className="text-emerald-500" />
                });
                fetchRide();
            } else {
                throw new Error(data?.error || "Error al procesar la entrega");
            }
        } catch (error) {
            console.error("Error en dropoff:", error);
            toast.error(error.message || "No se pudo procesar la entrega");
        } finally {
            setIsDroppingOff(false);
        }
    };

    if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-primary" /></div>;
    if (!ride) return <SubPageHeader title="No encontrado" backPath="/dashboard" />;

    // NORMALIZACIÓN DE COMPARACIÓN DE IDS (Más robusta)
    const currentUserId = user?.id?.toString()?.toLowerCase();
    const driverId = ride?.driver_id?.toString()?.toLowerCase();

    const isDriver = currentUserId && driverId && currentUserId === driverId;

    const passengers = Array.isArray(ride.passengers) ? ride.passengers.filter(p => p.status !== 'cancelled') : [];
    const isPassenger = passengers.some(p => p.id?.toString()?.toLowerCase() === currentUserId);
    const confirmedPassengers = passengers.filter(p => ['confirmed', 'verified', 'completed'].includes(p.status));
    const isRideCancelled = ride.status === 'cancelled';
    const isRideExpired = ride.status === 'expired';
    const isRideActive = ride.status === 'active' || ride.status === 'in_progress';
    const isRideClosed = ride.status === 'completed' || ride.status === 'cancelled' || ride.status === 'expired';

    // LÓGICA DE TIEMPO
    const departureDate = new Date(ride.departure_time);
    const minutesToDeparture = differenceInMinutes(departureDate, currentTime);

    // Un viaje puede iniciarse desde 15 min antes hasta 2 horas después de la hora programada
    const isTooLate = differenceInMinutes(currentTime, departureDate) > 120;
    const isDelayed = isBefore(departureDate, currentTime) && !isRideActive && !isRideCancelled;

    // canStartRide: Para el botón grande de abajo (solo si el viaje aún no es activo)
    const canStartRide = (minutesToDeparture <= 15 || isBefore(departureDate, currentTime)) && !isRideActive && !isRideCancelled && !isTooLate;

    // canVerifyPassenger: Para el botón de cada pasajero.
    // Se habilita si el viaje ya está activo O si falta poco para salir.
    const canVerifyPassenger = isRideActive || canStartRide;

    // 🛡️ REPARACIÓN DE VARIABLES FALTANTES
    const myPassengerEntry = passengers.find(p => p.id?.toString().toLowerCase() === currentUserId);
    const isRated = myPassengerEntry?.rated === true || myPassengerEntry?.rated === 'true';
    const myPin = myPassengerEntry?.pin;

    return (
        <div className="bg-[#F8FAFC] min-h-screen pb-96">
            <SubPageHeader
                title="Detalles del Viaje"
                actions={(isDriver || isPassenger) && (
                    <button
                        onClick={() => navigate(`/rides/${rideId}/chats`)}
                        className="h-11 w-11 rounded-2xl bg-slate-900 shadow-lg flex items-center justify-center text-white active:scale-95 transition-all"
                        title="Conversaciones"
                    >
                        <MessageCircle size={20} />
                    </button>
                )}
            />


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

                {isRideExpired && (
                    <div className="bg-amber-50 border-2 border-amber-100 rounded-[2.5rem] p-6 flex items-center gap-4 text-amber-600">
                        <Clock size={32} className="shrink-0" />
                        <div>
                            <p className="font-black uppercase italic leading-none">Viaje Expirado</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest mt-1 opacity-70">La hora de salida ha pasado sin iniciarse</p>
                        </div>
                    </div>
                )}

                <div className="h-56 w-full rounded-[2.5rem] overflow-hidden shadow-xl border-4 border-white relative group">
                    <MapComponent
                        center={selectedPickupLocation || ride.origin}
                        itemsToDisplay={[ride]}
                        zoom={12}
                        interactive={true}
                        pickupLocation={selectedPickupLocation}
                        onLocationSelect={(loc) => {
                            if (!isPassenger && ride.status === 'scheduled') {
                                setSelectedPickupLocation(loc);
                                toast.info("Punto de recogida seleccionado", {
                                    description: "Se usará esta ubicación al reservar.",
                                    duration: 2000
                                });
                            }
                        }}
                    />
                    {!isPassenger && ride.status === 'scheduled' && (
                        <div className="absolute top-4 right-4 bg-white/90 backdrop-blur px-3 py-1.5 rounded-xl border border-slate-100 flex items-center gap-1.5 shadow-sm z-[10] pointer-events-none">
                            <MapPin className="size-3 text-primary animate-pulse" />
                            <span className="text-[9px] font-black uppercase text-slate-900 tracking-tighter">Toca el mapa para elegir recogida</span>
                        </div>
                    )}
                    {isRideActive && (isDriver || isPassenger) && (
                        <button
                            onClick={handleTriggerSOS}
                            disabled={isSOSLoading}
                            className="absolute bottom-4 right-4 bg-red-600 hover:bg-red-700 text-white p-3 rounded-2xl shadow-lg shadow-red-500/40 flex items-center gap-2 transition-all active:scale-95 z-[20] disabled:opacity-50"
                        >
                            {isSOSLoading ? <Loader2 className="size-5 animate-spin" /> : <ShieldAlert size={20} />}
                            <span className="text-[10px] font-black uppercase tracking-widest">SOS</span>
                        </button>
                    )}
                </div>

                {/* INFO TIEMPO Y PRECIO */}
                <Card className="rounded-[2.5rem] border-none shadow-2xl bg-white p-8 space-y-6">
                    <div className="flex justify-between items-start">
                        <div className="text-left space-y-1">
                            <div className="flex items-center gap-2 text-primary font-black uppercase tracking-[0.2em] text-[10px]">
                                <Calendar size={12} className="shrink-0" />
                                <span className="truncate">{ride.departure_time ? format(new Date(ride.departure_time), "EEEE d 'de' MMMM", { locale: es }) : 'Fecha pendiente'}</span>
                            </div>
                            <h2 className={cn(
                                "text-4xl font-black tracking-tighter italic leading-none pt-1 transition-colors",
                                isDelayed ? "text-amber-500" : "text-slate-900"
                            )}>
                                {ride.departure_time ? format(new Date(ride.departure_time), "HH:mm") : '--:--'}
                            </h2>
                            {isDelayed && !isTooLate && (
                                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase text-amber-500 animate-pulse">
                                    <AlertCircle size={10} /> Salida con retraso
                                </div>
                            )}
                            {isTooLate && (
                                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase text-red-500">
                                    <XCircle size={10} /> Viaje expirado
                                </div>
                            )}
                        </div>
                        <div className="text-right shrink-0">
                            <div className="bg-emerald-50 text-emerald-600 px-4 py-3 rounded-2xl inline-block border border-emerald-100 shadow-sm">
                                <span className="text-[9px] font-black uppercase block leading-none opacity-60 tracking-widest mb-1.5">Precio</span>
                                <span className="text-3xl font-black tracking-tighter leading-none">{ride.price ? ride.price.toFixed(2) : '0.00'}€</span>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1 bg-slate-50 p-4 rounded-3xl border border-slate-100">
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                                <Users size={12} /> Plazas
                            </p>
                            <p className="text-sm font-bold text-slate-700">
                                {ride.seats_available} disponibles <span className="text-slate-300 font-normal">/ {ride.total_seats || 4}</span>
                            </p>
                        </div>
                        <div className="space-y-1 bg-slate-50 p-4 rounded-3xl border border-slate-100">
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                                <ShieldCheck size={12} /> Seguro
                            </p>
                            <p className="text-sm font-bold text-slate-700">Protección ShareWay</p>
                        </div>
                    </div>
                </Card>

                {/* RUTA */}
                <Card className="rounded-[2.5rem] border-none shadow-xl bg-white p-8">
                    <div className="relative space-y-8 before:absolute before:left-3 before:top-3 before:bottom-3 before:w-0.5 before:bg-gradient-to-b before:from-primary before:to-emerald-500 before:rounded-full">
                        <div className="relative pl-10">
                            <div className="absolute left-0 top-1 w-6 h-6 bg-primary/10 rounded-full flex items-center justify-center">
                                <div className="w-2 h-2 bg-primary rounded-full ring-4 ring-primary/20" />
                            </div>
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Origen</p>
                            <p className="text-lg font-black text-slate-900 tracking-tight leading-tight">{ride.origin_address || 'Ubicación de origen'}</p>
                        </div>
                        <div className="relative pl-10">
                            <div className="absolute left-0 top-1 w-6 h-6 bg-emerald-500/10 rounded-full flex items-center justify-center">
                                <div className="w-2 h-2 bg-emerald-500 rounded-full ring-4 ring-emerald-500/20" />
                            </div>
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Destino Final</p>
                            <p className="text-lg font-black text-slate-900 tracking-tight leading-tight">{ride.destination_address || 'Ubicación de destino'}</p>
                        </div>
                    </div>
                </Card>

                {/* CONDUCTOR */}
                <Card className="rounded-[2.5rem] border-none shadow-xl bg-white overflow-hidden">
                    <div className="p-8">
                        <div className="flex items-center gap-6">
                            <div className="relative shrink-0">
                                <Avatar className="w-20 h-20 ring-4 ring-slate-50">
                                    <AvatarImage src={ride.driver?.avatar_url} />
                                    <AvatarFallback className="bg-primary/10 text-primary font-black text-xl">
                                        {ride.driver?.display_name?.charAt(0) || 'D'}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-lg">
                                    <BadgeCheck className="text-primary size-6 fill-white" />
                                </div>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex flex-col gap-1.5 mb-2">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-xl font-black text-slate-900 tracking-tighter truncate leading-none">
                                            {ride.driver?.display_name || 'Conductor'}
                                        </h3>
                                        <div className="flex items-center gap-1 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-lg border border-amber-100 shrink-0">
                                            <Star size={10} className="fill-current" />
                                            <span className="text-[10px] font-bold">{ride.driver?.rating || '4.9'}</span>
                                        </div>
                                    </div>
                                    <p className="text-slate-500 text-xs font-medium tracking-tight truncate">Viene de {ride.driver?.city || 'Valencia'}</p>
                                </div>

                                <div className="flex gap-2">
                                    <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 transition-colors hover:bg-slate-100">
                                        <Car size={16} className="text-slate-400" />
                                    </div>
                                    <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 transition-colors hover:bg-slate-100">
                                        <Music size={16} className="text-slate-400" />
                                    </div>
                                    <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 transition-colors hover:bg-slate-100">
                                        <Heart size={16} className="text-slate-400" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Detalles del coche */}
                    <div className="bg-slate-50 px-8 py-4 border-t border-slate-100 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="size-8 rounded-full bg-white flex items-center justify-center shadow-sm">
                                <Car size={14} className="text-primary" />
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase text-slate-400 tracking-tighter leading-none">Vehículo</p>
                                <p className="text-xs font-bold text-slate-700">{ride.vehicle_model || 'Tesla Model 3'}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-tighter leading-none">Matrícula</p>
                            <p className="text-xs font-black text-slate-900 uppercase tracking-widest">{ride.vehicle_plate || '••••'}</p>
                        </div>
                    </div>
                </Card>

                {/* LISTA DE PASAJEROS (Para conductor o pasajeros confirmados) */}
                {(isDriver || isPassenger) && confirmedPassengers.length > 0 && (
                    <div className="space-y-4 pt-4">
                        <div className="flex items-center justify-between px-2">
                            <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
                                <Users size={14} /> Tus compañeros de viaje ({confirmedPassengers.length})
                            </h4>
                        </div>
                        <div className="grid gap-3">
                            {confirmedPassengers.map((passenger) => (
                                <Card key={passenger.id} className="rounded-3xl border-none shadow-sm bg-white p-4 flex items-center justify-between group transition-all hover:shadow-md">
                                    <div className="flex items-center gap-3">
                                        <Avatar className="w-10 h-10 ring-2 ring-slate-50">
                                            <AvatarImage src={passenger.avatarUrl} />
                                            <AvatarFallback className="bg-primary/5 text-primary text-xs font-black">
                                                {passenger.displayName?.charAt(0)}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <p className="text-sm font-bold text-slate-900 leading-none mb-1">{passenger.displayName}</p>
                                            <div className="flex items-center gap-1.5">
                                                {passenger.status === 'completed' ? (
                                                    <span className="text-[9px] font-black uppercase tracking-tighter text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-md border border-blue-100 flex items-center gap-1">
                                                        <CheckCircle2 size={10} /> Entregado
                                                    </span>
                                                ) : passenger.status === 'verified' ? (
                                                    <span className="text-[9px] font-black uppercase tracking-tighter text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-100 flex items-center gap-1">
                                                        <BadgeCheck size={10} /> A bordo
                                                    </span>
                                                ) : (
                                                    <span className="text-[9px] font-black uppercase tracking-tighter text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100 flex items-center gap-1">
                                                        <Clock size={10} /> Confirmado
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        {isDriver && !isRideClosed && (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="rounded-xl bg-slate-50 hover:bg-primary/10 hover:text-primary transition-colors h-10 w-10"
                                                    onClick={() => {
                                                        // Prioridad absoluta al origen (Recogida) del pasajero o del viaje
                                                        const targetLat = passenger.pickup_location?.lat || passenger.pickup_location?.latitude || ride.origin?.lat || (ride.origin?.coordinates?.lat);
                                                        const targetLng = passenger.pickup_location?.lng || passenger.pickup_location?.longitude || ride.origin?.lng || (ride.origin?.coordinates?.lng);

                                                        const url = `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=driving`;
                                                        window.open(url, '_blank');
                                                    }}
                                                    title="Navegar al Origen"
                                                >
                                                    <Navigation size={18} className={cn((isRideActive && passenger.status === 'verified') ? "text-emerald-500" : "text-primary")} />
                                                </Button>

                                                {passenger.status === 'verified' && (
                                                    <Button
                                                        onClick={() => handlePassengerDropoff(passenger)}
                                                        disabled={isDroppingOff}
                                                        className="rounded-xl h-10 px-3 bg-emerald-500 text-white font-black uppercase italic tracking-tighter text-[10px] gap-2 shadow-lg shadow-emerald-200 hover:scale-105 active:scale-95 transition-all"
                                                    >
                                                        {isDroppingOff ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 size={14} />}
                                                        Finalizar Parada
                                                    </Button>
                                                )}


                                                {passenger.status === 'confirmed' && isRideActive && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => onPassengerNoShow(passenger)}
                                                        className="rounded-xl bg-red-50 hover:bg-red-100 text-red-500 transition-colors h-10 w-10"
                                                        title="No se presentó"
                                                    >
                                                        <UserX size={18} />
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="rounded-xl bg-slate-50 hover:bg-primary/10 hover:text-primary transition-colors h-10 w-10"
                                            onClick={() => handleOpenPrivateChat(passenger.id)}
                                        >
                                            <MessageCircle size={18} />
                                        </Button>
                                        {isDriver && passenger.status === 'confirmed' && !isRideClosed && (
                                            <div className="flex flex-col items-end gap-1">
                                                <Button
                                                    disabled={!canVerifyPassenger}
                                                    onClick={() => {
                                                        setSelectedPassenger(passenger);
                                                        setIsPinDialogOpen(true);
                                                    }}
                                                    className={cn(
                                                        "rounded-xl h-10 px-4 font-black uppercase italic tracking-tighter text-[10px] gap-2 shadow-lg transition-all z-10",
                                                        canVerifyPassenger ? "bg-primary text-white shadow-primary/20 hover:scale-105 active:scale-95" : "bg-slate-100 text-slate-400 shadow-none cursor-not-allowed"
                                                    )}
                                                >
                                                    <Fingerprint size={14} /> Verificar
                                                </Button>
                                                {!canVerifyPassenger && (
                                                    <span className="text-[7px] font-bold text-slate-400 uppercase tracking-tighter mr-1">Disponible 15m antes</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </div>
                )}
            </main>

            {/* BARRA DE ACCIÓN INFERIOR - Optimizada para Móvil Elite */}
            <div className="fixed bottom-0 left-0 right-0 p-6 z-40 pointer-events-none"
                 style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
                <div className="max-w-xl mx-auto flex gap-3 pointer-events-auto bg-white/60 backdrop-blur-xl p-4 rounded-[2.5rem] border border-white/40 shadow-elite-hover">
                    {isDriver ? (
                        <>
                            {ride.status === 'scheduled' && (
                                <>
                                    <Button
                                        onClick={() => setIsCancelConfirmOpen(true)}
                                        disabled={isCancelling}
                                        variant="outline"
                                        className="h-16 flex-1 rounded-3xl border-2 border-slate-100 font-black uppercase italic tracking-widest text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-100 transition-all duration-300"
                                    >
                                        {isCancelling ? <Loader2 className="animate-spin" /> : 'Cancelar'}
                                    </Button>
                                    <Button
                                        onClick={handleStartRide}
                                        disabled={isStarting || !canStartRide}
                                        className={cn(
                                            "h-16 flex-[2] rounded-3xl font-black uppercase italic tracking-widest text-white shadow-2xl transition-all duration-300 transform active:scale-95 group overflow-hidden relative",
                                            canStartRide ? "bg-primary hover:shadow-primary/40" : "bg-slate-200 cursor-not-allowed"
                                        )}
                                    >
                                        {isStarting ? (
                                            <Loader2 className="animate-spin" />
                                        ) : (
                                            <span className="flex items-center gap-3">
                                                Iniciar Viaje <Play size={20} className="fill-current group-hover:translate-x-1 transition-transform" />
                                            </span>
                                        )}
                                        {!canStartRide && (
                                            <div className="absolute inset-x-0 bottom-1 flex justify-center">
                                                <span className="text-[7px] tracking-normal opacity-70">Disponible 15 min antes</span>
                                            </div>
                                        )}
                                    </Button>
                                </>
                            )}
                            {(ride.status === 'active' || ride.status === 'in_progress') && (
                                <Button
                                    onClick={handleCompleteRide}
                                    disabled={isCompleting}
                                    className="h-16 flex-1 rounded-3xl bg-emerald-500 hover:bg-emerald-600 font-black uppercase italic tracking-widest text-white shadow-2xl shadow-emerald-200"
                                >
                                    {isCompleting ? <Loader2 className="animate-spin" /> : 'Finalizar Viaje'}
                                </Button>
                            )}
                        </>
                    ) : isPassenger ? (
                        <div className="flex flex-col w-full gap-4">
                            {/* Mostrar PIN si el viaje está programado o activo y no estoy verificado */}
                            {myPassengerEntry?.status !== 'verified' && (ride.status === 'scheduled' || isRideActive) && (
                                <div className="bg-primary/10 border-2 border-primary/20 rounded-3xl p-4 flex items-center justify-between mb-2">
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-primary tracking-widest">Tu PIN de Seguridad</p>
                                        <p className="text-2xl font-black text-slate-900 tracking-[0.5em]">{myPin}</p>
                                    </div>
                                    <Lock className="text-primary size-8 opacity-50" />
                                </div>
                            )}

                            <div className="flex gap-3">
                                <Button
                                    variant="outline"
                                    className="h-16 flex-1 rounded-3xl border-2 border-slate-100 font-black uppercase italic tracking-widest text-slate-400"
                                    onClick={async () => {
                                        if (window.confirm("¿Seguro que quieres cancelar tu reserva?")) {
                                            try {
                                                const res = await cancelBooking(rideId);
                                                if (res.success) {
                                                    toast.success("Reserva cancelada");
                                                    fetchRide();
                                                }
                                            } catch (err) {
                                                toast.error("No se pudo cancelar");
                                            }
                                        }
                                    }}
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    onClick={() => navigate(`/rides/${rideId}/chats`)}
                                    className="h-16 flex-[2] rounded-3xl bg-slate-900 font-black uppercase italic tracking-widest text-white shadow-2xl"
                                >
                                    <span className="flex items-center gap-2">Chat <MessageCircle size={18} /></span>
                                </Button>
                            </div>

                            {/* Botón para abrir modal de rating si el viaje terminó y no he calificado */}
                            {ride.status === 'completed' && myPassengerEntry?.status === 'verified' && !isRated && (
                                <Button
                                    onClick={() => setIsRatingModalOpen(true)}
                                    className="h-16 w-full rounded-3xl bg-amber-400 hover:bg-amber-500 font-black uppercase italic tracking-widest text-slate-900"
                                >
                                    <Star className="mr-2 fill-current" /> Calificar Viaje
                                </Button>
                            )}
                        </div>
                    ) : (
                        <Button
                            disabled={ride.seats_available <= 0 || isRideCancelled}
                            onClick={() => setIsBookingModalOpen(true)}
                            className={cn(
                                "h-16 w-full rounded-[2.5rem] font-black uppercase italic tracking-[0.2em] text-lg shadow-2xl transition-all duration-300 transform active:scale-95 group",
                                ride.seats_available > 0 ? "bg-primary hover:shadow-primary/40 text-white" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                            )}
                        >
                            {ride.seats_available > 0 ? (
                                <span className="flex items-center gap-3">
                                    Reservar Plaza <ChevronRight size={24} className="group-hover:translate-x-1 transition-transform" />
                                </span>
                            ) : 'Viaje Completo'}
                        </Button>
                    )}
                </div>
            </div>

            {/* MODALES */}
            <BookingPaymentModal
                isOpen={isBookingModalOpen}
                onClose={() => setIsBookingModalOpen(false)}
                ride={ride}
                initialPickupLocation={selectedPickupLocation}
                onSuccess={() => {
                    setIsBookingModalOpen(false);
                    fetchRide();
                    toast.success("¡Reserva completada!", {
                        description: "Tu plaza ha sido confirmada con éxito."
                    });
                }}
            />

            <PinVerificationDialog
                open={isPinDialogOpen}
                onOpenChange={setIsPinDialogOpen}
                onConfirm={handleVerifyPin}
                title={selectedPassenger ? `Verificar a ${selectedPassenger.displayName}` : "Verificar PIN"}
                isLoading={isVerifying}
            />

            <RideRatingModal
                isOpen={isRatingModalOpen}
                onClose={() => setIsRatingModalOpen(false)}
                rideId={rideId}
                driverId={ride.driver_id}
                driverName={ride.driver?.display_name}
                onSuccess={() => {
                    setIsRatingModalOpen(false);
                    fetchRide();
                }}
            />

            <AlertDialog open={isCancelConfirmOpen} onOpenChange={setIsCancelConfirmOpen}>
                <AlertDialogContent className="rounded-[2.5rem] border-none p-8">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-2xl font-black italic uppercase tracking-tighter">¿Cancelar este viaje?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-500 font-medium pt-2">
                            Esta acción notificará a todos los pasajeros y no se puede deshacer. Se aplicarán las políticas de cancelación vigentes.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-6 gap-3">
                        <AlertDialogCancel className="h-14 rounded-2xl border-2 border-slate-100 font-bold uppercase tracking-widest text-[10px]">Cerrar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleCancelRide} className="h-14 rounded-2xl bg-red-500 hover:bg-red-600 font-bold uppercase tracking-widest text-[10px] text-white">Sí, cancelar viaje</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default RideDetails;
