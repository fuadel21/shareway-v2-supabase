import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase.js';
import { confirmTripAndPay } from '../lib/supabaseRPC.js';
import { useWallet } from '../hooks/useWallet.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.jsx';
import { Button } from './ui/button.jsx';
import {
    AlertCircle,
    CheckCircle2,
    ChevronRight,
    CreditCard,
    Loader2,
    Lock,
    MapPin,
    Navigation,
    RefreshCw,
    ShieldCheck,
    TrendingUp,
    Wallet,
} from 'lucide-react';
import { cn, calculateDistance } from '../lib/utils.js';
import { RIDE_RULES, fetchRoute } from '../services/rideService.js';
import MapComponent from './MapComponent';
import { useTranslation } from 'react-i18next';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
const PENDING_BOOKING_KEY = 'sw_pending_booking_recovery';
const PENDING_TTL_MS = 30 * 60 * 1000;

const copyByLanguage = {
    es: {
        bookingConfirmed: '¡Reserva confirmada!',
        bookingConfirmedDesc: 'Tu plaza y tu pago han sido asegurados correctamente.',
        walletConfirmedDesc: 'Se ha descontado el importe de tu saldo ShareWay.',
        slowInternet: 'El banco ha confirmado el pago, pero la app aún no ve la plaza. Puedes comprobarlo otra vez o abrir el viaje.',
        unexpectedError: 'Error inesperado.',
        loadingGateway: 'Cargando pasarela...',
        cancel: 'Cancelar',
        processing: 'Procesando...',
        confirmPayment: 'Confirmar pago',
        validatingPayment: 'Validando pago en red...',
        doNotClose: 'No cierres la app. Estamos esperando la confirmación segura del servidor.',
        stripeUnavailable: 'Stripe no disponible',
        stripeError: 'Error Stripe',
        invalidPrice: 'Precio no válido',
        connectionError: 'Error de conexión con el servidor.',
        bookingDenied: 'Reserva no disponible',
        bookingProcessError: 'No se pudo procesar la reserva.',
        title: 'Finalizar reserva',
        subtitle: 'Pago seguro y recuperable',
        pickupQuestion: '¿Dónde te recogemos?',
        origin: 'Origen',
        pickupAt: 'Recogida en:',
        dropoffQuestion: '¿A dónde vas?',
        destination: 'Destino',
        destinationAt: 'Destino en:',
        seatsQuestion: '¿Cuántas plazas?',
        seat: 'Plaza',
        seats: 'Plazas',
        securePayment: 'Pago seguro',
        yourTrip: 'Tu trayecto',
        detourDetected: 'Desvío detectado',
        supplement: 'Supl.',
        noDetour: 'Sin desvío',
        wallet: 'Billetera',
        card: 'Tarjeta',
        availableBalance: 'Saldo disponible',
        confirmWithBalance: 'Confirmar con saldo',
        insufficientWallet: 'No tienes saldo suficiente en tu billetera.',
        useCreditCard: 'Usar tarjeta',
        linkingStripe: 'Enlazando con Stripe...',
        recalculatingPayment: 'Actualizando pago seguro...',
        lockedAmount: 'Importe protegido',
        lockedAmountDesc: 'Si cambias plazas, recogida o destino, recalculamos el pago antes de confirmar.',
        completeTripFirst: 'Selecciona recogida, destino y plazas para preparar el pago.',
        reservationBlockedTitle: 'Viaje no reservable',
        bookingUnavailable: 'Este viaje ya no está disponible para reservar.',
        tripAlreadyDeparted: 'Este viaje ya ha salido o ha expirado.',
        noSeatsLeft: 'No quedan plazas disponibles en este viaje.',
        refreshAndClose: 'Cerrar y actualizar',
        pendingTitle: 'Pago en comprobación',
        pendingDesc: 'Hemos guardado este intento para que puedas recuperarlo aunque cierres la pantalla o vaya lento internet.',
        checkAgain: 'Comprobar otra vez',
        viewRide: 'Ver viaje',
        pendingRecovered: 'Reserva recuperada',
        pendingRecoveredDesc: 'La plaza ya aparece confirmada en el viaje.',
        pendingStillWaiting: 'Aún no aparece confirmada',
        pendingStillWaitingDesc: 'Espera unos segundos y vuelve a comprobar. No hagas otro pago mientras tanto.',
        clearPending: 'Quitar aviso',
    },
    en: {
        bookingConfirmed: 'Booking confirmed!',
        bookingConfirmedDesc: 'Your seat and payment have been secured correctly.',
        walletConfirmedDesc: 'The amount has been deducted from your ShareWay wallet.',
        slowInternet: 'The bank confirmed the payment, but the app cannot see the seat yet. You can check again or open the ride.',
        unexpectedError: 'Unexpected error.',
        loadingGateway: 'Loading payment gateway...',
        cancel: 'Cancel',
        processing: 'Processing...',
        confirmPayment: 'Confirm payment',
        validatingPayment: 'Validating payment online...',
        doNotClose: 'Do not close the app. We are waiting for the secure server confirmation.',
        stripeUnavailable: 'Stripe unavailable',
        stripeError: 'Stripe error',
        invalidPrice: 'Invalid price',
        connectionError: 'Server connection error.',
        bookingDenied: 'Booking unavailable',
        bookingProcessError: 'Could not process the booking.',
        title: 'Complete booking',
        subtitle: 'Secure recoverable payment',
        pickupQuestion: 'Where should we pick you up?',
        origin: 'Origin',
        pickupAt: 'Pickup at:',
        dropoffQuestion: 'Where are you going?',
        destination: 'Destination',
        destinationAt: 'Destination at:',
        seatsQuestion: 'How many seats?',
        seat: 'Seat',
        seats: 'Seats',
        securePayment: 'Secure payment',
        yourTrip: 'Your trip',
        detourDetected: 'Detour detected',
        supplement: 'Suppl.',
        noDetour: 'No detour',
        wallet: 'Wallet',
        card: 'Card',
        availableBalance: 'Available balance',
        confirmWithBalance: 'Confirm with balance',
        insufficientWallet: 'You do not have enough wallet balance.',
        useCreditCard: 'Use card',
        linkingStripe: 'Connecting to Stripe...',
        recalculatingPayment: 'Updating secure payment...',
        lockedAmount: 'Protected amount',
        lockedAmountDesc: 'If you change seats, pickup or destination, payment is recalculated before confirmation.',
        completeTripFirst: 'Select pickup, destination and seats to prepare payment.',
        reservationBlockedTitle: 'Ride not bookable',
        bookingUnavailable: 'This ride is no longer available for booking.',
        tripAlreadyDeparted: 'This ride has already departed or expired.',
        noSeatsLeft: 'There are no seats left on this ride.',
        refreshAndClose: 'Close and refresh',
        pendingTitle: 'Payment being checked',
        pendingDesc: 'We saved this attempt so you can recover it even if you close the screen or the connection is slow.',
        checkAgain: 'Check again',
        viewRide: 'View ride',
        pendingRecovered: 'Booking recovered',
        pendingRecoveredDesc: 'Your seat already appears confirmed on the ride.',
        pendingStillWaiting: 'Not confirmed yet',
        pendingStillWaitingDesc: 'Wait a few seconds and check again. Do not make another payment meanwhile.',
        clearPending: 'Dismiss notice',
    },
    ar: {
        bookingConfirmed: 'تم تأكيد الحجز!',
        bookingConfirmedDesc: 'تم تأمين مقعدك ودفعك بنجاح.',
        walletConfirmedDesc: 'تم خصم المبلغ من محفظة ShareWay.',
        slowInternet: 'أكد البنك الدفع، لكن التطبيق لم ير المقعد بعد. يمكنك التحقق مرة أخرى أو فتح الرحلة.',
        unexpectedError: 'حدث خطأ غير متوقع.',
        loadingGateway: 'جارٍ تحميل بوابة الدفع...',
        cancel: 'إلغاء',
        processing: 'جارٍ المعالجة...',
        confirmPayment: 'تأكيد الدفع',
        validatingPayment: 'جارٍ التحقق من الدفع...',
        doNotClose: 'لا تغلق التطبيق. ننتظر تأكيد الخادم الآمن.',
        stripeUnavailable: 'Stripe غير متاح',
        stripeError: 'خطأ في Stripe',
        invalidPrice: 'السعر غير صالح',
        connectionError: 'خطأ في الاتصال بالخادم.',
        bookingDenied: 'الحجز غير متاح',
        bookingProcessError: 'تعذر معالجة الحجز.',
        title: 'إتمام الحجز',
        subtitle: 'دفع آمن قابل للاسترجاع',
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
        insufficientWallet: 'ليس لديك رصيد كافٍ في المحفظة.',
        useCreditCard: 'استخدام البطاقة',
        linkingStripe: 'جارٍ الاتصال بـ Stripe...',
        recalculatingPayment: 'جارٍ تحديث الدفع الآمن...',
        lockedAmount: 'المبلغ محمي',
        lockedAmountDesc: 'إذا غيرت المقاعد أو نقطة الانطلاق أو الوجهة، سيتم تحديث الدفع قبل التأكيد.',
        completeTripFirst: 'اختر نقطة الانطلاق والوجهة والمقاعد لتحضير الدفع.',
        reservationBlockedTitle: 'الرحلة غير قابلة للحجز',
        bookingUnavailable: 'هذه الرحلة لم تعد متاحة للحجز.',
        tripAlreadyDeparted: 'هذه الرحلة انطلقت أو انتهت صلاحيتها.',
        noSeatsLeft: 'لا توجد مقاعد متاحة في هذه الرحلة.',
        refreshAndClose: 'إغلاق وتحديث',
        pendingTitle: 'الدفع قيد التحقق',
        pendingDesc: 'حفظنا هذه المحاولة لتتمكن من استرجاعها حتى إذا أغلقت الشاشة أو كان الاتصال بطيئًا.',
        checkAgain: 'تحقق مرة أخرى',
        viewRide: 'عرض الرحلة',
        pendingRecovered: 'تم استرجاع الحجز',
        pendingRecoveredDesc: 'المقعد يظهر الآن مؤكدًا في الرحلة.',
        pendingStillWaiting: 'لم يتم التأكيد بعد',
        pendingStillWaitingDesc: 'انتظر ثواني قليلة وتحقق مرة أخرى. لا تدفع مرة أخرى الآن.',
        clearPending: 'إخفاء التنبيه',
    },
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

const pendingKeyForRide = (rideId) => `${PENDING_BOOKING_KEY}:${rideId}`;

const savePendingBooking = (payload) => {
    if (!payload?.rideId) return;
    localStorage.setItem(pendingKeyForRide(payload.rideId), JSON.stringify({
        ...payload,
        savedAt: Date.now(),
    }));
};

const readPendingBooking = (rideId) => {
    if (!rideId) return null;
    try {
        const raw = localStorage.getItem(pendingKeyForRide(rideId));
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data?.savedAt || Date.now() - data.savedAt > PENDING_TTL_MS) {
            localStorage.removeItem(pendingKeyForRide(rideId));
            return null;
        }
        return data;
    } catch {
        localStorage.removeItem(pendingKeyForRide(rideId));
        return null;
    }
};

