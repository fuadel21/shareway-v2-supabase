import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
    Loader2, CalendarIcon, MapPin, Sparkles, Euro, Users, Info,
    Megaphone, ShieldCheck, Clock, ChevronRight, Navigation, Heart, ChevronLeft
} from 'lucide-react';
import { format, isBefore, addMinutes } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import MapComponent from './MapComponent.jsx';
import { createRideRequest, RIDE_RULES, calculateRecommendedPrice, fetchRoute } from '@/services/rideService';
import { cn, decodePolyline } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const STORAGE_KEY = 'sw_request_draft';

const getNextHalfHour = () => {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0);
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

const CreateRequest = () => {
    const { t, i18n } = useTranslation();
    const { profile: currentUserProfile } = useOutletContext();
    const navigate = useNavigate();

    const [origin, setOrigin] = useState(null);
    const [destination, setDestination] = useState(null);
    const [date, setDate] = useState(new Date());
    const [time, setTime] = useState(getNextHalfHour());
    const [seats, setSeats] = useState(1);
    const [price, setPrice] = useState('');
    const [note, setNote] = useState('');
    const [isWomenOnly, setIsWomenOnly] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
    const [routeInfo, setRouteInfo] = useState({ path: [], distance: 0, polyline: '' });

    const routeAbortRef = useRef(null);

    // FASE 3: Persistencia de Borrador
    useEffect(() => {
        const draft = localStorage.getItem(STORAGE_KEY);
        if (draft && !origin) {
            try {
                const data = JSON.parse(draft);
                setNote(data.note || '');
                setSeats(data.seats || 1);
                setIsWomenOnly(data.isWomenOnly || false);
                if (data.origin) setOrigin(data.origin);
                if (data.destination) setDestination(data.destination);
                if (data.price) setPrice(data.price);
            } catch (e) { console.error("Draft error:", e); }
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (origin || destination || note) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    origin, destination, seats, note, isWomenOnly, price
                }));
            }
        }, 1500);
        return () => clearTimeout(timer);
    }, [origin, destination, seats, note, isWomenOnly, price]);

    // FASE 2: Blindaje de Ruta
    useEffect(() => {
        const getRoute = async () => {
            if (!origin?.coordinates || !destination?.coordinates) return;

            if (routeAbortRef.current) routeAbortRef.current.abort();
            const controller = new AbortController();
            routeAbortRef.current = controller;

            setIsCalculatingRoute(true);
            try {
                const coords = `${origin.coordinates.lng},${origin.coordinates.lat};${destination.coordinates.lng},${destination.coordinates.lat}`;

                // Usamos el proxy para evitar errores de CORS
                const data = await fetchRoute(coords, 'full', 'polyline');

                if (data.code === 'Ok' && data.routes[0]) {
                    const route = data.routes[0];
                    setRouteInfo({
                        path: decodePolyline(route.geometry),
                        distance: route.distance / 1000,
                        polyline: route.geometry
                    });

                    const suggested = calculateRecommendedPrice(route.distance);
                    setPrice(suggested.toString());
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error("OSRM Error:", error);
                }
            } finally {
                setIsCalculatingRoute(false);
            }
        };
        getRoute();
        return () => routeAbortRef.current?.abort();
    }, [origin, destination]);

    const handleCreateRequest = async (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        if (!origin?.coordinates || !destination?.coordinates) {
            return toast.error(t('dashboard.search_label'));
        }

        const [h, m] = time.split(':').map(Number);
        const departure = new Date(date);
        departure.setHours(h, m, 0, 0);

        // SYNC CON RIDE_RULES
        if (isBefore(departure, addMinutes(new Date(), RIDE_RULES.MIN_ADVANCE_MINUTES))) {
            return toast.error(t('common.error'), {
                description: `El viaje debe ser en al menos ${RIDE_RULES.MIN_ADVANCE_MINUTES} minutos.`
            });
        }

        const numPrice = parseFloat(price.toString().replace(',', '.'));
        if (isNaN(numPrice) || numPrice < RIDE_RULES.MIN_PRICE) {
            return toast.error(`El precio sugerido mínimo es ${RIDE_RULES.MIN_PRICE}€`);
        }

        setIsSubmitting(true);
        const toastId = toast.loading(t('common.loading'));

        try {
            await createRideRequest({
                origin,
                destination,
                dateTime: departure,
                seats,
                price: numPrice,
                note: note.trim().substring(0, 500),
                isWomenOnly,
                distance: routeInfo.distance,
                overview_polyline: routeInfo.polyline
            });

            localStorage.removeItem(STORAGE_KEY);
            // CORREGIDO: Mensaje correcto al publicar solicitud
            toast.success("Solicitud publicada", { id: toastId });
            navigate('/my-requests');
        } catch (error) {
            toast.error(t('common.error'), { id: toastId, description: error.message });
            setIsSubmitting(false);
        }
    };

    if (!currentUserProfile) return null;

    return (
        <div className="bg-slate-50 min-h-screen pb-32 font-sans text-left">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20 flex items-center gap-4">
                <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-12 shadow-sm active:scale-90 transition-all touch-action-manipulation" onClick={() => navigate('/dashboard')}>
                    <ChevronLeft className="h-6 w-6 text-slate-900" />
                </Button>
                <div className="text-left">
                    <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">{t('create_request.title')}</h1>
                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">{t('create_request.subtitle')}</p>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-8 text-left">
                <form onSubmit={handleCreateRequest} className="space-y-6 text-left">
                    <Card className="border-none shadow-xl rounded-[2.5rem] p-6 bg-white space-y-4">
                        <AddressAutocomplete
                            label={t('create_ride.origin_label')}
                            onSelect={setOrigin}
                            defaultValue={origin?.address}
                            icon={<div className="h-2 w-2 rounded-full bg-slate-300" />}
                        />
                        <AddressAutocomplete
                            label={t('create_ride.destination_label')}
                            onSelect={setDestination}
                            defaultValue={destination?.address}
                            icon={<div className="h-2 w-2 rounded-full bg-primary" />}
                        />

                        {(origin && destination) && (
                            <div className="h-44 w-full rounded-2xl overflow-hidden border mt-2 relative">
                                <MapComponent
                                    center={origin.coordinates}
                                    zoom={11}
                                    itemsToDisplay={[{ id: 'preview', type: 'request', origin, destination, decodedPath: routeInfo.path }]}
                                />
                                {isCalculatingRoute && (
                                    <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center z-10">
                                        <Loader2 className="animate-spin text-primary" />
                                    </div>
                                )}
                            </div>
                        )}
                    </Card>

                    <div className="grid grid-cols-2 gap-4">
                        <Card className="border-none shadow-lg rounded-[2rem] p-6 bg-white space-y-4 text-center">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('create_ride.section_datetime')}</p>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full h-14 rounded-2xl border-slate-100 bg-slate-50 font-black text-xs uppercase">
                                        {format(date, "dd MMM", { locale: i18n.language === 'es' ? es : enUS })}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="p-0 border-none shadow-2xl rounded-3xl overflow-hidden">
                                    <Calendar mode="single" selected={date} onSelect={setDate} fromDate={new Date()} locale={i18n.language === 'es' ? es : enUS} />
                                </PopoverContent>
                            </Popover>
                            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-14 rounded-2xl border-none bg-slate-50 font-black text-center text-lg" />
                        </Card>
                        <Card className="border-none shadow-lg rounded-[2rem] p-6 bg-white space-y-4 text-center">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('create_ride.section_seats_price')}</p>
                            <div className="flex bg-slate-50 p-1.5 rounded-2xl gap-1">
                                {[1, 2, 3, 4].map(n => (
                                    <button key={n} 
                                            type="button" 
                                            onClick={() => setSeats(n)} 
                                            className={cn(
                                                "flex-1 h-11 rounded-xl text-xs font-black transition-all touch-action-manipulation active:scale-95", 
                                                seats === n ? "bg-slate-900 text-white shadow-lg" : "text-slate-400"
                                            )}>
                                        {n}
                                    </button>
                                ))}
                            </div>
                            <div className="relative">
                                <Euro className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-primary font-bold" />
                                <Input type="number" step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} className="h-14 pl-9 rounded-2xl border-none bg-slate-50 font-black text-lg text-center" />
                            </div>
                        </Card>
                    </div>

                    <Card className="border-none shadow-xl rounded-[2.5rem] p-8 bg-white space-y-6">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="font-black text-slate-900 uppercase italic tracking-tighter">{t('create_request.section_shield')}</h3>
                            <button type="button" 
                                    onClick={() => setIsWomenOnly(!isWomenOnly)} 
                                    className={cn(
                                        "flex items-center gap-2 px-4 h-11 rounded-full border-2 transition-all min-w-[120px] justify-center", 
                                        isWomenOnly ? "bg-pink-50 border-pink-200 text-pink-600 shadow-sm" : "bg-slate-50 border-transparent text-slate-400",
                                        "active:scale-95 touch-action-manipulation"
                                    )}>
                                <Heart size={16} className={isWomenOnly ? "fill-pink-600" : ""} />
                                <span className="text-xs font-black uppercase tracking-tight leading-none">{t('create_ride.women_only')}</span>
                            </button>
                        </div>
                        <Textarea placeholder={t('create_request.note_placeholder')} className="min-h-[100px] rounded-2xl bg-slate-50 border-none shadow-inner p-5 font-medium italic text-slate-700" value={note} onChange={(e) => setNote(e.target.value)} />
                    </Card>

                    <div className="pt-4">
                        <Button type="submit" disabled={isSubmitting || !origin || !destination || isCalculatingRoute} className="w-full h-20 rounded-[2.2rem] bg-slate-900 hover:bg-slate-800 text-white font-black text-xl tracking-tighter shadow-2xl active:scale-95 transition-all border-none uppercase italic">
                            {isSubmitting ? <Loader2 className="animate-spin h-8 w-8" /> : <>{t('create_request.publish_button')} <ChevronRight size={24} className="ml-2 text-primary" /></>}
                        </Button>
                    </div>
                </form>
            </main>
        </div >
    );
};

export default CreateRequest;
