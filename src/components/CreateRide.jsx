import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useOutletContext, useNavigate, useLocation } from 'react-router-dom';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Card } from '@/components/ui/card.jsx';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Loader2, CalendarIcon, MapPin, Euro, Users, Car, Plus, X, Navigation,
    Sparkles, ShieldCheck, Clock, ChevronRight, Music, Baby, Dog, ChevronLeft, Heart
} from 'lucide-react';
import { format, isBefore, startOfToday, addMinutes } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import MapComponent from './MapComponent.jsx';
import { createSingleRide, RIDE_RULES, calculateRecommendedPrice } from '@/services/rideService';
import { validateRidePrice } from '@/utils/pricingRules';
import { cn } from '@/lib/utils';
import { globalPollingManager } from '@/utils/week1Optimizations';
import { useTranslation } from 'react-i18next';

const STORAGE_KEY = 'sw_ride_offer_draft';

const getNextHalfHour = () => {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0);
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

const PreferenceToggle = ({ icon: Icon, label, active, onClick }) => (
    <button type="button" 
            onClick={onClick} 
            className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-2 flex-1 min-h-[80px]", 
                active ? "border-primary bg-primary/5 text-primary shadow-sm" : "border-slate-50 text-slate-400 bg-slate-50/50",
                "active:scale-95 touch-action-manipulation"
            )}>
        <Icon className="h-6 w-6" />
        <span className="text-[10px] font-black uppercase tracking-tight">{label}</span>
    </button>
);