const clearPendingBooking = (rideId) => {
    if (rideId) localStorage.removeItem(pendingKeyForRide(rideId));
};

const getBookingBlockedMessage = (ride, copy) => {
    if (!ride) return null;
    const departureDate = new Date(ride.departure_time || ride.departureTime);
    const seatsAvailable = Number(ride.seats_available ?? ride.available_seats ?? 0);

    if (ride.status && ride.status !== 'scheduled') return copy.bookingUnavailable;
    if (Number.isFinite(departureDate.getTime()) && departureDate <= new Date()) return copy.tripAlreadyDeparted;
    if (seatsAvailable <= 0) return copy.noSeatsLeft;
    return null;
};

const friendlyBookingError = (error, copy) => {
    const raw = String(error?.message || error || '').trim();
    const text = raw.toLowerCase();

    if (text.includes('no quedan plazas') || text.includes('no seats') || text.includes('seats_available')) return copy.noSeatsLeft;
    if (text.includes('ha salido') || text.includes('expirado') || text.includes('expired') || text.includes('departed')) return copy.tripAlreadyDeparted;
    if (text.includes('booking_not_allowed') || text.includes('no está disponible') || text.includes('not available')) return copy.bookingUnavailable;
    return raw || copy.bookingProcessError;
};

const isUserParticipant = (ride, userId) => {
    const participantIds = Array.isArray(ride?.participant_ids) ? ride.participant_ids : [];
    return participantIds.map(String).includes(String(userId));
};

