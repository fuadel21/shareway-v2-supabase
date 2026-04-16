
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, UserX, Armchair, BadgeCheck, Sparkles, Navigation, Euro, ShieldCheck, Car as CarIcon, MapPin as MapPinIcon, Phone, ShieldAlert, Share2, Copy, MessageCircle, CheckCircle, Star, Users, AlertCircle, Calendar, Clock, Leaf, Sprout, CreditCard, Radio, Shield, Heart, Ban, Fingerprint, Wallet, X, Trash2, Music, Dog, Baby, ExternalLink, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWallet } from '@/hooks/useWallet';
import { getRideDetailsSecure, getMyRidePin } from '@/lib/supabaseRPC';
import { useTranslation } from 'react-i18next';
import { triggerSOS, getEmergencyContacts } from '@/services/safetyService';
import { confirmTripAndPay, cancelBooking } from '@/services/bookingService';
import { calculateRideDetour } from '@/services/rideService';

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
    const [pickupLocation, setPickupLocation] = useState(null);
    const [pickupAddress, setPickupAddress] = useState("");
    const [dynamicPricing, setDynamicPricing] = useState(null);
    const [isCalculatingPrice, setIsCalculatingPrice] = useState(false);

    const fetchRideDetails = useCallback(async () => {
        if (!rideId) return;
        setLoading(true);
        try {
            const response = await getRideDetailsSecure(rideId);
            const rawData = response.data?.data || response.data || response;
            if (!rawData || !rawData.id) { setRide(null); return; }

            const normalizedRide = {
                ...rawData,
                type: 'ride',
                dateTime: rawData.departure_time ? new Date(rawData.departure_time) : null,
                passengers: rawData.passengers || [],
                driver: {
                    id: rawData.driver_id,
                    full_name: rawData.driver_name,
                    photo_url: rawData.driver_photo,
                    phone: rawData.driver_phone,
                    verification: { status: rawData.driver_verified ? 'verified' : 'not_verified' },
                    rating: rawData.driver_rating || 5.0,
                    vehicle: rawData.vehicle || { brand: 'Vehículo', model: 'No especificado', color: 'N/A', plate: '****' }
                }
            };
            setRide(normalizedRide);

            if (user && normalizedRide.passengers) {
                const activePassenger = normalizedRide.passengers.find(p => String(p.id) === String(user.id) && p.status !== 'cancelled');
                if (activePassenger && ['confirmed', 'verified', 'on_board', 'picked_up'].includes(activePassenger.status)) {
                    if (activePassenger.pin) { setMyPin(String(activePassenger.pin)); }
                    else {
                        const pinRes = await getMyRidePin(rideId);
                        if (pinRes.success && pinRes.data) {
                            const rawPin = pinRes.data.pin || pinRes.data.get_my_ride_pin || (typeof pinRes.data === 'object' ? Object.values(pinRes.data)[0] : pinRes.data);
                            setMyPin(String(rawPin));
                        }
                    }
                }
            }
        } catch (error) { console.error("[RideDetails] Load Error:", error); } 
        finally { setLoading(false); }
    }, [rideId, user]);

    useEffect(() => {
        if (!rideId || loading) return;
        const channel = supabase.channel(`ride-updates-${rideId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, () => fetchRideDetails())
            .subscribe();
        return () => supabase.removeChannel(channel);
    }, [rideId, loading, fetchRideDetails]);

    useEffect(() => { fetchRideDetails(); }, [fetchRideDetails]);

    const { isDriver, activePassenger, isRideActive, isRideCompleted, genderLock, isParticipant } = useMemo(() => {
        if (!ride || !user) return { isDriver: false, isParticipant: false, isRideCompleted: false, genderLock: false };
        const isDriver = String(ride.driver_id) === String(user.id);
        const activePassenger = (ride.passengers || []).find(p => String(p.id) === String(user.id) && !['cancelled', 'rejected'].includes(p.status));
        const isRideActive = ride.status === 'active' || ride.status === 'in_progress';
        const isRideCompleted = ride.status === 'completed';
        const genderLock = ride.is_women_only && String(profile?.gender).toLowerCase() !== 'female';
        return { isDriver, activePassenger, isRideActive, isRideCompleted, genderLock, isParticipant: isDriver || !!activePassenger };
    }, [ride, user, profile]);

    const handleCancelBooking = async () => {
        if (!ride || isProcessing) return;
        setIsProcessing(true);
        try {
            await cancelBooking(ride.id);
            toast.success("Reserva cancelada correctamente");
            fetchRideDetails();
            refreshWallet();
        } catch (error) { toast.error(error.message); } 
        finally { setIsProcessing(false); }
    };

    const handleConfirmTripWithWallet = async () => {
        if (!ride || isProcessing) return;
        setIsProcessing(true);
        const loadingToast = toast.loading("Procesando pago con saldo...");
        try {
            const res = await confirmTripAndPay(ride.id);
            if (res.success) {
                toast.success("¡Reserva confirmada!", { id: loadingToast });
                setIsSelectorOpen(false);
                fetchRideDetails();
                refreshWallet();
            } else { throw new Error(res.error || "Saldo insuficiente"); }
        } catch (error) {
            toast.error(error.message, { id: loadingToast });
        } finally { setIsProcessing(false); }
    };

    if (loading && !ride) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
    if (!ride) return <SubPageHeader title="No encontrado" backPath="/dashboard" />;

    return (
        <div className="min-h-screen bg-slate-50/50 pb-32">
            <SubPageHeader title="Detalles del Viaje" backPath="/dashboard" />

            <div className="max-w-xl mx-auto px-4 mt-6 space-y-6">
                {/* MAPA */}
                <div className="h-64 w-full rounded-[2.5rem] overflow-hidden shadow-xl relative border-4 border-white">
                    <MapComponent
                        center={ride.current_location || ride.origin.coordinates || ride.origin}
                        itemsToDisplay={[{ ...ride, type: ride.status === 'in_progress' ? 'live-location' : 'ride' }]}
                        zoom={14}
                    />
                </div>

                {/* TARJETA PRINCIPAL */}
                <Card className="rounded-[2.5rem] border-none shadow-xl bg-white p-6 space-y-6">
                    <div className="flex justify-between items-start">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-primary font-black uppercase tracking-widest text-[10px]">
                                <Calendar size={12} /> {ride.dateTime ? format(ride.dateTime, "EEEE d 'de' MMMM", { locale: es }) : '--'}
                            </div>
                            <h2 className="text-4xl font-black text-slate-900 tracking-tighter italic leading-none">
                                {ride.dateTime ? format(ride.dateTime, "HH:mm") : '--:--'}
                            </h2>
                        </div>
                        <div className="text-right">
                            <p className="text-4xl font-black text-primary italic tracking-tighter leading-none">{ride.price}€</p>
                        </div>
                    </div>

                    {!isRideCompleted && (
                        <div className="pt-2">
                            {activePassenger ? (
                                <div className="space-y-3">
                                    {myPin && activePassenger?.status === 'confirmed' && (
                                        <div className="bg-slate-900 text-white p-6 rounded-[2rem] text-center shadow-2xl relative overflow-hidden">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-1">Código de Embarque</p>
                                            <p className="text-5xl font-black italic tracking-tighter animate-pulse">{myPin}</p>
                                        </div>
                                    )}
                                    <Button onClick={handleCancelBooking} variant="ghost" className="w-full h-12 rounded-xl text-red-500 font-black text-[10px] uppercase tracking-widest">
                                        <Trash2 size={16} className="mr-2" /> Cancelar Reserva
                                    </Button>
                                </div>
                            ) : (
                                !isDriver && (
                                    <Button onClick={() => setIsSelectorOpen(true)} disabled={ride.seats_available <= 0 || genderLock} className="w-full h-16 lg:h-20 rounded-[2rem] bg-slate-900 text-white font-black text-xl italic shadow-2xl uppercase active:scale-95 transition-all">
                                        RESERVAR PLAZA
                                    </Button>
                                )
                            )}
                        </div>
                    )}
                </Card>

                {isDriver && <RideManagement ride={ride} onRefresh={fetchRideDetails} />}
            </div>

            {/* SELECTOR DE PAGO PROFESIONAL */}
            <Dialog open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
                <DialogContent className="max-w-[90vw] sm:max-w-[420px] rounded-[2.5rem] border-none shadow-2xl p-0 bg-white overflow-hidden outline-none">
                    <DialogHeader className="p-8 pb-4 text-left">
                        <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter text-slate-900">MÉTODO DE PAGO</DialogTitle>
                        <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">
                            Selecciona cómo deseas confirmar tu plaza
                        </DialogDescription>
                    </DialogHeader>

                    <div className="px-8 pb-8 space-y-3">
                        {/* OPCIÓN WALLET */}
                        <button 
                            onClick={handleConfirmTripWithWallet}
                            disabled={isProcessing}
                            className="w-full group relative flex items-center justify-between p-5 rounded-[1.8rem] bg-slate-50 hover:bg-emerald-50 border-2 border-transparent hover:border-emerald-200 transition-all text-left"
                        >
                            <div className="flex items-center gap-4">
                                <div className="size-12 rounded-2xl bg-white shadow-sm flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <Wallet className="size-6 text-emerald-500" />
                                </div>
                                <div>
                                    <p className="text-sm font-black uppercase italic tracking-tighter text-slate-900">Saldo Cartera</p>
                                    <p className="text-[10px] font-bold text-emerald-600">{wallet?.balance?.toFixed(2)}€ disponible</p>
                                </div>
                            </div>
                            <ChevronRight className="size-5 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all" />
                        </button>

                        {/* OPCIÓN TARJETA */}
                        <button 
                            onClick={() => { setIsSelectorOpen(false); setIsPaymentModalOpen(true); }}
                            className="w-full group relative flex items-center justify-between p-5 rounded-[1.8rem] bg-slate-50 hover:bg-primary/5 border-2 border-transparent hover:border-primary/20 transition-all text-left"
                        >
                            <div className="flex items-center gap-4">
                                <div className="size-12 rounded-2xl bg-white shadow-sm flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <CreditCard className="size-6 text-slate-900" />
                                </div>
                                <div>
                                    <p className="text-sm font-black uppercase italic tracking-tighter text-slate-900">Tarjeta / Apple Pay</p>
                                    <p className="text-[10px] font-bold text-slate-400">Pasarela Stripe segura</p>
                                </div>
                            </div>
                            <ChevronRight className="size-5 text-slate-300 group-hover:text-primary group-hover:translate-x-1 transition-all" />
                        </button>
                    </div>
                </DialogContent>
            </Dialog>

            <BookingPaymentModal 
                isOpen={isPaymentModalOpen} 
                onClose={() => setIsPaymentModalOpen(false)} 
                ride={ride} 
                onSuccess={() => { fetchRideDetails(); refreshWallet(); }} 
            />
        </div>
    );
}

export default RideDetails;
