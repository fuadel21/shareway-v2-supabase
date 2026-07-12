import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase.js';
import { confirmTripAndPay } from '../lib/supabaseRPC.js';
import { useWallet } from '../hooks/useWallet.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog.jsx';
import { Button } from './ui/button.jsx';
import {
    Loader2, Lock, CreditCard, ShieldCheck,
    AlertCircle, Wallet, CheckCircle2, ChevronRight,
    MapPin, TrendingUp, Navigation
} from 'lucide-react';
import { cn, calculateDistance } from '../lib/utils.js';
import { RIDE_RULES, fetchRoute } from '../services/rideService.js';
import MapComponent from './MapComponent';
import { useTranslation } from 'react-i18next';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

const copyByLanguage = {
    es: {
        bookingConfirmed: '¡Reserva confirmada!',
        bookingConfirmedDesc: 'Tu plaza y tu pago han sido asegurados correctamente.',
        slowInternet: 'El banco ha confirmado el pago, pero internet va lento. Recarga la app en unos minutos.',
        unexpectedError: 'Error inesperado.',
        loadingGateway: 'Cargando pasarela...',
        cancel: 'Cancelar',
        processing: 'Procesando...',
        confirmPayment: 'Confirmar Pago',
        validatingPayment: 'Validando pago en red...',
        doNotClose: 'Esto puede tardar unos segundos. Por favor, no cierres esta ventana.',
        stripeUnavailable: 'Stripe no disponible',
        stripeError: 'Error Stripe',
        invalidPrice: 'Precio no válido',
        connectionError: 'Error de conexión con el servidor.',
        walletConfirmedDesc: 'Se ha descontado el importe de tu saldo ShareWay.',
        bookingDenied: 'Reserva denegada',
        bookingProcessError: 'No se pudo procesar la reserva.',
        criticalError: 'Error crítico',
        title: 'Finalizar Reserva',
        subtitle: 'Selecciona tu método de pago seguro',
        pickupQuestion: '¿Dónde te recogemos?',
        origin: 'Origen',
        pickupAt: 'Recogida en:',
        dropoffQuestion: '¿A dónde vas?',
        destination: 'Destino',
        destinationAt: 'Destino en:',
        seatsQuestion: '¿Cuántas plazas?',
        seat: 'Plaza',
        seats: 'Plazas',
        securePayment: 'Pago Seguro',
        yourTrip: 'Tu Trayecto',
        detourDetected: 'Desvío detectado',
        supplement: 'Supl.',
        noDetour: 'Sin desvío',
        wallet: 'Billetera',
        card: 'Tarjeta',
        availableBalance: 'Saldo Disponible',
        confirmWithBalance: 'Confirmar con Saldo',
        insufficientWallet: 'No tienes saldo suficiente en tu billetera.',
        useCreditCard: 'Usar Tarjeta de Crédito',
        linkingStripe: 'Enlazando con Stripe...',
        recalculatingPayment: 'Actualizando pago seguro...',
        lockedAmount: 'Importe protegido',
        lockedAmountDesc: 'Si cambias plazas, origen o destino, se recalcula el pago antes de confirmar.',
        completeTripFirst: 'Selecciona recogida, destino y plazas para preparar el pago.'
    },
    en: {
        bookingConfirmed: 'Booking confirmed!',
        bookingConfirmedDesc: 'Your seat and payment have been secured correctly.',
        slowInternet: 'The bank confirmed the payment, but the connection is slow. Reload the app in a few minutes.',
        unexpectedError: 'Unexpected error.',
        loadingGateway: 'Loading payment gateway...',
        cancel: 'Cancel',
        processing: 'Processing...',
        confirmPayment: 'Confirm Payment',
        validatingPayment: 'Validating payment online...',
        doNotClose: 'This may take a few seconds. Please do not close this window.',
        stripeUnavailable: 'Stripe unavailable',
        stripeError: 'Stripe error',
        invalidPrice: 'Invalid price',
        connectionError: 'Server connection error.',
        walletConfirmedDesc: 'The amount has been deducted from your ShareWay balance.',
        bookingDenied: 'Booking denied',
        bookingProcessError: 'Could not process the booking.',
        criticalError: 'Critical error',
        title: 'Complete Booking',
        subtitle: 'Select your secure payment method',
        pickupQuestion: 'Where should we pick you up?',
        origin: 'Origin',
        pickupAt: 'Pickup at:',
        dropoffQuestion: 'Where are you going?',
        destination: 'Destination',
        destinationAt: 'Destination at:',
        seatsQuestion: 'How many seats?',
        seat: 'Seat',
        seats: 'Seats',
        securePayment: 'Secure Payment',
        yourTrip: 'Your Trip',
        detourDetected: 'Detour detected',
        supplement: 'Suppl.',
        noDetour: 'No detour',
        wallet: 'Wallet',
        card: 'Card',
        availableBalance: 'Available Balance',
        confirmWithBalance: 'Confirm with Balance',
        insufficientWallet: 'You do not have enough balance in your wallet.',
        useCreditCard: 'Use Credit Card',
        linkingStripe: 'Connecting to Stripe...',
        recalculatingPayment: 'Updating secure payment...',
        lockedAmount: 'Protected amount',
        lockedAmountDesc: 'If you change seats, pickup or destination, payment is recalculated before confirmation.',
        completeTripFirst: 'Select pickup, destination and seats to prepare payment.'
    },
    ar: {
        bookingConfirmed: 'تم تأكيد الحجز!',
        bookingConfirmedDesc: 'تم تأمين مقعدك ودفعك بنجاح.',
        slowInternet: 'أكد البنك الدفع، لكن الاتصال بطيء. أعد تحميل التطبيق بعد بضع دقائق.',
        unexpectedError: 'حدث خطأ غير متوقع.',
        loadingGateway: 'جارٍ تحميل بوابة الدفع...',
        cancel: 'إلغاء',
        processing: 'جارٍ المعالجة...',
        confirmPayment: 'تأكيد الدفع',
        validatingPayment: 'جارٍ التحقق من الدفع عبر الشبكة...',
        doNotClose: 'قد يستغرق هذا بضع ثوانٍ. من فضلك لا تغلق هذه النافذة.',
        stripeUnavailable: 'Stripe غير متاح',
        stripeError: 'خطأ في Stripe',
        invalidPrice: 'السعر غير صالح',
        connectionError: 'خطأ في الاتصال بالخادم.',
        walletConfirmedDesc: 'تم خصم المبلغ من رصيدك في ShareWay.',
        bookingDenied: 'تم رفض الحجز',
        bookingProcessError: 'تعذر معالجة الحجز.',
        criticalError: 'خطأ حرج',
        title: 'إتمام الحجز',
        subtitle: 'اختر طريقة الدفع الآمنة',
        pickupQuestion: 'أين نلتقي بك؟',
        origin: 'نقطة الانطلاق',
        pickupAt: 'الاستلام في:',
        dropoffQuestion: 'إلى أين تذهب؟',
        destination: 'الوجهة',
        destinationAt: 'الوجهة في:',
        seatsQuestion: 'كم عدد المقاعد؟',
        seat: 'مقعد',
        seats: 'مقاعد',
        securePayment: 'دفع آمن',
        yourTrip: 'رحلتك',
        detourDetected: 'تم اكتشاف انحراف',
        supplement: 'إضافة',
        noDetour: 'لا يوجد انحراف',
        wallet: 'المحفظة',
        card: 'بطاقة',
        availableBalance: 'الرصيد المتاح',
        confirmWithBalance: 'تأكيد بالرصيد',
        insufficientWallet: 'ليس لديك رصيد كافٍ في محفظتك.',
        useCreditCard: 'استخدام بطاقة ائتمان',
        linkingStripe: 'جارٍ الاتصال بـ Stripe...',
        recalculatingPayment: 'جارٍ تحديث الدفع الآمن...',
        lockedAmount: 'المبلغ محمي',
        lockedAmountDesc: 'إذا غيرت المقاعد أو نقطة الانطلاق أو الوجهة، سيتم تحديث الدفع قبل التأكيد.',
        completeTripFirst: 'اختر نقطة الانطلاق والوجهة والمقاعد لتحضير الدفع.'
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const getLat = (loc) => Number(loc?.lat ?? loc?.latitude ?? loc?.coordinates?.lat ?? loc?.coordinates?.latitude);
const getLng = (loc) => Number(loc?.lng ?? loc?.longitude ?? loc?.coordinates?.lng ?? loc?.coordinates?.longitude);
const isValidLocation = (loc) => Number.isFinite(getLat(loc)) && Number.isFinite(getLng(loc));
const normalizeMapLocation = (loc) => {
    if (!loc) return null;
    const lat = getLat(loc);
    const lng = getLng(loc);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { ...loc, lat, lng };
};
const locationSignature = (loc) => {
    const normalized = normalizeMapLocation(loc);
    if (!normalized) return 'none';
    return `${normalized.lat.toFixed(5)},${normalized.lng.toFixed(5)}`;
};
const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

const CheckoutForm = ({ rideId, amount, onSuccess, onClose, copy }) => {
    const stripe = useStripe();
    const elements = useElements();
    const { user } = useOutletContext();
    const [isLoading, setIsLoading] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);
    const [isProcessingServer, setIsProcessingServer] = useState(false);

    const handlePostPayment = async () => {
        setIsProcessingServer(true);
        setErrorMessage(null);
        let attempts = 0;
        const maxAttempts = 15;

        const checkBooking = async () => {
            try {
                const { data: ride } = await supabase.from('rides')
                    .select('participant_ids')
                    .eq('id', rideId)
                    .single();

                if (ride?.participant_ids?.includes(user?.id)) {
                    toast.success(copy.bookingConfirmed, {
                        description: copy.bookingConfirmedDesc
                    });
                    if (onSuccess) await onSuccess();
                    return;
                }
            } catch (e) {
                console.warn('Polling error:', e);
            }

            attempts++;
            if (attempts >= maxAttempts) {
                setErrorMessage(copy.slowInternet);
                setIsProcessingServer(false);
            } else {
                setTimeout(checkBooking, 2000);
            }
        };

        checkBooking();
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!stripe || !elements || !user || isLoading || !isReady || roundMoney(amount) <= 0) return;

        setIsLoading(true);
        setErrorMessage(null);

        try {
            const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
                elements,
                confirmParams: { return_url: window.location.href },
                redirect: 'if_required',
            });

            if (confirmError) {
                setErrorMessage(confirmError.message);
            } else if (paymentIntent.status === 'succeeded') {
                await handlePostPayment();
            }
        } catch (err) {
            setErrorMessage(err.message || copy.unexpectedError);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in zoom-in duration-300 relative">
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-left">
                <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">{copy.lockedAmount}</p>
                        <p className="mt-1 text-[11px] font-bold leading-relaxed text-emerald-700/80">{copy.lockedAmountDesc}</p>
                    </div>
                </div>
            </div>

            <div className="p-4 bg-white rounded-3xl border border-slate-100 shadow-inner min-h-[200px] flex flex-col justify-center">
                {!isReady && (
                    <div className="flex flex-col items-center gap-2 text-slate-400 py-10">
                        <Loader2 className="animate-spin" />
                        <span className="text-[10px] font-black uppercase tracking-widest">{copy.loadingGateway}</span>
                    </div>
                )}
                <PaymentElement
                    options={{ layout: 'accordion' }}
                    onReady={() => setIsReady(true)}
                />
            </div>

            {errorMessage && (
                <div className="text-red-600 text-xs font-bold bg-red-50 p-4 rounded-2xl border border-red-100 flex items-start gap-2 text-left">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                </div>
            )}

            <div className="flex gap-3">
                <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading || isProcessingServer} className="flex-1 h-14 rounded-2xl font-bold text-slate-400">{copy.cancel}</Button>
                <Button type="submit" disabled={!stripe || isLoading || isProcessingServer || !isReady || roundMoney(amount) <= 0} className="flex-[2] h-14 rounded-2xl bg-slate-900 text-white font-black uppercase italic tracking-widest shadow-xl">
                    {(isLoading || isProcessingServer) ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                        <span className="flex items-center gap-2">
                            <Lock className="h-4 w-4" /> {isProcessingServer ? copy.processing : copy.confirmPayment}
                        </span>
                    )}
                </Button>
            </div>

            {isProcessingServer && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-3xl animate-in zoom-in">
                    <Loader2 className="h-12 w-12 animate-spin text-slate-900 mb-4" />
                    <p className="text-sm font-black uppercase tracking-widest text-slate-900">{copy.validatingPayment}</p>
                    <p className="text-xs text-slate-500 mt-2 text-center px-4">{copy.doNotClose}</p>
                </div>
            )}
        </form>
    );
};