const fetchRidePaymentState = async (rideId) => {
    const { data, error } = await supabase
        .from('rides')
        .select('id,participant_ids,status,seats_available,departure_time')
        .eq('id', rideId)
        .single();
    if (error) throw error;
    return data;
};

const PendingRecoveryNotice = ({ copy, isChecking, onCheck, onViewRide, onClear }) => (
    <div className="rounded-3xl border-2 border-amber-100 bg-amber-50 p-5 text-amber-800 shadow-sm">
        <div className="flex items-start gap-3">
            <RefreshCw className={cn('mt-0.5 size-5 shrink-0', isChecking && 'animate-spin')} />
            <div className="min-w-0 flex-1 space-y-3">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-widest">{copy.pendingTitle}</p>
                    <p className="mt-1 text-xs font-bold leading-relaxed text-amber-700/80">{copy.pendingDesc}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Button type="button" onClick={onCheck} disabled={isChecking} className="h-11 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black uppercase tracking-widest">
                        {isChecking ? <Loader2 className="size-4 animate-spin" /> : copy.checkAgain}
                    </Button>
                    <Button type="button" onClick={onViewRide} variant="outline" className="h-11 rounded-2xl bg-white border-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-widest">
                        {copy.viewRide}
                    </Button>
                </div>
                <button type="button" onClick={onClear} className="text-[9px] font-black uppercase tracking-widest text-amber-700/60 underline underline-offset-4">
                    {copy.clearPending}
                </button>
            </div>
        </div>
    </div>
);

