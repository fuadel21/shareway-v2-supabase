import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useOutletContext, Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

import SubPageHeader from './SubPageHeader';
import RideManagement from './RideManagement.jsx';
import MapComponent from './MapComponent';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, UserX, Armchair, BadgeCheck, Sparkles, Navigation, Euro, ShieldCheck, Car as CarIcon, MapPin as MapPinIcon, Phone, ShieldAlert, Share2, Copy, MessageCircle, CheckCircle, Star, Users, AlertCircle, Calendar, Clock, Leaf, Sprout, CreditCard, Radio, Shield, Heart, Ban, Fingerprint, Wallet, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWallet } from '@/hooks/useWallet';
import { getRideDetailsSecure, getMyRidePin } from '@/lib/supabaseRPC';
import { useTranslation } from 'react-i18next';
import { triggerSOS, getEmergencyContacts } from '@/services/safetyService';
import { confirmTripAndPay } from '@/services/bookingService';

import BookingPaymentModal from './BookingPaymentModal';

function RideDetails() {
    const { t } = useTranslation();
    const { id: rideId } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user, profile } = useOutletContext();
    const { wallet, refreshWallet } = useWallet(user);

    const [ride, setRide] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isSelectorOpen, setIsSelectorOpen] = useState(false);
    const [myPin, setMyPin] = useState(null);
    const [emergencyContacts, setEmergencyContacts] = useState([]);
    const [hasCheckedContacts, setHasCheckedContacts] = useState(false);
    const [pickupLocation, setPickupLocation] = useState(null);
    const [pickupAddress, setPickupAddress] = useState("");

    const fetchRideDetails = useCallback(async () => {
        if (!rideId) return;
        setLoading(true);
        try {
            const response = await getRideDetailsSecure(rideId);
            const rawData = response.data?.data || response.data || response;

            if (!rawData || !rawData.id) {
                setRide(null);
                return;
            }

            const normalizedRide = {
                ...rawData,
                type: 'ride',
                dateTime: rawData.departure_time ? new Date(rawData.departure_time) : null,
                passengers: rawData.passengers || [],
                driver: {
                    id: rawData.driver_id,
                    full_name: rawData.driver_name,
                    photo_url: rawData.driver_photo,
                    verification: { status: rawData.driver_verified ? 'verified' : 'not_verified' },
                    rating: rawData.driver_rating || 0
                }
            };

            setRide(normalizedRide);

            if (user && normalizedRide.passengers) {
                const activePassenger = normalizedRide.passengers.find(p => String(p.id) === String(user.id) && p.status !== 'cancelled');
                if (activePassenger && ['confirmed', 'verified', 'on_board', 'picked_up'].includes(activePassenger.status)) {
                    const pinRes = await getMyRidePin(rideId);
                    if (pinRes.success) setMyPin(String(pinRes.data.pin || pinRes.data));
                }
            }
        } catch (error) {
            console.error("⛔ Ride Details Load Error:", error);
        } finally {
            setLoading(false);
        }
    }, [rideId, user]);

    // EFECTO: Suscripción a cambios en el viaje (Real-time GPS para pasajeros)
    useEffect(() => {
        if (!rideId || loading) return;

        const channel = supabase
            .channel(`ride-tracking-${rideId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` },
                (payload) => {
                    const newStatus = payload.new.status;
                    const isDriverNow = String(payload.new.driver_id) === String(user?.id);

                    // PROTOCOLO DE VALORACIÓN AUTOMÁTICA
                    // Si el viaje se completa y NO somos el conductor (somos pasajero), redirigimos a valorar
                    if (newStatus === 'completed' && !isDriverNow) {
                        toast.success("¡Viaje finalizado!", { description: "Valora tu experiencia con el conductor." });
                        navigate(`/leave-review/${rideId}/${payload.new.driver_id}`);
                        return;
                    }

                    setRide(prev => prev ? ({
                        ...prev,
                        status: newStatus,
                        current_location: payload.new.current_location,
                        seats_available: payload.new.seats_available,
                        passengers: payload.new.passengers
                    }) : null);
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [rideId, loading]);

    // EFECTO: Carga de contactos de emergencia
    useEffect(() => {
        const loadSafetyData = async () => {
            if (user?.id) {
                const contacts = await getEmergencyContacts(user.id);
                setEmergencyContacts(contacts);
                setHasCheckedContacts(true);
            }
        };
        loadSafetyData();
    }, [user]);

    useEffect(() => {
        fetchRideDetails();
    }, [fetchRideDetails]);

    const { isDriver, activePassenger, isRideActive, isRideCompleted, genderLock, isParticipant } = useMemo(() => {
        if (!ride || !user) return { isDriver: false, isParticipant: false, isRideCompleted: false };

        const isDriver = String(ride.driver_id) === String(user.id);
        const activePassenger = (ride.passengers || []).find(p => String(p.id) === String(user.id) && !['cancelled', 'rejected'].includes(p.status));

        const isRideActive = ride.status === 'active' || ride.status === 'in_progress';
        const isRideCompleted = ride.status === 'completed';
        const genderLock = ride.is_women_only && profile?.gender !== 'female';
        const isParticipant = isDriver || !!activePassenger;

        return { isDriver, activePassenger, isRideActive, isRideCompleted, genderLock, isParticipant };
    }, [ride, user, profile]);

    const handleConfirmTrip = async (retry = false) => {
        const isRetry = retry === true;
        if (isProcessing) return;
        setIsProcessing(true);
        const toastId = toast.loading("Confirmando...");
        try {
            // Pasamos pickupLocation y pickupAddress si existen
            const res = await confirmTripAndPay(ride.id, searchParams.get('requestId'), { 
                ...user, 
                pickupLocation,
                pickupAddress 
            });
            if (res.success) {
                toast.success("¡Plaza confirmada!", { id: toastId });
                await refreshWallet();
                fetchRideDetails();
                setIsPaymentModalOpen(false);
                setIsSelectorOpen(false);
            }
        } catch (error) {
            if (!isRetry && error.message.includes("Saldo insuficiente")) {
                toast.dismiss(toastId);
                // Si no hay saldo, sugerimos cargar la tarjeta
                setIsSelectorOpen(false);
                setIsPaymentModalOpen(true);
            } else {
                toast.error("Error", { id: toastId, description: error.message });
            }
        } finally {
            setIsProcessing(false);
        }
    };

    const copyPin = () => {
        if (myPin) {
            navigator.clipboard.writeText(myPin);
            toast.success("PIN copiado al portapapeles");
        }
    };

    const handleSOS = async () => {
        if (!rideId) return;
        try {
            setIsProcessing(true);
            await triggerSOS(rideId);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleMapClick = async (latlng) => {
        if (!isDriver && !activePassenger && !isRideCompleted) {
            setPickupLocation({ lat: latlng.lat, lng: latlng.lng });
            setPickupAddress("Cargando dirección...");
            
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}`);
                const data = await res.json();
                const addr = data.display_name?.split(',').slice(0, 2).join(',') || "Punto seleccionado";
                setPickupAddress(addr);
                toast.info("Dirección de recogida", { description: addr });
            } catch (e) {
                setPickupAddress("Ubicación en el mapa");
            }
        }
    };

    if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-primary h-10 w-10 opacity-20" /></div>;
    if (!ride) return <div className="h-screen flex items-center justify-center bg-slate-50"><p className="font-black text-slate-400 uppercase tracking-widest">Viaje no encontrado</p></div>;

    const rideDateTime = ride.dateTime instanceof Date && isValid(ride.dateTime) ? ride.dateTime : null;

    return (
        <div className="bg-slate-50 min-h-screen pb-40 font-sans text-left">
            <SubPageHeader title="Detalles del Viaje" />

            <main className="max-w-4xl mx-auto px-4 -mt-10 relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 text-left">
                <div className="lg:col-span-8 space-y-6 text-left">
                    <div className="rounded-[2.5rem] overflow-hidden shadow-2xl h-80 relative border-4 border-white group">
                        <MapComponent
                            center={ride.current_location || ride.origin}
                            itemsToDisplay={ride.current_location ? [{ ...ride, type: 'live-location' }] : [ride]}
                            zoom={13}
                            onMapClick={handleMapClick}
                            pickupLocation={pickupLocation}
                        />
                        {isRideActive && (
                            <div className="absolute top-4 left-4 flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg animate-pulse">
                                <Radio size={14} /> EN CURSO
                            </div>
                        )}
                        {!isDriver && !activePassenger && (
                            <div className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur-md p-3 rounded-2xl shadow-lg border border-white/20 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                <p className="text-[9px] font-black text-slate-900 uppercase tracking-tighter italic flex items-center gap-2">
                                    <MapPinIcon size={12} className="text-primary" />
                                    Pulsa en el mapa para marcar tu punto de recogida
                                </p>
                            </div>
                        )}
                    </div>

                    {pickupLocation && !activePassenger && (
                        <div className="bg-primary/5 border border-primary/20 p-5 rounded-[2rem] flex items-center justify-between animate-in zoom-in duration-300 shadow-sm">
                            <div className="flex items-center gap-4">
                                <div className="bg-primary text-white p-3 rounded-2xl shadow-lg shadow-primary/20">
                                    <MapPinIcon size={20} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-0.5">Punto de recogida elegido</p>
                                    <p className="text-sm font-black text-slate-900 uppercase italic tracking-tighter">{pickupAddress}</p>
                                </div>
                            </div>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => { setPickupLocation(null); setPickupAddress(""); }}
                                className="text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl size-10"
                            >
                                <X size={20} />
                            </Button>
                        </div>
                    )}

                    <Card className="rounded-[2.5rem] border-none shadow-xl bg-white p-8 space-y-8 text-left">
                        <div className="flex justify-between items-start">
                            <div className="text-left">
                                <div className="flex items-center gap-2 text-primary font-bold mb-1">
                                    <Calendar className="h-4 w-4" />
                                    <span className="text-xs uppercase tracking-widest">
                                        {rideDateTime ? format(rideDateTime, "EEEE d 'de' MMMM", { locale: es }) : 'Fecha no disponible'}
                                    </span>
                                </div>
                                <h2 className="text-4xl font-black text-slate-900 tracking-tighter italic leading-none">
                                    {rideDateTime ? format(rideDateTime, "HH:mm") : '--:--'}
                                </h2>
                            </div>
                            <div className="text-right">
                                <p className="text-4xl font-black text-primary tracking-tighter leading-none">{ride.price || 0}€</p>
                                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">por asiento</p>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <Avatar className="h-14 w-14 border-4 border-white shadow-lg">
                                    <AvatarImage src={ride.driver?.photo_url} />
                                    <AvatarFallback className="bg-primary text-white font-black">{ride.driver?.full_name?.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <div className="flex items-center gap-1.5">
                                        <p className="font-black text-slate-900 uppercase italic tracking-tighter">{ride.driver?.full_name}</p>
                                        {ride.driver?.verification?.status === 'verified' && <BadgeCheck size={16} className="text-emerald-500" />}
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <Star size={10} className="fill-amber-400 text-amber-400" />
                                        <p className="text-[10px] font-black text-slate-400">{ride.driver?.rating || 'Nuevo'}</p>
                                    </div>
                                </div>
                            </div>
                            <Link to={`/profile/${ride.driver?.id}`} className="text-[10px] font-black text-primary uppercase tracking-widest bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-100 hover:scale-105 transition-transform">Ver Perfil</Link>
                        </div>

                        <div className="space-y-6 relative text-left pl-2">
                            <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-slate-100" />
                            <div className="relative flex gap-6">
                                <div className="h-6 w-6 rounded-full border-[3px] border-emerald-500 bg-white z-10" />
                                <div className="text-left"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Origen</p><p className="font-bold text-slate-800 text-lg leading-tight">{ride.origin?.name || ride.origin?.address}</p></div>
                            </div>
                            <div className="relative flex gap-6">
                                <div className="h-6 w-6 rounded-full border-[3px] border-primary bg-slate-900 z-10" />
                                <div className="text-left"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Destino</p><p className="font-bold text-slate-800 text-lg leading-tight">{ride.destination?.name || ride.destination?.address}</p></div>
                            </div>
                        </div>
                    </Card>

                    {isDriver && <RideManagement ride={ride} onRefresh={fetchRideDetails} />}
                </div>

                <div className="lg:col-span-4 space-y-6">
                    {!isDriver && (
                        <Card className="rounded-[2.5rem] border-none shadow-xl bg-white p-8 space-y-6 sticky top-24 text-left">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tu Estado</p>
                            {activePassenger ? (
                                <div className="space-y-6">
                                    <div className="p-6 rounded-3xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center gap-4">
                                        <CheckCircle className="h-6 w-6 shrink-0" />
                                        <p className="font-black text-sm uppercase italic">Plaza Asegurada</p>
                                    </div>

                                    {/* BLOQUE DE PIN DE VERIFICACIÓN (RE-IMPLEMENTADO) */}
                                    {myPin && (
                                        <div className="bg-slate-900 rounded-[2rem] p-6 text-white space-y-4 shadow-2xl animate-in slide-in-from-bottom-4 duration-700">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <Fingerprint size={14} className="text-primary" />
                                                    <span className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-400">Código de Seguridad</span>
                                                </div>
                                                <Button size="icon" variant="ghost" onClick={copyPin} className="h-6 w-6 hover:bg-white/10 text-slate-400"><Copy size={12} /></Button>
                                            </div>
                                            <div className="flex justify-center">
                                                <div className="bg-white/5 border border-white/10 rounded-2xl px-8 py-4">
                                                    <span className="text-4xl font-black tracking-[0.3em] text-primary font-mono">{myPin}</span>
                                                </div>
                                            </div>
                                            <p className="text-[8px] font-bold text-slate-500 text-center uppercase tracking-widest leading-relaxed">
                                                Muestra este código al conductor <br /> al subir al vehículo para verificar tu plaza.
                                            </p>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-3">
                                        <Button onClick={() => navigate(`/rides/${ride.id}/chats`)} variant="secondary" className="h-14 rounded-2xl font-black text-[10px] uppercase tracking-widest bg-white border-2">
                                            <MessageCircle className="h-4 w-4 mr-1" />
                                            CONVERSACIONES
                                        </Button>
                                        <Button onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${ride.destination?.lat},${ride.destination?.lng}`, '_blank')} variant="secondary" className="h-14 rounded-2xl font-black text-[10px] uppercase tracking-widest bg-white border-2">RUTA</Button>
                                    </div>

                                    {ride.status === 'scheduled' && (
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" className="w-full h-10 rounded-xl text-slate-400 font-bold text-[9px] uppercase tracking-widest hover:text-red-500 hover:bg-red-50 transition-all">
                                                    Cancelar mi reserva
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent className="rounded-[2.5rem] border-none">
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle className="text-xl font-black uppercase italic tracking-tighter">¿Cancelar reserva?</AlertDialogTitle>
                                                    <AlertDialogDescription className="text-slate-500 font-medium">
                                                        <div className="space-y-3 pt-2">
                                                            <p>El importe se devolverá a tu cartera ShareWay de forma automática.</p>
                                                            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-600">
                                                                ⚠️ CARGO POR GESTIÓN:<br />
                                                                - Se retendrá un 20% del importe en concepto de gastos operativos y penalización por cancelación.
                                                            </div>
                                                        </div>
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter className="gap-2">
                                                    <AlertDialogCancel className="rounded-xl font-bold uppercase text-[10px] tracking-widest border-none bg-slate-100">Cerrar</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={async () => {
                                                            setIsProcessing(true);
                                                            try {
                                                                const { cancelBooking } = await import('@/services/rideService');
                                                                await cancelBooking(ride.id);
                                                                toast.success("Reserva cancelada", { description: "Se ha procesado el reembolso parcial." });
                                                                fetchRideDetails();
                                                            } catch (e) {
                                                                toast.error(e.message);
                                                            } finally {
                                                                setIsProcessing(false);
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
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="text-center p-6 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
                                        <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Asientos Disponibles</p>
                                        <p className="text-3xl font-black text-slate-900 italic">{ride.seats_available}</p>
                                    </div>
                                    {genderLock ? (
                                        <div className="p-4 bg-pink-50 text-pink-600 rounded-2xl border border-pink-100 flex items-center gap-3">
                                            <ShieldAlert size={18} />
                                            <p className="text-[10px] font-bold uppercase leading-tight">Este viaje es exclusivo para mujeres.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <Button
                                                onClick={() => setIsSelectorOpen(true)}
                                                disabled={isProcessing || ride.seats_available <= 0}
                                                className="w-full h-20 rounded-[2rem] bg-slate-900 text-white font-black text-lg italic shadow-2xl active:scale-95 transition-all"
                                            >
                                                {isProcessing ? <Loader2 className="animate-spin" /> : 'RESERVAR'}
                                            </Button>
                                            <p className="text-[9px] text-center font-black text-slate-400 uppercase tracking-widest px-4 leading-relaxed">
                                                Al reservar, aceptas nuestras políticas de cancelación y convivencia.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </Card>
                    )}

                    {/* SELECTOR DE MÉTODO DE PAGO */}
                    <Dialog open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
                        <DialogContent className="sm:max-w-[420px] rounded-[2.5rem] border-none shadow-2xl p-0 bg-white overflow-hidden outline-none">
                            <div className="p-8 space-y-6">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-3">
                                        <div className="size-10 bg-primary/10 rounded-xl flex items-center justify-center">
                                            <CreditCard className="h-5 w-5 text-primary" />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black italic uppercase tracking-tighter text-slate-900 leading-tight">MÉTODO DE PAGO</h3>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Selecciona cómo deseas pagar</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    {/* OPCIÓN: SALDO SHAREWAY */}
                                    <button
                                        onClick={() => handleConfirmTrip()}
                                        disabled={isProcessing}
                                        className="w-full group relative flex items-center gap-4 p-5 rounded-3xl border-2 border-slate-50 bg-slate-50 hover:border-primary hover:bg-primary/5 transition-all text-left disabled:opacity-50"
                                    >
                                        <div className="size-12 rounded-2xl bg-white shadow-sm flex items-center justify-center group-hover:scale-110 transition-transform">
                                            <Wallet className="h-6 w-6 text-primary" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-black uppercase italic tracking-tighter text-slate-900">Saldo Cartera</p>
                                            <p className="text-[10px] font-bold text-slate-500">Disponible: {wallet?.balance?.toFixed(2)}€</p>
                                        </div>
                                        {wallet?.balance >= ride.price ? (
                                            <div className="size-5 rounded-full bg-emerald-500 flex items-center justify-center">
                                                <CheckCircle className="h-3 w-3 text-white" />
                                            </div>
                                        ) : (
                                            <div className="px-2 py-0.5 bg-red-100 rounded-lg">
                                                <span className="text-[8px] font-black text-red-600 uppercase">Insuficiente</span>
                                            </div>
                                        )}
                                    </button>

                                    {/* OPCIÓN: TARJETA / DIGITAL WALLETS */}
                                    <button
                                        onClick={() => {
                                            setIsSelectorOpen(false);
                                            setIsPaymentModalOpen(true);
                                        }}
                                        className="w-full group relative flex items-center gap-4 p-5 rounded-3xl border-2 border-slate-50 bg-slate-50 hover:border-primary hover:bg-primary/5 transition-all text-left"
                                    >
                                        <div className="size-12 rounded-2xl bg-white shadow-sm flex items-center justify-center group-hover:scale-110 transition-transform">
                                            <div className="relative">
                                                <CreditCard className="h-6 w-6 text-slate-900" />
                                                <div className="absolute -top-1 -right-1 size-3 bg-emerald-500 rounded-full border-2 border-white" />
                                            </div>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-black uppercase italic tracking-tighter text-slate-900">Tarjeta / Otros</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <div className="flex -space-x-1 opacity-40">
                                                    <div className="size-3 bg-blue-600 rounded-[2px]" />
                                                    <div className="size-3 bg-red-500 rounded-[2px]" />
                                                    <div className="size-3 bg-orange-400 rounded-[2px]" />
                                                </div>
                                                <p className="text-[10px] font-bold text-slate-400">Apple Pay, G-Pay, Visa...</p>
                                            </div>
                                        </div>
                                        <div className="size-8 rounded-xl bg-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                                            <Sparkles size={14} className="text-primary" />
                                        </div>
                                    </button>
                                </div>

                                <div className="pt-2">
                                    <p className="text-[9px] text-center font-bold text-slate-300 uppercase tracking-widest leading-relaxed">
                                        Pago procesado de forma segura por Stripe. <br /> Los fondos se mantendrán en garantía hasta finalizar el viaje.
                                    </p>
                                </div>

                                <Button
                                    variant="ghost"
                                    onClick={() => setIsSelectorOpen(false)}
                                    className="w-full h-12 rounded-2xl font-black text-[10px] uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-colors"
                                >
                                    Cancelar
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>

                    {isDriver && (
                        <div className="p-8 bg-slate-900 rounded-[2.5rem] text-white space-y-4 shadow-2xl animate-in zoom-in duration-500">
                            <Sparkles className="size-10 text-primary" />
                            <h3 className="text-xl font-black uppercase italic tracking-tighter">Panel de Control</h3>
                            <p className="text-xs text-slate-400 font-medium leading-relaxed">Este es tu viaje. Gestiona a tus pasajeros y el estado del trayecto desde el panel de la izquierda.</p>
                        </div>
                    )}

                    {isParticipant && isRideActive && (
                        <div className="p-8 bg-red-600 rounded-[2.5rem] text-white space-y-4 shadow-2xl animate-pulse">
                            <div className="flex items-center gap-3">
                                <ShieldAlert size={32} />
                                <h3 className="text-xl font-black uppercase italic tracking-tighter">CENTRO SOS</h3>
                            </div>
                            <p className="text-xs text-red-100 font-medium leading-relaxed">Solo pulsa este botón si te encuentras en una situación de peligro real.</p>
                            <Button
                                onClick={handleSOS}
                                disabled={isProcessing}
                                className="w-full h-16 rounded-2xl bg-white text-red-600 font-black text-sm uppercase tracking-widest hover:bg-red-50"
                            >
                                {isProcessing ? <Loader2 className="animate-spin" /> : "ACTIVAR ALERTA SOS"}
                            </Button>
                        </div>
                    )}

                    {!isDriver && isParticipant && !isRideCompleted && hasCheckedContacts && emergencyContacts.length === 0 && (
                        <div className="p-8 bg-amber-50 rounded-[2.5rem] border-2 border-dashed border-amber-200 space-y-4">
                            <div className="flex items-center gap-3 text-amber-600">
                                <Shield size={24} />
                                <h3 className="text-sm font-black uppercase tracking-tighter">Seguridad ShareWay</h3>
                            </div>
                            <p className="text-xs text-amber-800 font-medium leading-relaxed">
                                No tienes contactos de emergencia configurados. Te recomendamos añadirlos para viajar con más seguridad.
                            </p>
                            <Button
                                onClick={() => navigate('/settings/safety')}
                                variant="outline"
                                className="w-full h-12 rounded-xl border-amber-300 text-amber-700 font-black text-[10px] uppercase tracking-widest hover:bg-amber-100"
                            >
                                CONFIGURAR GUARDIANES
                            </Button>
                        </div>
                    )}
                </div>
            </main>

            <BookingPaymentModal
                isOpen={isPaymentModalOpen}
                onClose={() => {
                    setIsPaymentModalOpen(false);
                    setIsSelectorOpen(true);
                }}
                rideId={ride.id}
                amount={parseFloat(ride?.price || 0)}
                onSuccess={() => {
                    setIsPaymentModalOpen(false);
                    fetchRideDetails();
                }}
            />
        </div>
    );
}

export default RideDetails;