const BookingPaymentModal = ({ isOpen, onClose, ride, onSuccess, initialPickupLocation }) => {
    const { user, userLocation } = useOutletContext();
    const { i18n } = useTranslation();
    const copy = copyByLanguage[getLanguage(i18n.language)];
    const { wallet, refreshWallet } = useWallet(user);
    const [paymentMethod, setPaymentMethod] = useState('wallet');
    const [clientSecret, setClientSecret] = useState(null);
    const [paymentSignature, setPaymentSignature] = useState(null);
    const [isPreparing, setIsPreparing] = useState(false);
    const [isProcessingWallet, setIsProcessingWallet] = useState(false);

    const rideId = ride?.id;
    const baseAmount = Number(ride?.price) || 0;

    const [pickupLocation, setPickupLocation] = useState(initialPickupLocation || null);
    const [pickupAddress, setPickupAddress] = useState('');
    const [dropoffLocation, setDropoffLocation] = useState(null);
    const [dropoffAddress, setDropoffAddress] = useState('');
    const [numSeats, setNumSeats] = useState(1);
    const [dynamicAmount, setDynamicAmount] = useState(baseAmount);
    const [tripDistance, setTripDistance] = useState(0);
    const [appliedSupplement, setAppliedSupplement] = useState(0);
    const [isCalculatingDistance, setIsCalculatingDistance] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (!pickupLocation) {
                if (userLocation) setPickupLocation(normalizeMapLocation(userLocation));
                else if (initialPickupLocation) setPickupLocation(normalizeMapLocation(initialPickupLocation));
                else if (ride?.origin) setPickupLocation(normalizeMapLocation(ride.origin));
            }
            if (!dropoffLocation && ride?.destination) {
                setDropoffLocation(normalizeMapLocation(ride.destination));
            }
        } else {
            setClientSecret(null);
            setPaymentSignature(null);
            setIsPreparing(false);
        }
    }, [isOpen, userLocation, initialPickupLocation, ride?.origin, ride?.destination, pickupLocation, dropoffLocation]);

    useEffect(() => {
        const updatePrice = async () => {
            if (!pickupLocation || !dropoffLocation || !ride) return;

            const pickup = normalizeMapLocation(pickupLocation);
            const dropoff = normalizeMapLocation(dropoffLocation);
            const rideOrigin = normalizeMapLocation(ride.origin);

            if (!pickup || !dropoff) return;

            setIsCalculatingDistance(true);
            try {
                const coords = `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;
                const data = await fetchRoute(coords, 'false');

                let distanceKm;
                if (data.code === 'Ok' && data.routes[0]) {
                    distanceKm = data.routes[0].distance / 1000;
                } else {
                    distanceKm = calculateDistance(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
                }

                setTripDistance(distanceKm);

                const rideTotalDistance = Number(ride.distance) || distanceKm;
                const driverPricePerKm = Number(ride.price) / Math.max(rideTotalDistance, 1);
                const passengerBasePrice = driverPricePerKm * distanceKm;

                const detourDistance = rideOrigin
                    ? calculateDistance(rideOrigin.lat, rideOrigin.lng, pickup.lat, pickup.lng)
                    : 0;

                const detourThreshold = 3.0;
                const supplement = detourDistance > detourThreshold ? RIDE_RULES.PICKUP_SUPPLEMENT : 0;
                setAppliedSupplement(supplement);

                const finalPricePerSeat = passengerBasePrice + supplement;
                const totalAmount = finalPricePerSeat * numSeats;
                setDynamicAmount(roundMoney(totalAmount));
            } catch (error) {
                console.error('Error updating price:', error);
            } finally {
                setIsCalculatingDistance(false);
            }
        };

        updatePrice();
    }, [pickupLocation, dropoffLocation, ride, numSeats]);

    const hasBalance = wallet?.balance >= dynamicAmount;
    const displayAmount = dynamicAmount;

    const bookingSignature = useMemo(() => JSON.stringify({
        rideId,
        amount: roundMoney(dynamicAmount).toFixed(2),
        seats: Number(numSeats),
        pickup: locationSignature(pickupLocation),
        dropoff: locationSignature(dropoffLocation),
    }), [rideId, dynamicAmount, numSeats, pickupLocation, dropoffLocation]);

    const isPaymentContextReady = Boolean(
        rideId &&
        user &&
        isValidLocation(pickupLocation) &&
        isValidLocation(dropoffLocation) &&
        Number(numSeats) > 0 &&
        roundMoney(dynamicAmount) > 0 &&
        !isCalculatingDistance
    );

    useEffect(() => {
        if (isOpen && wallet) {
            setPaymentMethod(wallet.balance >= dynamicAmount ? 'wallet' : 'card');
        }
    }, [isOpen, wallet, dynamicAmount]);

    useEffect(() => {
        if (!isOpen || !clientSecret || !paymentSignature) return;
        if (paymentSignature !== bookingSignature) {
            setClientSecret(null);
            setPaymentSignature(null);
        }
    }, [bookingSignature, clientSecret, isOpen, paymentSignature]);

    const handleLocationSelect = (loc) => {
        setPickupLocation(normalizeMapLocation(loc));
        setPickupAddress(loc?.address || '');
    };

    const handleDropoffSelect = (loc) => {
        setDropoffLocation(normalizeMapLocation(loc));
        setDropoffAddress(loc?.address || '');
    };

    useEffect(() => {
        const prepareStripe = async () => {
            if (!isOpen || paymentMethod !== 'card' || clientSecret || !isPaymentContextReady) return;

            setIsPreparing(true);
            try {
                const cleanTotal = roundMoney(dynamicAmount);
                const { data, error } = await supabase.functions.invoke('create-booking-payment-intent', {
                    body: {
                        rideId,
                        pickupLocation: normalizeMapLocation(pickupLocation),
                        pickupAddress,
                        dropoffLocation: normalizeMapLocation(dropoffLocation),
                        dropoffAddress,
                        totalAmount: cleanTotal,
                        pricePerSeat: roundMoney(cleanTotal / Math.max(Number(numSeats), 1)),
                        numSeats: Number(numSeats),
                        bookingSignature,
                    },
                });
                if (error || !data?.clientSecret) throw new Error(data?.error?.message || copy.stripeUnavailable);
                setClientSecret(data.clientSecret);
                setPaymentSignature(bookingSignature);
            } catch (e) {
                toast.error(copy.stripeError, { description: e.message });
                setPaymentMethod('wallet');
                setClientSecret(null);
                setPaymentSignature(null);
            } finally {
                setIsPreparing(false);
            }
        };

        prepareStripe();
    }, [
        isOpen,
        paymentMethod,
        clientSecret,
        isPaymentContextReady,
        rideId,
        pickupLocation,
        pickupAddress,
        dropoffLocation,
        dropoffAddress,
        dynamicAmount,
        numSeats,
        bookingSignature,
        copy.stripeUnavailable,
        copy.stripeError,
    ]);

    const handleWalletPayment = async () => {
        setIsProcessingWallet(true);
        try {
            const numericPrice = Number(dynamicAmount);
            if (isNaN(numericPrice) || numericPrice <= 0) throw new Error(copy.invalidPrice);
            if (!isPaymentContextReady) throw new Error(copy.completeTripFirst);

            const cleanPrice = roundMoney(numericPrice);

            const { success, error, data } = await confirmTripAndPay(rideId, null, {
                pickupLocation: normalizeMapLocation(pickupLocation) ?? null,
                pickupAddress: pickupAddress ?? null,
                dropoffLocation: normalizeMapLocation(dropoffLocation) ?? null,
                dropoffAddress: dropoffAddress ?? null,
                price: roundMoney(cleanPrice / Math.max(Number(numSeats), 1)),
                numSeats: Number(numSeats)
            });

            if (!success) {
                throw new Error(error || copy.connectionError);
            }

            const result = data?.success !== undefined ? data : (data?.[0] || data);

            if (result?.success) {
                toast.success(copy.bookingConfirmed, {
                    description: copy.walletConfirmedDesc
                });
                refreshWallet();

                setTimeout(() => {
                    if (onSuccess) onSuccess();
                    onClose();
                }, 1500);
            } else {
                const msg = result?.message || result?.error || copy.bookingProcessError;
                toast.error(copy.bookingDenied, {
                    description: msg,
                    duration: 5000
                });
            }
        } catch (e) {
            console.error('❌ Error en handleWalletPayment:', e);
            toast.error(copy.criticalError, { description: e.message });
        } finally {
            setIsProcessingWallet(false);
        }
    };

    const paymentControlsDisabled = isPreparing || isProcessingWallet;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[460px] rounded-[2.5rem] border-none shadow-2xl p-0 bg-slate-50 overflow-hidden outline-none z-[100]">
                <div className="h-full max-h-[90vh] flex flex-col">
                    <div className="p-8 pb-4">
                        <DialogHeader className="space-y-1">
                            <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter text-slate-900 flex items-center gap-3">
                                <div className="size-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
                                    <Lock className="h-5 w-5 text-white" />
                                </div>
                                {copy.title}
                            </DialogTitle>
                            <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                {copy.subtitle}
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <div className="flex-1 overflow-y-auto px-8 pb-32 no-scrollbar">
                        <div className="space-y-6 text-left">
                            <div className="space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                    <span className="size-5 rounded-full bg-slate-200 text-slate-900 flex items-center justify-center text-[8px]">1</span>
                                    {copy.pickupQuestion}
                                </p>
                                <div className="h-40 rounded-3xl overflow-hidden border-2 border-slate-100 shadow-inner relative group">
                                    <MapComponent
                                        center={pickupLocation}
                                        zoom={15}
                                        onLocationSelect={handleLocationSelect}
                                        showSearch={false}
                                        height="100%"
                                    />
                                    <div className="absolute top-2 right-2 bg-white/90 backdrop-blur px-3 py-1.5 rounded-xl border border-slate-100 flex items-center gap-1.5 shadow-sm">
                                        <MapPin className="size-3 text-primary animate-pulse" />
                                        <span className="text-[9px] font-black uppercase text-slate-900 tracking-tighter">{copy.origin}</span>
                                    </div>
                                </div>
                                {pickupAddress && (
                                    <p className="text-[9px] font-bold text-slate-500 italic px-2">
                                        {copy.pickupAt} {pickupAddress}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                    <span className="size-5 rounded-full bg-slate-200 text-slate-900 flex items-center justify-center text-[8px]">2</span>
                                    {copy.dropoffQuestion}
                                </p>
                                <div className="h-40 rounded-3xl overflow-hidden border-2 border-slate-100 shadow-inner relative group">
                                    <MapComponent
                                        center={dropoffLocation || ride?.destination}
                                        zoom={15}
                                        onLocationSelect={handleDropoffSelect}
                                        showSearch={false}
                                        height="100%"
                                    />
                                    <div className="absolute top-2 right-2 bg-white/90 backdrop-blur px-3 py-1.5 rounded-xl border border-slate-100 flex items-center gap-1.5 shadow-sm">
                                        <Navigation className="size-3 text-emerald-500 animate-pulse" />
                                        <span className="text-[9px] font-black uppercase text-slate-900 tracking-tighter">{copy.destination}</span>
                                    </div>
                                </div>
                                {dropoffAddress && (
                                    <p className="text-[9px] font-bold text-slate-500 italic px-2">
                                        {copy.destinationAt} {dropoffAddress}
                                    </p>
                                )}
                            </div>

                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <span className="size-5 rounded-full bg-slate-200 text-slate-900 flex items-center justify-center text-[8px]">3</span>
                                {copy.seatsQuestion}
                            </p>
                            <div className="flex bg-white p-1.5 rounded-3xl border-2 border-slate-100 gap-1 shadow-sm">
                                {[1, 2, 3, 4].map(n => {
                                    const isAvailable = n <= (ride?.seats_available || 0);
                                    return (
                                        <button key={n}
                                            type="button"
                                            disabled={!isAvailable || paymentControlsDisabled}
                                            onClick={() => setNumSeats(n)}
                                            className={cn(
                                                'flex-1 h-12 rounded-2xl text-xs font-black transition-all touch-action-manipulation active:scale-95 flex flex-col items-center justify-center leading-none',
                                                numSeats === n ? 'bg-slate-900 text-white shadow-lg' : isAvailable ? 'text-slate-400 hover:bg-slate-50' : 'text-slate-200 cursor-not-allowed opacity-30'
                                            )}>
                                            <span>{n}</span>
                                            <span className="text-[8px] opacity-60 uppercase font-black">{n === 1 ? copy.seat : copy.seats}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <span className="size-5 rounded-full bg-slate-200 text-slate-900 flex items-center justify-center text-[8px]">4</span>
                                {copy.securePayment}
                            </p>

                            <div className="bg-slate-900 rounded-3xl p-6 text-white relative overflow-hidden group shadow-xl">
                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                                    <ShieldCheck size={80} />
                                </div>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-1">{copy.yourTrip} ({tripDistance.toFixed(1)} km)</p>
                                        <p className="text-4xl font-black italic tracking-tighter">
                                            {isCalculatingDistance ? (
                                                <Loader2 className="h-8 w-8 animate-spin inline" />
                                            ) : (
                                                <>{displayAmount.toFixed(2)}<span className="text-xl ml-1">€</span></>
                                            )}
                                        </p>
                                    </div>

                                    <div className="text-right">
                                        <div className="flex flex-col gap-1">
                                            {appliedSupplement > 0 ? (
                                                <>
                                                    <div className="flex items-center justify-end gap-1 text-emerald-400 text-[10px] font-black uppercase tracking-tighter">
                                                        <TrendingUp size={10} /> {copy.detourDetected}
                                                    </div>
                                                    <div className="px-2 py-1 bg-white/10 rounded-lg text-[8px] font-bold text-slate-300 uppercase tracking-tighter">
                                                        + {appliedSupplement.toFixed(2)}€ {copy.supplement}
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="flex items-center justify-end gap-1 text-slate-400 text-[10px] font-black uppercase tracking-tighter opacity-50">
                                                    <CheckCircle2 size={10} /> {copy.noDetour}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    disabled={paymentControlsDisabled}
                                    onClick={() => setPaymentMethod('wallet')}
                                    className={cn(
                                        'flex flex-col items-center justify-center gap-2 p-4 rounded-3xl border-2 transition-all disabled:opacity-60',
                                        paymentMethod === 'wallet'
                                            ? 'bg-white border-primary shadow-lg ring-1 ring-primary/20'
                                            : 'bg-slate-100/50 border-transparent text-slate-400 hover:bg-white'
                                    )}
                                >
                                    <Wallet size={20} className={paymentMethod === 'wallet' ? 'text-primary' : ''} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">{copy.wallet}</span>
                                </button>
                                <button
                                    type="button"
                                    disabled={paymentControlsDisabled || !isPaymentContextReady}
                                    onClick={() => setPaymentMethod('card')}
                                    className={cn(
                                        'flex flex-col items-center justify-center gap-2 p-4 rounded-3xl border-2 transition-all disabled:opacity-60',
                                        paymentMethod === 'card'
                                            ? 'bg-white border-primary shadow-lg ring-1 ring-primary/20'
                                            : 'bg-slate-100/50 border-transparent text-slate-400 hover:bg-white'
                                    )}
                                >
                                    <CreditCard size={20} className={paymentMethod === 'card' ? 'text-primary' : ''} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">{copy.card}</span>
                                </button>
                            </div>

                            {!isPaymentContextReady && (
                                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-center text-[10px] font-black uppercase tracking-widest text-amber-700">
                                    {copy.completeTripFirst}
                                </div>
                            )}

                            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                                {paymentMethod === 'wallet' ? (
                                    <div className="space-y-4">
                                        <div className={cn(
                                            'p-5 rounded-3xl border-2 flex items-center justify-between',
                                            hasBalance ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'
                                        )}>
                                            <div className="text-left">
                                                <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{copy.availableBalance}</p>
                                                <p className={cn('text-xl font-black', hasBalance ? 'text-emerald-700' : 'text-red-700')}>
                                                    {wallet?.balance?.toFixed(2) || '0.00'}€
                                                </p>
                                            </div>
                                            {hasBalance ? <CheckCircle2 className="text-emerald-500" /> : <AlertCircle className="text-red-500" />}
                                        </div>

                                        {hasBalance ? (
                                            <Button
                                                onClick={handleWalletPayment}
                                                disabled={isProcessingWallet || isCalculatingDistance || !isPaymentContextReady}
                                                className="w-full h-16 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase italic tracking-widest shadow-xl shadow-emerald-200"
                                            >
                                                {isProcessingWallet ? <Loader2 className="animate-spin" /> : <>{copy.confirmWithBalance} <ChevronRight className="ml-2" size={18} /></>}
                                            </Button>
                                        ) : (
                                            <div className="space-y-3">
                                                <p className="text-[10px] text-red-600 font-bold text-center italic">{copy.insufficientWallet}</p>
                                                <Button
                                                    onClick={() => setPaymentMethod('card')}
                                                    disabled={!isPaymentContextReady}
                                                    variant="outline"
                                                    className="w-full h-14 rounded-2xl border-slate-200 text-slate-600 font-black uppercase tracking-widest"
                                                >
                                                    {copy.useCreditCard}
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {isPreparing ? (
                                            <div className="flex flex-col items-center justify-center py-10 gap-3">
                                                <Loader2 className="animate-spin text-primary opacity-20" size={30} />
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{copy.recalculatingPayment}</p>
                                            </div>
                                        ) : clientSecret ? (
                                            <Elements key={paymentSignature || clientSecret} stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'flat' } }}>
                                                <CheckoutForm
                                                    rideId={rideId}
                                                    amount={dynamicAmount}
                                                    onSuccess={onSuccess}
                                                    onClose={onClose}
                                                    copy={copy}
                                                />
                                            </Elements>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center py-10 gap-3">
                                                <Loader2 className="animate-spin text-primary opacity-20" size={30} />
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{copy.linkingStripe}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default BookingPaymentModal;