const CreateRide = () => {
    const { t, i18n } = useTranslation();
    const { profile: currentUserProfile, user } = useOutletContext();
    const navigate = useNavigate();
    const location = useLocation();

    const [origin, setOrigin] = useState(location.state?.origin || null);
    const [destination, setDestination] = useState(location.state?.destination || null);
    const [waypoints, setWaypoints] = useState([]);
    const [date, setDate] = useState(new Date());
    const [time, setTime] = useState(getNextHalfHour());
    const [seats, setSeats] = useState(3);
    const [price, setPrice] = useState('');
    const [details, setDetails] = useState('');
    const [isWomenOnly, setIsWomenOnly] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
    const [preferences, setPreferences] = useState({ music: true, pets: false, kids: true });
    const [approvalMode, setApprovalMode] = useState('automatic');
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [routeInfo, setRouteInfo] = useState({ path: [], distance: 0, polyline: '' });

    const routeDataRef = useRef(null);
    const routeAbortRef = useRef(null);
    const routeReqIdRef = useRef(0);

    // PERSISTENCIA DE BORRADOR (UX RECOVERY)
    useEffect(() => {
        const draft = localStorage.getItem(STORAGE_KEY);
        if (draft && !origin && !destination) {
            try {
                const data = JSON.parse(draft);
                setOrigin(data.origin);
                setDestination(data.destination);
                setSeats(data.seats || 3);
                setPrice(data.price || '');
                setDetails(data.details || '');
                setIsWomenOnly(data.isWomenOnly || false);
                setPreferences(data.preferences || { music: true, pets: false, kids: true });
            } catch (e) { console.error("Error loading draft:", e); }
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (origin || destination || details) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    origin, destination, seats, price, details, isWomenOnly, preferences
                }));
            }
        }, 1500);
        return () => clearTimeout(timer);
    }, [origin, destination, seats, price, details, isWomenOnly, preferences]);

    useEffect(() => {
        const calculateRoute = async () => {
            if (!origin?.coordinates || !destination?.coordinates) {
                routeDataRef.current = null;
                if (routeAbortRef.current) {
                    try { routeAbortRef.current.abort(); } catch (e) { }
                }
                setIsCalculatingRoute(false);
                return;
            }

            routeDataRef.current = null;
            if (routeAbortRef.current) {
                try { routeAbortRef.current.abort(); } catch (e) { }
            }

            const controller = new AbortController();
            routeAbortRef.current = controller;
            const reqId = ++routeReqIdRef.current;

            setIsCalculatingRoute(true);
            try {
                const coords = `${origin.coordinates.lng},${origin.coordinates.lat};${destination.coordinates.lng},${destination.coordinates.lat}`;
                const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=polyline`, { signal: controller.signal });
                const data = await res.json();

                if (reqId !== routeReqIdRef.current) return;

                    if (data.code === 'Ok' && data.routes[0]) {
                    const route = data.routes[0];
                    const distanceKm = route.distance / 1000;
                    routeDataRef.current = { distance: distanceKm, polyline: route.geometry };

                    const suggested = calculateRecommendedPrice(route.distance);
                    setPrice(suggested.toString());
                }
            } catch (e) {
                if (e?.name !== 'AbortError') console.error("Route calculation error:", e);
            } finally {
                if (reqId !== routeReqIdRef.current) return;
                setIsCalculatingRoute(false);
            }
        };
        calculateRoute();
        return () => {
            if (routeAbortRef.current) {
                try { routeAbortRef.current.abort(); } catch (e) { }
            }
        };
    }, [origin, destination]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!origin?.coordinates || !destination?.coordinates) return toast.error("Selecciona puntos de ruta válidos");

        if (isCalculatingRoute) return toast.error("Calculando ruta...");

        if (!routeDataRef.current?.polyline) {
            return toast.error("No se pudo obtener la ruta. Por favor, reintenta.");
        }

        const numPrice = parseFloat(price.toString().replace(',', '.'));
        if (isNaN(numPrice) || numPrice < RIDE_RULES.MIN_PRICE) {
            return toast.error(`El precio mínimo es ${RIDE_RULES.MIN_PRICE}€`);
        }

        // VALIDACIÓN DE PRECIO MÁXIMO (Blindaje)
        if (routeDataRef.current?.distance) {
            const validation = validateRidePrice(numPrice, routeDataRef.current.distance);
            if (!validation.valid) {
                return toast.error(validation.error, {
                    description: validation.details
                });
            }
        }

        const [h, m] = time.split(':').map(Number);
        const departure = new Date(date);
        departure.setHours(h, m, 0, 0);

        if (isBefore(departure, addMinutes(new Date(), RIDE_RULES.MIN_ADVANCE_MINUTES))) {
            return toast.error(`El viaje debe programarse con al menos ${RIDE_RULES.MIN_ADVANCE_MINUTES} min de antelación.`);
        }

        setIsConfirmOpen(true);
    };

    const handleConfirmPublish = async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        const toastId = toast.loading("Publicando viaje...");

        try {
            const [h, m] = time.split(':').map(Number);
            const departure = new Date(date);
            departure.setHours(h, m, 0, 0);

            const rideData = {
                origin,
                destination,
                waypoints: waypoints.filter(w => w && w.coordinates),
                dateTime: departure,
                seats: parseInt(seats),
                price: parseFloat(price.toString().replace(',', '.')),
                details,
                isWomenOnly,
                approvalMode,
                preferences,
                overview_polyline: routeDataRef.current?.polyline,
                distance: routeDataRef.current?.distance
            };

            await createSingleRide(rideData);

            localStorage.removeItem(STORAGE_KEY);

            if (user?.id) {
                globalPollingManager.clearCache(`user_ride_history_${user.id}`);
                globalPollingManager.clearCache(`available_rides_${user.id}`);
            }

            try { await Haptics.impact({ style: ImpactStyle.Heavy }); } catch (e) { }
            toast.success(t('create_ride.confirm_button'), { id: toastId });
            navigate('/dashboard');
        } catch (error) {
            toast.error(t('common.error'), { id: toastId, description: error.message });
        } finally {
            setIsSubmitting(false);
            setIsConfirmOpen(false);
        }
    };

    return (
        <div className="bg-slate-50 min-h-screen pb-32 font-sans">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20 flex items-center gap-4">
                <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-12" onClick={() => navigate('/dashboard')}>
                    <ChevronLeft className="h-6 w-6 text-slate-900" />
                </Button>
                <div className="text-left">
                    <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">{t('create_ride.title')}</h1>
                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">{t('create_ride.subtitle')}</p>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-8">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <Card className="border-none shadow-xl rounded-[2.5rem] p-6 bg-white space-y-6">
                        <div className="flex items-center gap-3">
                            <div className="bg-emerald-50 p-2.5 rounded-xl"><Navigation size={18} className="text-emerald-600" /></div>
                            <h3 className="font-black text-slate-900 uppercase italic tracking-tighter">{t('create_ride.section_itinerary')}</h3>
                        </div>
                        <div className="space-y-4">
                            <AddressAutocomplete label={t('create_ride.origin_label')} onSelect={setOrigin} defaultValue={origin?.address} icon={<div className="h-2 w-2 rounded-full bg-emerald-500" />} />
                            <AddressAutocomplete label={t('create_ride.destination_label')} onSelect={setDestination} defaultValue={destination?.address} icon={<div className="h-2 w-2 rounded-full bg-primary" />} />
                            
                            {(origin && destination) && (
                                <div className="h-44 w-full rounded-2xl overflow-hidden border mt-2 relative">
                                    <MapComponent
                                        center={origin.coordinates}
                                        zoom={11}
                                        itemsToDisplay={[{ id: 'preview', type: 'ride', origin, destination, decodedPath: routeInfo.path }]}
                                    />
                                    {isCalculatingRoute && (
                                        <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center z-10">
                                            <Loader2 className="animate-spin text-primary" />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </Card>

                    <div className="grid grid-cols-2 gap-4">
                        <Card className="border-none shadow-lg rounded-[2rem] p-6 bg-white space-y-4 text-center">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('create_ride.section_datetime')}</p>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full h-14 rounded-2xl border-slate-100 bg-slate-50 font-black text-xs uppercase tracking-tighter">
                                        {format(date, "dd MMM", { locale: i18n.language === 'es' ? es : enUS })}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="p-0 border-none shadow-2xl rounded-3xl overflow-hidden">
                                    <Calendar mode="single" selected={date} onSelect={setDate} fromDate={startOfToday()} locale={i18n.language === 'es' ? es : enUS} />
                                </PopoverContent>
                            </Popover>
                            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-14 rounded-2xl border-none bg-slate-50 font-black text-center text-lg" />
                        </Card>

                        <Card className="border-none shadow-lg rounded-[2rem] p-6 bg-white space-y-4 text-center">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('create_ride.section_seats_price')}</p>
                            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-2xl">
                                <button type="button" 
                                        onClick={() => setSeats(Math.max(1, seats - 1))} 
                                        className="w-12 h-12 flex items-center justify-center text-xl font-black text-slate-400 active:text-primary active:scale-90 transition-all">
                                    -
                                </button>
                                <div className="flex-1 text-center font-black text-2xl text-slate-900">{seats}</div>
                                <button type="button" 
                                        onClick={() => setSeats(Math.min(RIDE_RULES.MAX_SEATS, seats + 1))} 
                                        className="w-12 h-12 flex items-center justify-center text-xl font-black text-slate-400 active:text-primary active:scale-90 transition-all">
                                    +
                                </button>
                            </div>
                            <div className="relative">
                                <Euro className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-primary" />
                                <Input type="number" step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} className="h-14 pl-9 rounded-2xl border-none bg-slate-50 font-black text-lg text-center" />
                            </div>
                        </Card>
                    </div>

                    <Card className="border-none shadow-xl rounded-[2.5rem] p-8 bg-white space-y-6">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="font-black text-slate-900 uppercase italic tracking-tighter">{t('create_ride.section_preferences')}</h3>
                            <button type="button" 
                                    onClick={() => setIsWomenOnly(!isWomenOnly)} 
                                    className={cn(
                                        "flex items-center gap-2 px-4 h-11 rounded-full border-2 transition-all min-w-[120px] justify-center", 
                                        isWomenOnly ? "bg-pink-50 border-pink-200 text-pink-600 shadow-sm shadow-pink-100" : "bg-slate-50 border-transparent text-slate-400",
                                        "active:scale-95 touch-action-manipulation"
                                    )}>
                                <Heart size={16} className={isWomenOnly ? "fill-pink-600" : ""} />
                                <span className="text-xs font-black uppercase tracking-tight leading-none">{t('create_ride.women_only')}</span>
                            </button>
                        </div>
                        <div className="flex gap-3">
                            <PreferenceToggle icon={Music} label={t('edit_profile.pref_labels.music')} active={preferences.music} onClick={() => setPreferences(p => ({ ...p, music: !p.music }))} />
                            <PreferenceToggle icon={Dog} label={t('edit_profile.pref_labels.pets')} active={preferences.pets} onClick={() => setPreferences(p => ({ ...p, pets: !p.pets }))} />
                            <PreferenceToggle icon={Baby} label="Family" active={preferences.kids} onClick={() => setPreferences(p => ({ ...p, kids: !p.kids }))} />
                        </div>
                        <Textarea placeholder={t('create_ride.note_placeholder')} className="min-h-[100px] rounded-2xl bg-slate-50 border-none shadow-inner p-5 font-medium italic text-slate-600" value={details} onChange={(e) => setDetails(e.target.value)} />
                    </Card>

                    <Button type="submit" disabled={isSubmitting || isCalculatingRoute} className="w-full h-20 rounded-[2.2rem] bg-slate-900 text-white font-black text-xl shadow-2xl active:scale-95 border-none uppercase italic">
                        {isSubmitting ? <Loader2 className="animate-spin h-8 w-8" /> : <>{t('create_ride.publish_button')} <ChevronRight size={24} className="ml-2 text-primary" /></>}
                    </Button>
                </form>

                <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
                    <AlertDialogContent className="rounded-3xl bg-white max-w-md w-[90vw]">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="font-black text-2xl uppercase italic tracking-tighter">{t('create_ride.confirm_title')}</AlertDialogTitle>
                            <AlertDialogDescription asChild>
                                <div className="text-left space-y-2 pt-4">
                                    <p className="font-bold text-slate-900">{t('create_ride.confirm_desc')}</p>
                                    <p className="text-xs text-slate-500 uppercase font-black tracking-widest">{t('create_ride.confirm_notice')}</p>
                                </div>
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="mt-6 gap-2">
                            <AlertDialogCancel className="rounded-xl h-12">{t('create_ride.cancel_button')}</AlertDialogCancel>
                            <AlertDialogAction onClick={handleConfirmPublish} className="h-12 rounded-xl bg-slate-900 text-white font-black">{t('create_ride.confirm_button')}</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </main>
        </div>
    );
};

export default CreateRide;