const CheckoutForm = ({ rideId, amount, bookingSignature, onSuccess, onClose, onPending, onRecovered, onGoToRide, copy }) => {
    const stripe = useStripe();
    const elements = useElements();
    const { user } = useOutletContext();
    const [isLoading, setIsLoading] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);
    const [isProcessingServer, setIsProcessingServer] = useState(false);

    const checkBookingOnce = async ({ silent = false } = {}) => {
        const rideState = await fetchRidePaymentState(rideId);
        if (isUserParticipant(rideState, user?.id)) {
            clearPendingBooking(rideId);
            toast.success(copy.bookingConfirmed, { description: copy.bookingConfirmedDesc });
            if (onRecovered) onRecovered();
            if (onSuccess) await onSuccess();
            return true;
        }

        const blockedMessage = getBookingBlockedMessage(rideState, copy);
        if (blockedMessage && !silent) setErrorMessage(blockedMessage);
        return false;
    };

    const handlePostPayment = async () => {
        setIsProcessingServer(true);
        setErrorMessage(null);
        onPending?.();

        let attempts = 0;
        const maxAttempts = 12;

        const checkBooking = async () => {
            try {
                const recovered = await checkBookingOnce({ silent: true });
                if (recovered) return;
            } catch (e) {
                console.warn('Payment recovery polling error:', e);
            }

            attempts += 1;
            if (attempts >= maxAttempts) {
                setErrorMessage(copy.slowInternet);
                setIsProcessingServer(false);
                return;
            }
            setTimeout(checkBooking, 2500);
        };

        checkBooking();
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!stripe || !elements || !user || isLoading || !isReady || roundMoney(amount) <= 0) return;

        setIsLoading(true);
        setErrorMessage(null);
        savePendingBooking({
            rideId,
            amount: roundMoney(amount),
            bookingSignature,
            method: 'card',
            status: 'stripe_confirming',
        });
        onPending?.();

        try {
            const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
                elements,
                confirmParams: { return_url: window.location.href },
                redirect: 'if_required',
            });

            if (confirmError) {
                setErrorMessage(friendlyBookingError(confirmError, copy));
            } else if (paymentIntent?.status === 'succeeded') {
                savePendingBooking({
                    rideId,
                    amount: roundMoney(amount),
                    bookingSignature,
                    method: 'card',
                    paymentIntentId: paymentIntent.id,
                    status: 'server_confirming',
                });
                await handlePostPayment();
            } else {
                setErrorMessage(copy.slowInternet);
            }
        } catch (err) {
            setErrorMessage(friendlyBookingError(err, copy));
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
                <PaymentElement options={{ layout: 'accordion' }} onReady={() => setIsReady(true)} />
            </div>

            {errorMessage && (
                <div className="text-red-600 text-xs font-bold bg-red-50 p-4 rounded-2xl border border-red-100 flex items-start gap-2 text-left">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <div className="space-y-3">
                        <p>{errorMessage}</p>
                        {errorMessage === copy.slowInternet && (
                            <div className="flex gap-2">
                                <Button type="button" onClick={handlePostPayment} variant="outline" className="h-10 rounded-xl bg-white text-red-600 border-red-100 text-[9px] font-black uppercase tracking-widest">
                                    {copy.checkAgain}
                                </Button>
                                <Button type="button" onClick={onGoToRide} variant="outline" className="h-10 rounded-xl bg-white text-red-600 border-red-100 text-[9px] font-black uppercase tracking-widest">
                                    {copy.viewRide}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="flex gap-3">
                <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading || isProcessingServer} className="flex-1 h-14 rounded-2xl font-bold text-slate-400">
                    {copy.cancel}
                </Button>
                <Button type="submit" disabled={!stripe || isLoading || isProcessingServer || !isReady || roundMoney(amount) <= 0} className="flex-[2] h-14 rounded-2xl bg-slate-900 text-white font-black uppercase italic tracking-widest shadow-xl">
                    {(isLoading || isProcessingServer) ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                        <span className="flex items-center gap-2"><Lock className="h-4 w-4" /> {copy.confirmPayment}</span>
                    )}
                </Button>
            </div>

            {isProcessingServer && (
                <div className="absolute inset-0 bg-white/85 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-3xl animate-in zoom-in">
                    <Loader2 className="h-12 w-12 animate-spin text-slate-900 mb-4" />
                    <p className="text-sm font-black uppercase tracking-widest text-slate-900">{copy.validatingPayment}</p>
                    <p className="text-xs text-slate-500 mt-2 text-center px-4">{copy.doNotClose}</p>
                </div>
            )}
        </form>
    );
};

const BookingPaymentModal = ({ isOpen, onClose, ride, onSuccess, initialPickupLocation }) => {
    const navigate = useNavigate();
    const { user, userLocation } = useOutletContext();
    const { i18n } = useTranslation();
    const copy = copyByLanguage[getLanguage(i18n.language)];
    const { wallet, refreshWallet } = useWallet(user);

    const rideId = ride?.id;
    const baseAmount = Number(ride?.price) || 0;
    const seatsAvailable = Number(ride?.seats_available ?? ride?.available_seats ?? 0);

    const [paymentMethod, setPaymentMethod] = useState('wallet');
    const [clientSecret, setClientSecret] = useState(null);
    const [paymentSignature, setPaymentSignature] = useState(null);
    const [isPreparing, setIsPreparing] = useState(false);
    const [isProcessingWallet, setIsProcessingWallet] = useState(false);
    const [pendingRecovery, setPendingRecovery] = useState(null);
    const [isCheckingPending, setIsCheckingPending] = useState(false);

    const [pickupLocation, setPickupLocation] = useState(initialPickupLocation || null);
    const [pickupAddress, setPickupAddress] = useState('');
    const [dropoffLocation, setDropoffLocation] = useState(null);
    const [dropoffAddress, setDropoffAddress] = useState('');
    const [numSeats, setNumSeats] = useState(1);
    const [dynamicAmount, setDynamicAmount] = useState(baseAmount);
    const [tripDistance, setTripDistance] = useState(0);
    const [appliedSupplement, setAppliedSupplement] = useState(0);
    const [isCalculatingDistance, setIsCalculatingDistance] = useState(false);

    const bookingBlockedMessage = useMemo(
        () => getBookingBlockedMessage(ride, copy),
        [ride?.status, ride?.departure_time, ride?.departureTime, ride?.seats_available, ride?.available_seats, copy]
    );

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
        !bookingBlockedMessage &&
        isValidLocation(pickupLocation) &&
        isValidLocation(dropoffLocation) &&
        Number(numSeats) > 0 &&
        Number(numSeats) <= seatsAvailable &&
        roundMoney(dynamicAmount) > 0 &&
        !isCalculatingDistance
    );

    const hasBalance = Number(wallet?.balance || 0) >= roundMoney(dynamicAmount);
    const paymentControlsDisabled = isPreparing || isProcessingWallet || Boolean(bookingBlockedMessage) || Boolean(pendingRecovery?.status === 'server_confirming');

    const goToRide = () => {
        onClose?.();
        if (rideId) navigate(`/ride/${rideId}`);
    };

    const handleRecovered = async () => {
        setPendingRecovery(null);
        clearPendingBooking(rideId);
        if (onSuccess) await onSuccess();
    };

    const checkPendingBooking = async () => {
        if (!rideId || !user?.id || isCheckingPending) return;
        setIsCheckingPending(true);
        try {
            const rideState = await fetchRidePaymentState(rideId);
            if (isUserParticipant(rideState, user.id)) {
                toast.success(copy.pendingRecovered, { description: copy.pendingRecoveredDesc });
                await handleRecovered();
                return;
            }
            toast.info(copy.pendingStillWaiting, { description: copy.pendingStillWaitingDesc, duration: 5000 });
        } catch (error) {
            toast.error(copy.connectionError, { description: friendlyBookingError(error, copy) });
        } finally {
            setIsCheckingPending(false);
        }
    };

    useEffect(() => {
        if (!isOpen || !rideId) return;
        const pending = readPendingBooking(rideId);
        if (pending) setPendingRecovery(pending);
    }, [isOpen, rideId]);

    useEffect(() => {
        if (isOpen) {
            if (!pickupLocation) {
                if (userLocation) setPickupLocation(normalizeMapLocation(userLocation));
                else if (initialPickupLocation) setPickupLocation(normalizeMapLocation(initialPickupLocation));
                else if (ride?.origin) setPickupLocation(normalizeMapLocation(ride.origin));
            }
            if (!dropoffLocation && ride?.destination) setDropoffLocation(normalizeMapLocation(ride.destination));
        } else {
            setClientSecret(null);
            setPaymentSignature(null);
            setIsPreparing(false);
        }
    }, [isOpen, userLocation, initialPickupLocation, ride?.origin, ride?.destination, pickupLocation, dropoffLocation]);

    useEffect(() => {
        if (!bookingBlockedMessage) return;
        setClientSecret(null);
        setPaymentSignature(null);
        setIsPreparing(false);
    }, [bookingBlockedMessage]);

    useEffect(() => {
        const updatePrice = async () => {
            if (!pickupLocation || !dropoffLocation || !ride || bookingBlockedMessage) return;

            const pickup = normalizeMapLocation(pickupLocation);
            const dropoff = normalizeMapLocation(dropoffLocation);
            const rideOrigin = normalizeMapLocation(ride.origin);
            if (!pickup || !dropoff) return;

            setIsCalculatingDistance(true);
            try {
                const coords = `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;
                const data = await fetchRoute(coords, 'false');
                const distanceKm = data?.code === 'Ok' && data?.routes?.[0]
                    ? data.routes[0].distance / 1000
                    : calculateDistance(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);

                setTripDistance(distanceKm);
                const rideTotalDistance = Number(ride.distance) || distanceKm;
                const driverPricePerKm = Number(ride.price) / Math.max(rideTotalDistance, 1);
                const passengerBasePrice = driverPricePerKm * distanceKm;
                const detourDistance = rideOrigin ? calculateDistance(rideOrigin.lat, rideOrigin.lng, pickup.lat, pickup.lng) : 0;
                const supplement = detourDistance > 3 ? RIDE_RULES.PICKUP_SUPPLEMENT : 0;
                setAppliedSupplement(supplement);
                setDynamicAmount(roundMoney((passengerBasePrice + supplement) * numSeats));
            } catch (error) {
                console.error('Error updating price:', error);
            } finally {
                setIsCalculatingDistance(false);
            }
        };

        updatePrice();
    }, [pickupLocation, dropoffLocation, ride, numSeats, bookingBlockedMessage]);

    useEffect(() => {
        if (isOpen && wallet && !bookingBlockedMessage && !pendingRecovery) {
            setPaymentMethod(Number(wallet.balance || 0) >= roundMoney(dynamicAmount) ? 'wallet' : 'card');
        }
    }, [isOpen, wallet, dynamicAmount, bookingBlockedMessage, pendingRecovery]);

    useEffect(() => {
        if (!isOpen || !clientSecret || !paymentSignature) return;
        if (paymentSignature !== bookingSignature) {
            setClientSecret(null);
            setPaymentSignature(null);
        }
    }, [bookingSignature, clientSecret, isOpen, paymentSignature]);

    useEffect(() => {
        const prepareStripe = async () => {
            if (!isOpen || paymentMethod !== 'card' || clientSecret || !isPaymentContextReady || pendingRecovery) return;
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
                if (error || !data?.clientSecret) throw new Error(data?.error?.message || error?.message || copy.stripeUnavailable);
                setClientSecret(data.clientSecret);
                setPaymentSignature(bookingSignature);
            } catch (e) {
                toast.error(copy.stripeError, { description: friendlyBookingError(e, copy) });
                setPaymentMethod('wallet');
                setClientSecret(null);
                setPaymentSignature(null);
            } finally {
                setIsPreparing(false);
            }
        };

        prepareStripe();
    }, [isOpen, paymentMethod, clientSecret, isPaymentContextReady, pendingRecovery, rideId, pickupLocation, pickupAddress, dropoffLocation, dropoffAddress, dynamicAmount, numSeats, bookingSignature, copy]);

    const handleLocationSelect = (loc) => {
        setPickupLocation(normalizeMapLocation(loc));
        setPickupAddress(loc?.address || '');
    };

    const handleDropoffSelect = (loc) => {
        setDropoffLocation(normalizeMapLocation(loc));
        setDropoffAddress(loc?.address || '');
    };

    const handleWalletPayment = async () => {
        setIsProcessingWallet(true);
        try {
            if (bookingBlockedMessage) throw new Error(bookingBlockedMessage);
            const numericPrice = roundMoney(dynamicAmount);
            if (Number.isNaN(numericPrice) || numericPrice <= 0) throw new Error(copy.invalidPrice);
            if (!isPaymentContextReady) throw new Error(copy.completeTripFirst);

            savePendingBooking({ rideId, amount: numericPrice, bookingSignature, method: 'wallet', status: 'server_confirming' });
            setPendingRecovery(readPendingBooking(rideId));

            const { success, error, data } = await confirmTripAndPay(rideId, null, {
                pickupLocation: normalizeMapLocation(pickupLocation) ?? null,
                pickupAddress: pickupAddress ?? null,
                dropoffLocation: normalizeMapLocation(dropoffLocation) ?? null,
                dropoffAddress: dropoffAddress ?? null,
                price: roundMoney(numericPrice / Math.max(Number(numSeats), 1)),
                numSeats: Number(numSeats),
            });

            if (!success) throw new Error(error || copy.connectionError);
            const result = data?.success !== undefined ? data : (data?.[0] || data);

            if (result?.success) {
                clearPendingBooking(rideId);
                setPendingRecovery(null);
                toast.success(copy.bookingConfirmed, { description: copy.walletConfirmedDesc });
                refreshWallet();
                setTimeout(() => {
                    if (onSuccess) onSuccess();
                    onClose();
                }, 1200);
            } else {
                throw new Error(result?.message || result?.error || copy.bookingProcessError);
            }
        } catch (e) {
            toast.error(copy.bookingDenied, { description: friendlyBookingError(e, copy), duration: 5000 });
        } finally {
            setIsProcessingWallet(false);
        }
    };

    const handlePendingStarted = () => {
        const pending = readPendingBooking(rideId);
        if (pending) setPendingRecovery(pending);
    };

    const handleClearPending = () => {
        clearPendingBooking(rideId);
        setPendingRecovery(null);
    };

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
                            {pendingRecovery && (
                                <PendingRecoveryNotice
                                    copy={copy}
                                    isChecking={isCheckingPending}
                                    onCheck={checkPendingBooking}
                                    onViewRide={goToRide}
                                    onClear={handleClearPending}
                                />
                            )}

                            {bookingBlockedMessage && (
                                <div className="rounded-3xl border-2 border-red-100 bg-red-50 p-5 text-red-700 shadow-sm">
                                    <div className="flex items-start gap-3">
                                        <AlertCircle className="mt-0.5 size-5 shrink-0" />
                                        <div className="space-y-2">
                                            <p className="text-[10px] font-black uppercase tracking-widest">{copy.reservationBlockedTitle}</p>
                                            <p className="text-sm font-bold leading-relaxed">{bookingBlockedMessage}</p>
                                            <Button type="button" onClick={onClose} variant="outline" className="h-10 rounded-2xl border-red-100 bg-white text-red-600 font-black uppercase tracking-widest text-[9px]">
                                                {copy.refreshAndClose}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                    <span className="size-5 rounded-full bg-slate-200 text-slate-900 flex items-center justify-center text-[8px]">1</span>
                                    {copy.pickupQuestion}
                                </p>
                                <div className="h-40 rounded-3xl overflow-hidden border-2 border-slate-100 shadow-inner relative group">
                                    <MapComponent center={pickupLocation || ride?.origin} zoom={15} onLocationSelect={paymentControlsDisabled ? undefined : handleLocationSelect} showSearch={false} height="100%" />
                                    <div className="absolute top-2 right-2 bg-white/90 backdrop-blur px-3 py-1.5 rounded-xl border border-slate-100 flex items-center gap-1.5 shadow-sm">
                                        <MapPin className="size-3 text-primary animate-pulse" />
                                        <span className="text-[9px] font-black uppercase text-slate-900 tracking-tighter">{copy.origin}</span>
                                    </div>
                                </div>
                                {pickupAddress && <p className="text-[9px] font-bold text-slate-500 italic px-2">{copy.pickupAt} {pickupAddress}</p>}
                            </div>

                            <div className="space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                    <span className="size-5 rounded-full bg-slate-200 text-slate-900 flex items-center justify-center text-[8px]">2</span>
                                    {copy.dropoffQuestion}
                                </p>
                                <div className="h-40 rounded-3xl overflow-hidden border-2 border-slate-100 shadow-inner relative group">
                                    <MapComponent center={dropoffLocation || ride?.destination} zoom={15} onLocationSelect={paymentControlsDisabled ? undefined : handleDropoffSelect} showSearch={false} height="100%" />
                                    <div className="absolute top-2 right-2 bg-white/90 backdrop-blur px-3 py-1.5 rounded-xl border border-slate-100 flex items-center gap-1.5 shadow-sm">
                                        <Navigation className="size-3 text-emerald-500 animate-pulse" />
                                        <span className="text-[9px] font-black uppercase text-slate-900 tracking-tighter">{copy.destination}</span>
                                    </div>
                                </div>
                                {dropoffAddress && <p className="text-[9px] font-bold text-slate-500 italic px-2">{copy.destinationAt} {dropoffAddress}</p>}
                            </div>

                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <span className="size-5 rounded-full bg-slate-200 text-slate-900 flex items-center justify-center text-[8px]">3</span>
                                {copy.seatsQuestion}
                            </p>
                            <div className="flex bg-white p-1.5 rounded-3xl border-2 border-slate-100 gap-1 shadow-sm">
                                {[1, 2, 3, 4].map((n) => {
                                    const isAvailable = n <= seatsAvailable;
                                    return (
                                        <button
                                            key={n}
                                            type="button"
                                            disabled={!isAvailable || paymentControlsDisabled}
                                            onClick={() => setNumSeats(n)}
                                            className={cn(
                                                'flex-1 h-12 rounded-2xl text-xs font-black transition-all touch-action-manipulation active:scale-95 flex flex-col items-center justify-center leading-none',
                                                numSeats === n ? 'bg-slate-900 text-white shadow-lg' : isAvailable ? 'text-slate-400 hover:bg-slate-50' : 'text-slate-200 cursor-not-allowed opacity-30'
                                            )}
                                        >
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
                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform"><ShieldCheck size={80} /></div>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-1">{copy.yourTrip} ({tripDistance.toFixed(1)} km)</p>
                                        <p className="text-4xl font-black italic tracking-tighter">
                                            {isCalculatingDistance ? <Loader2 className="h-8 w-8 animate-spin inline" /> : <>{roundMoney(dynamicAmount).toFixed(2)}<span className="text-xl ml-1">€</span></>}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        {appliedSupplement > 0 ? (
                                            <>
                                                <div className="flex items-center justify-end gap-1 text-emerald-400 text-[10px] font-black uppercase tracking-tighter"><TrendingUp size={10} /> {copy.detourDetected}</div>
                                                <div className="px-2 py-1 bg-white/10 rounded-lg text-[8px] font-bold text-slate-300 uppercase tracking-tighter">+ {appliedSupplement.toFixed(2)}€ {copy.supplement}</div>
                                            </>
                                        ) : (
                                            <div className="flex items-center justify-end gap-1 text-slate-400 text-[10px] font-black uppercase tracking-tighter opacity-50"><CheckCircle2 size={10} /> {copy.noDetour}</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <button type="button" disabled={paymentControlsDisabled} onClick={() => setPaymentMethod('wallet')} className={cn('flex flex-col items-center justify-center gap-2 p-4 rounded-3xl border-2 transition-all disabled:opacity-60', paymentMethod === 'wallet' ? 'bg-white border-primary shadow-lg ring-1 ring-primary/20' : 'bg-slate-100/50 border-transparent text-slate-400 hover:bg-white')}>
                                    <Wallet size={20} className={paymentMethod === 'wallet' ? 'text-primary' : ''} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">{copy.wallet}</span>
                                </button>
                                <button type="button" disabled={paymentControlsDisabled || !isPaymentContextReady} onClick={() => setPaymentMethod('card')} className={cn('flex flex-col items-center justify-center gap-2 p-4 rounded-3xl border-2 transition-all disabled:opacity-60', paymentMethod === 'card' ? 'bg-white border-primary shadow-lg ring-1 ring-primary/20' : 'bg-slate-100/50 border-transparent text-slate-400 hover:bg-white')}>
                                    <CreditCard size={20} className={paymentMethod === 'card' ? 'text-primary' : ''} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">{copy.card}</span>
                                </button>
                            </div>

                            {!isPaymentContextReady && !bookingBlockedMessage && !pendingRecovery && (
                                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-center text-[10px] font-black uppercase tracking-widest text-amber-700">
                                    {copy.completeTripFirst}
                                </div>
                            )}

                            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                                {paymentMethod === 'wallet' ? (
                                    <div className="space-y-4">
                                        <div className={cn('p-5 rounded-3xl border-2 flex items-center justify-between', hasBalance ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100')}>
                                            <div className="text-left">
                                                <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{copy.availableBalance}</p>
                                                <p className={cn('text-xl font-black', hasBalance ? 'text-emerald-700' : 'text-red-700')}>{Number(wallet?.balance || 0).toFixed(2)}€</p>
                                            </div>
                                            {hasBalance ? <CheckCircle2 className="text-emerald-500" /> : <AlertCircle className="text-red-500" />}
                                        </div>

                                        {hasBalance ? (
                                            <Button onClick={handleWalletPayment} disabled={isProcessingWallet || isCalculatingDistance || !isPaymentContextReady || Boolean(bookingBlockedMessage) || Boolean(pendingRecovery)} className="w-full h-16 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase italic tracking-widest shadow-xl shadow-emerald-200">
                                                {isProcessingWallet ? <Loader2 className="animate-spin" /> : <>{copy.confirmWithBalance} <ChevronRight className="ml-2" size={18} /></>}
                                            </Button>
                                        ) : (
                                            <div className="space-y-3">
                                                <p className="text-[10px] text-red-600 font-bold text-center italic">{copy.insufficientWallet}</p>
                                                <Button onClick={() => setPaymentMethod('card')} disabled={!isPaymentContextReady || Boolean(bookingBlockedMessage) || Boolean(pendingRecovery)} variant="outline" className="w-full h-14 rounded-2xl border-slate-200 text-slate-600 font-black uppercase tracking-widest">
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
                                                    bookingSignature={bookingSignature}
                                                    onSuccess={onSuccess}
                                                    onClose={onClose}
                                                    onPending={handlePendingStarted}
                                                    onRecovered={handleRecovered}
                                                    onGoToRide={goToRide}
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
