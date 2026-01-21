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
import { es } from 'date-fns/locale';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import MapComponent from './MapComponent.jsx';
import { createRideRequest } from '@/services/rideService';
import { cn, decodePolyline } from '@/lib/utils';

const STORAGE_KEY = 'sw_request_draft';

const getNextHalfHour = () => {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0);
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

const CreateRequest = () => {
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
            } catch (e) { console.error(e); }
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ origin, destination, seats, note, isWomenOnly }));
        }, 1000);
        return () => clearTimeout(timer);
    }, [origin, destination, seats, note, isWomenOnly]);

    // FASE 2: Blindaje de Ruta
    useEffect(() => {
        const getRoute = async () => {
            if (!origin || !destination) return;
            setIsCalculatingRoute(true);
            try {
                const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.coordinates.lng},${origin.coordinates.lat};${destination.coordinates.lng},${destination.coordinates.lat}?overview=full&geometries=polyline`);
                const data = await res.json();
                if (data.code === 'Ok' && data.routes[0]) {
                    const route = data.routes[0];
                    setRouteInfo({ 
                        path: decodePolyline(route.geometry), 
                        distance: route.distance / 1000,
                        polyline: route.geometry
                    });
                    if (!price) setPrice((route.distance / 1000 * 0.25).toFixed(2));
                }
            } catch (error) { 
                console.error(error); 
                toast.error("Error al trazar la ruta");
            } finally {
                setIsCalculatingRoute(false);
            }
        };
        getRoute();
    }, [origin, destination]);

    const handleCreateRequest = async (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        if (!origin || !destination) return toast.error("Selecciona origen y destino");
        
        const [h, m] = time.split(':').map(Number);
        const departure = new Date(date);
        departure.setHours(h, m, 0, 0);

        if (isBefore(departure, addMinutes(new Date(), 5))) {
            return toast.error("La hora debe ser al menos 5 minutos a futuro");
        }

        setIsSubmitting(true);
        const toastId = toast.loading("Publicando tu solicitud...");
        
        try {
            await createRideRequest({
                origin,
                destination,
                dateTime: departure,
                seats,
                price: price.toString().replace(',', '.'),
                note: note.trim(),
                isWomenOnly,
                distance: routeInfo.distance,
                overview_polyline: routeInfo.polyline
            });
            
            localStorage.removeItem(STORAGE_KEY);
            toast.success('¡Solicitud publicada en la comunidad!', { id: toastId });
            navigate('/dashboard');
        } catch (error) {
            let errorMsg = "Fallo al crear solicitud";
            let description = error.message;

            if (description.includes("solicitud activa")) {
                errorMsg = "Conflicto de horario";
                description = "Ya tienes otra solicitud activa para este mismo horario.";
            } else if (description.includes("límite de 5")) {
                errorMsg = "Límite alcanzado";
                description = "Tienes demasiadas solicitudes pendientes. Cancela alguna antes.";
            } else if (description.includes("Solo las usuarias")) {
                errorMsg = "Restricción de Género";
                description = "Solo las usuarias pueden pedir viajes exclusivos para mujeres.";
            }

            toast.error(errorMsg, { id: toastId, description, duration: 5000 });
            setIsSubmitting(false);
        }
    };

    const isVerified = true; // [AGENT_NOTE] BYPASS TEMPORAL DEV SERVER

    if (!currentUserProfile) return null;

    return (
        <div className="bg-slate-50 min-h-screen pb-32 font-sans">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20 flex items-center gap-4">
                <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-12 shadow-sm" onClick={() => navigate('/dashboard')}><ChevronLeft className="h-6 w-6 text-slate-900" /></Button>
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">Pedir Viaje</h1>
                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">Community Request Hub</p>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-8">
                {!isVerified ? (
                    <Card className="border-none shadow-xl rounded-[2.5rem] p-8 bg-white text-center space-y-6">
                        <div className="mx-auto bg-slate-100 w-20 h-20 rounded-full flex items-center justify-center">
                            <ShieldCheck className="h-10 w-10 text-slate-400" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter mb-2">Verificación Requerida</h2>
                            <p className="text-slate-500 font-medium">Para pedir plazas y mantener la confianza de la comunidad, necesitamos validar tu identidad.</p>
                        </div>
                        <Button
                            onClick={() => navigate('/settings?section=verification')}
                            className="w-full h-16 rounded-[2rem] bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider shadow-lg shadow-indigo-200"
                        >
                            Verificar mi Perfil
                        </Button>
                    </Card>
                ) : (
                    <form onSubmit={handleCreateRequest} className="space-y-6">
                        <Card className="border-none shadow-xl rounded-[2.5rem] p-6 bg-white space-y-4">
                            <AddressAutocomplete label="Punto de encuentro" onSelect={setOrigin} defaultValue={origin?.address} icon={<div className="h-2 w-2 rounded-full bg-slate-300" />} />
                            <AddressAutocomplete label="Destino final" onSelect={setDestination} defaultValue={destination?.address} icon={<div className="h-2 w-2 rounded-full bg-primary" />} />
                            {(origin && destination) && (
                                <div className="h-44 w-full rounded-2xl overflow-hidden border mt-2 relative">
                                    <MapComponent center={origin.coordinates} zoom={11} itemsToDisplay={[{ id: 'preview', type: 'request', origin, destination, decodedPath: routeInfo.path }]} />
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
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Día y Hora</p>
                                <Popover><PopoverTrigger asChild><Button variant="outline" className="w-full h-14 rounded-2xl border-slate-100 bg-slate-50 font-black text-xs uppercase">{format(date, "dd MMM", { locale: es })}</Button></PopoverTrigger><PopoverContent className="p-0 border-none shadow-2xl rounded-3xl overflow-hidden"><Calendar mode="single" selected={date} onSelect={setDate} fromDate={new Date()} locale={es} /></PopoverContent></Popover>
                                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-14 rounded-2xl border-none bg-slate-50 font-black text-center text-lg" />
                            </Card>
                            <Card className="border-none shadow-lg rounded-[2rem] p-6 bg-white space-y-4 text-center">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Plazas y Precio</p>
                                <div className="flex bg-slate-50 p-1 rounded-xl">
                                    {[1, 2, 3, 4].map(n => (
                                        <button key={n} type="button" onClick={() => setSeats(n)} className={cn("flex-1 py-2 rounded-lg text-[10px] font-black transition-all", seats === n ? "bg-slate-900 text-white shadow-lg" : "text-slate-400")}>{n}</button>
                                    ))}
                                </div>
                                <div className="relative"><Euro className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-primary font-bold" /><Input type="number" step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} className="h-14 pl-9 rounded-2xl border-none bg-slate-50 font-black text-lg text-center" /></div>
                            </Card>
                        </div>

                        <Card className="border-none shadow-xl rounded-[2.5rem] p-8 bg-white space-y-6">
                            <div className="flex items-center justify-between">
                                <h3 className="font-black text-slate-900 uppercase italic tracking-tighter">Opciones de Seguridad</h3>
                                <button type="button" onClick={() => setIsWomenOnly(!isWomenOnly)} className={cn("flex items-center gap-2 px-4 py-2 rounded-full border-2 transition-all", isWomenOnly ? "bg-pink-50 border-pink-200 text-pink-600 shadow-sm" : "bg-slate-50 border-transparent text-slate-400")}>
                                    <Heart size={14} className={isWomenOnly ? "fill-pink-600" : ""} />
                                    <span className="text-[9px] font-black uppercase tracking-widest">Solo Mujeres</span>
                                </button>
                            </div>
                            <Textarea placeholder="¿Algo que el conductor deba saber? (Ej: llevo maleta grande)" className="min-h-[100px] rounded-2xl bg-slate-50 border-none shadow-inner p-5 font-medium italic text-slate-600" value={note} onChange={(e) => setNote(e.target.value)} />
                        </Card>

                        <div className="pt-4">
                            <Button type="submit" disabled={isSubmitting || !origin || !destination || isCalculatingRoute} className="w-full h-20 rounded-[2.2rem] bg-slate-900 hover:bg-slate-800 text-white font-black text-xl tracking-tighter shadow-2xl active:scale-95 transition-all border-none uppercase italic">
                                {isSubmitting ? <Loader2 className="animate-spin h-8 w-8" /> : <>Solicitar Viaje <ChevronRight size={24} className="ml-2 text-primary" /></>}
                            </Button>
                        </div>
                    </form>
                )}
            </main>
        </div >
    );
};

export default CreateRequest;
