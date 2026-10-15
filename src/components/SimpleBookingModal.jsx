import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    Calendar, CheckCircle2, Loader2, MapPin, Minus, Navigation, Plus, ShieldCheck, Wallet,
} from 'lucide-react';
import AddressAutocomplete from './AddressAutocomplete';
import { Button } from './ui/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.jsx';
import { confirmTripAndPay } from '../lib/supabaseRPC.js';
import { buildLocalQuote, isValidLocation, normalizeLocation, roundMoney } from '../utils/localQuote.js';

const copyByLanguage = {
    es: {
        title: 'Finalizar reserva',
        subtitle: 'Elige tus puntos y confirma. El precio se calcula al instante.',
        pickupLabel: 'Recogida',
        dropoffLabel: 'Destino',
        seatsLabel: 'Plazas',
        yourTrip: 'Tu trayecto',
        perSeat: 'Precio por plaza',
        platformFee: 'Comisión plataforma (10%)',
        driverPayout: 'Neto conductor (90%)',
        supplement: 'Suplemento recogida',
        totalToPay: 'Total a pagar',
        cancelPolicy: 'Cancelación: +24h 100% reembolso · 2-24h 50% · <2h 0%',
        bookButton: 'Reservar y pagar',
        booking: 'Reservando...',
        balance: 'Saldo cartera',
        insufficient: 'No tienes saldo suficiente en la cartera.',
        noSession: 'Tu sesión ha caducado. Cierra sesión y vuelve a entrar.',
        selectPoints: 'Selecciona recogida y destino válidos.',
        successTitle: '¡Reserva confirmada!',
        successDesc: 'Guarda tu PIN de abordaje:',
        viewRide: 'Ver mi viaje',
        bookingDenied: 'No se pudo completar la reserva',
        estimated: 'Precio calculado en tu dispositivo · el servidor lo valida al confirmar',
    },
    en: {
        title: 'Complete booking',
        subtitle: 'Pick your points and confirm. Price is calculated instantly.',
        pickupLabel: 'Pickup',
        dropoffLabel: 'Dropoff',
        seatsLabel: 'Seats',
        yourTrip: 'Your trip',
        perSeat: 'Price per seat',
        platformFee: 'Platform fee (10%)',
        driverPayout: 'Driver payout (90%)',
        supplement: 'Pickup supplement',
        totalToPay: 'Total to pay',
        cancelPolicy: 'Cancellation: 24h+ full refund · 2-24h 50% · <2h none',
        bookButton: 'Book and pay',
        booking: 'Booking...',
        balance: 'Wallet balance',
        insufficient: 'Your wallet balance is not enough.',
        noSession: 'Your session expired. Please sign out and sign in again.',
        selectPoints: 'Select valid pickup and dropoff points.',
        successTitle: 'Booking confirmed!',
        successDesc: 'Keep your boarding PIN:',
        viewRide: 'View my ride',
        bookingDenied: 'Booking could not be completed',
        estimated: 'Price computed on your device · server validates on confirm',
    },
    ar: {
        title: 'إتمام الحجز',
        subtitle: 'اختر نقطتيك وأكد. يُحسب السعر فورًا.',
        pickupLabel: 'الاستلام',
        dropoffLabel: 'الوجهة',
        seatsLabel: 'المقاعد',
        yourTrip: 'رحلتك',
        perSeat: 'السعر للمقعد',
        platformFee: 'عمولة المنصة (10%)',
        driverPayout: 'صافي السائق (90%)',
        supplement: 'مكافأة الاستلام',
        totalToPay: 'الإجمالي',
        cancelPolicy: 'الإلغاء: +24 ساعة استرداد كامل · 2-24 ساعة 50% · أقل من ساعتين لا شيء',
        bookButton: 'احجز وادفع',
        booking: 'جارٍ الحجز...',
        balance: 'رصيد المحفظة',
        insufficient: 'رصيد محفظتك غير كافٍ.',
        noSession: 'انتهت جلستك. يرجى تسجيل الخروج والدخول مرة أخرى.',
        selectPoints: 'اختر نقطتي استلام ووجهة صالحتين.',
        successTitle: 'تم تأكيد الحجز!',
        successDesc: 'احتفظ برمز الصعود:',
        viewRide: 'عرض رحلتي',
        bookingDenied: 'تعذر إتمام الحجز',
        estimated: 'السعر محسوب على جهازك · يتحقق منه الخادم عند التأكيد',
    },
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const readStoredSession = () => {
    try {
        const raw = localStorage.getItem('sw-auth-storage');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const session = parsed?.currentSession || parsed?.session || parsed;
        return session?.access_token ? session : null;
    } catch {
        return null;
    }
};

const readStoredUserId = () => {
    try {
        const raw = localStorage.getItem('sw-auth-storage');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const session = parsed?.currentSession || parsed?.session || parsed;
        return session?.user?.id || null;
    } catch {
        return null;
    }
};

const friendlyError = (raw) => {
    const text = String(raw || '').toUpperCase();
    if (text.includes('SALDO_INSUFICIENTE')) return 'insufficient';
    if (text.includes('VIAJE_NO_DISPONIBLE') || text.includes('NO_HAY_PLAZAS')) return 'ride-gone';
    if (text.includes('YA_TIENES_RESERVA')) return 'already';
    if (text.includes('TIMEOUT') || text.includes('ABORT')) return 'timeout';
    if (text.includes('AUTH') || text.includes('401')) return 'no-session';
    return null;
};

const SimpleBookingModal = ({ isOpen, onClose, ride, onSuccess, initialPickupLocation }) => {
    const { i18n } = useTranslation();
    const copy = copyByLanguage[getLanguage(i18n?.language)];

    const [pickupLocation, setPickupLocation] = useState(null);
    const [pickupAddress, setPickupAddress] = useState('');
    const [dropoffLocation, setDropoffLocation] = useState(null);
    const [dropoffAddress, setDropoffAddress] = useState('');
    const [numSeats, setNumSeats] = useState(1);
    const [phase, setPhase] = useState('form'); // form | confirming | success
    const [errorMsg, setErrorMsg] = useState(null);
    const [balance, setBalance] = useState(null);
    const [result, setResult] = useState(null);

    const seatsAvailable = Number(ride?.seats_available ?? ride?.available_seats ?? 0);
    const maxSeats = Math.max(1, Math.min(8, seatsAvailable || 1));

    useEffect(() => {
        if (!isOpen) return;
        const initialPickup = normalizeLocation(initialPickupLocation) || normalizeLocation(ride?.origin);
        const initialDropoff = normalizeLocation(ride?.destination);
        setPickupLocation(initialPickup);
        setPickupAddress(initialPickup?.address || initialPickup?.name || '');
        setDropoffLocation(initialDropoff);
        setDropoffAddress(initialDropoff?.address || initialDropoff?.name || '');
        setNumSeats(1);
        setPhase('form');
        setErrorMsg(null);
        setResult(null);
    }, [isOpen, ride?.id]);

    // Saldo de cartera: consulta directa con timeout corto (si falla, no bloquea nada)
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        const load = async () => {
            const token = readStoredSession()?.access_token;
            const userId = readStoredUserId();
            if (!token || !userId) return;
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 8000);
                const res = await fetch(
                    `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/wallets?select=balance&user_id=eq.${userId}`,
                    {
                        headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
                        signal: controller.signal,
                    },
                ).finally(() => clearTimeout(timer));
                if (!res.ok) return;
                const rows = await res.json();
                if (!cancelled && Array.isArray(rows) && rows.length > 0) {
                    setBalance(Number(rows[0].balance) || 0);
                }
            } catch {
                /* el saldo es informativo; el servidor verifica al confirmar */
            }
        };
        load();
        return () => { cancelled = true; };
    }, [isOpen]);

    // PRECIO: calculo 100% local, instantaneo, sin red
    const quote = useMemo(
        () => buildLocalQuote(ride, pickupLocation, dropoffLocation, numSeats),
        [ride?.id, ride?.price, ride?.distance, pickupLocation, dropoffLocation, numSeats],
    );

    const canBook = Boolean(quote && quote.total > 0 && isValidLocation(pickupLocation) && isValidLocation(dropoffLocation));
    const sessionAlive = Boolean(readStoredSession());

    const handleBook = async () => {
        setErrorMsg(null);
        if (!sessionAlive) {
            setErrorMsg(copy.noSession);
            return;
        }
        if (!canBook) {
            setErrorMsg(copy.selectPoints);
            return;
        }
        setPhase('confirming');
        try {
            const { success, error, data } = await confirmTripAndPay(ride.id, null, {
                pickupLocation: normalizeLocation(pickupLocation),
                pickupAddress: pickupAddress || null,
                dropoffLocation: normalizeLocation(dropoffLocation),
                dropoffAddress: dropoffAddress || null,
                price: quote.pricePerSeat,
                numSeats,
            });
            if (!success) throw new Error(error || 'ERROR_DESCONOCIDO');
            const payload = Array.isArray(data) ? data[0] : data;
            if (payload?.success) {
                setResult({ pin: payload.pin, amount: payload.amount ?? quote.total });
                setPhase('success');
                toast.success(copy.successTitle);
                if (onSuccess) onSuccess();
                return;
            }
            throw new Error(payload?.error || payload?.message || 'ERROR_DESCONOCIDO');
        } catch (e) {
            const mapped = friendlyError(e?.message || e);
            if (mapped === 'insufficient') setErrorMsg(copy.insufficient);
            else if (mapped === 'no-session') setErrorMsg(copy.noSession);
            else if (mapped === 'ride-gone') setErrorMsg('Este viaje ya no está disponible o no quedan plazas.');
            else if (mapped === 'already') setErrorMsg('Ya tienes una reserva en este viaje.');
            else if (mapped === 'timeout') setErrorMsg('La conexión tardó demasiado. Revisa tu red e inténtalo de nuevo.');
            else setErrorMsg(String(e?.message || e || copy.bookingDenied));
            setPhase('form');
        }
    };

    if (!ride) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open && phase !== 'confirming') onClose(); }}>
            <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl p-0 bg-slate-50">
                <DialogHeader className="px-6 pt-6 pb-2">
                    <DialogTitle className="font-black uppercase italic tracking-tighter text-slate-900">
                        {copy.title}
                    </DialogTitle>
                    <DialogDescription className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        {copy.subtitle}
                    </DialogDescription>
                </DialogHeader>

                <div className="px-6 pb-6 space-y-4">
                    {/* Resumen del viaje */}
                    <div className="rounded-3xl bg-white border-2 border-slate-100 p-4 space-y-2">
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                            <Calendar className="size-3.5 text-primary" />
                            {ride.origin?.name || ride.origin?.address} → {ride.destination?.name || ride.destination?.address}
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            {ride.departure_time ? new Date(ride.departure_time).toLocaleString() : ''}
                        </div>
                    </div>

                    {phase === 'success' ? (
                        <div className="rounded-3xl bg-emerald-50 border-2 border-emerald-100 p-6 text-center space-y-3">
                            <CheckCircle2 className="size-12 text-emerald-500 mx-auto" />
                            <p className="font-black uppercase italic text-emerald-700">{copy.successTitle}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">{copy.successDesc}</p>
                            <p className="text-4xl font-black italic tracking-tighter text-emerald-700">{result?.pin || '----'}</p>
                            <p className="text-[10px] font-bold text-emerald-600">
                                {Number(result?.amount || 0).toFixed(2)} €
                            </p>
                            <Button onClick={onClose} className="w-full h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase italic tracking-normal">
                                {copy.viewRide}
                            </Button>
                        </div>
                    ) : (
                        <>
                            {/* 1. Recogida */}
                            <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                    <span className="size-5 rounded-full bg-slate-200 text-slate-900 flex items-center justify-center text-[8px]">1</span>
                                    {copy.pickupLabel}
                                </p>
                                <div className="rounded-3xl bg-white border-2 border-slate-100 p-1.5">
                                    <AddressAutocomplete
                                        label={copy.pickupLabel}
                                        icon={<MapPin className="size-4 text-primary" />}
                                        initialValue={pickupAddress}
                                        onSelect={(place) => {
                                            setPickupLocation(normalizeLocation(place) || place);
                                            setPickupAddress(place?.address || '');
                                        }}
                                    />
                                </div>
                            </div>

                            {/* 2. Destino */}
                            <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                    <span className="size-5 rounded-full bg-slate-200 text-slate-900 flex items-center justify-center text-[8px]">2</span>
                                    {copy.dropoffLabel}
                                </p>
                                <div className="rounded-3xl bg-white border-2 border-slate-100 p-1.5">
                                    <AddressAutocomplete
                                        label={copy.dropoffLabel}
                                        icon={<Navigation className="size-4 text-emerald-500" />}
                                        initialValue={dropoffAddress}
                                        onSelect={(place) => {
                                            setDropoffLocation(normalizeLocation(place) || place);
                                            setDropoffAddress(place?.address || '');
                                        }}
                                    />
                                </div>
                            </div>

                            {/* 3. Plazas */}
                            <div className="flex items-center justify-between rounded-3xl bg-white border-2 border-slate-100 px-5 py-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                    <span className="size-5 rounded-full bg-slate-200 text-slate-900 flex items-center justify-center text-[8px]">3</span>
                                    {copy.seatsLabel}
                                </p>
                                <div className="flex items-center gap-4">
                                    <button
                                        type="button"
                                        onClick={() => setNumSeats((n) => Math.max(1, n - 1))}
                                        disabled={numSeats <= 1 || phase === 'confirming'}
                                        className="size-10 rounded-2xl bg-slate-100 flex items-center justify-center disabled:opacity-40"
                                    >
                                        <Minus className="size-4 text-slate-700" />
                                    </button>
                                    <span className="text-2xl font-black italic w-6 text-center text-slate-900">{numSeats}</span>
                                    <button
                                        type="button"
                                        onClick={() => setNumSeats((n) => Math.min(maxSeats, n + 1))}
                                        disabled={numSeats >= maxSeats || phase === 'confirming'}
                                        className="size-10 rounded-2xl bg-slate-100 flex items-center justify-center disabled:opacity-40"
                                    >
                                        <Plus className="size-4 text-slate-700" />
                                    </button>
                                </div>
                            </div>

                            {/* 4. Precio (calculo local instantaneo) */}
                            <div className="bg-slate-900 rounded-3xl p-6 text-white space-y-3 shadow-xl">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-1">{copy.totalToPay}</p>
                                        <p className="text-4xl font-black italic tracking-tighter">
                                            {quote ? <>{quote.total.toFixed(2)}<span className="text-xl ml-1">€</span></> : '—'}
                                        </p>
                                    </div>
                                    <ShieldCheck size={40} className="opacity-20" />
                                </div>
                                {quote && (
                                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 space-y-1 border-t border-white/10 pt-2">
                                        <p>{copy.yourTrip}: {quote.billedKm.toFixed(1)} km</p>
                                        <p>{copy.perSeat}: {quote.pricePerSeat.toFixed(2)} €{quote.supplement > 0 ? ` (+${quote.supplement.toFixed(2)} € ${copy.supplement.toLowerCase()})` : ''}</p>
                                        <p>{copy.platformFee}: {quote.platformFee.toFixed(2)} € · {copy.driverPayout}: {quote.driverPayout.toFixed(2)} €</p>
                                    </div>
                                )}
                                <p className="text-[8px] font-bold uppercase tracking-wider text-slate-500">{copy.cancelPolicy}</p>
                            </div>

                            {errorMsg && (
                                <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-center text-[10px] font-black uppercase tracking-widest text-red-700">
                                    {errorMsg}
                                </div>
                            )}

                            {/* Boton de reserva */}
                            <Button
                                onClick={handleBook}
                                disabled={phase === 'confirming' || !canBook}
                                className="w-full h-12 rounded-3xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase italic tracking-widest text-base shadow-xl shadow-emerald-200 disabled:opacity-50"
                            >
                                {phase === 'confirming' ? (
                                    <><Loader2 className="size-5 animate-spin mr-2" />{copy.booking}</>
                                ) : (
                                    <><Wallet className="size-5 mr-2" />{copy.bookButton}{quote ? ` · ${quote.total.toFixed(2)} €` : ''}</>
                                )}
                            </Button>

                            <p className="text-center text-[8px] font-bold uppercase tracking-widest text-slate-400">
                                {balance != null ? `${copy.balance}: ${balance.toFixed(2)} € · ` : ''}{copy.estimated}
                            </p>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default SimpleBookingModal;
