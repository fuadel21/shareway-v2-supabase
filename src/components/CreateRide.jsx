import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useOutletContext, useNavigate, useLocation } from 'react-router-dom';
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
import { format, isBefore, startOfToday } from 'date-fns';
import { es } from 'date-fns/locale';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import { createSingleRide } from '@/services/rideService';
import { cn } from '@/lib/utils';

const getNextHalfHour = () => {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0);
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

const PreferenceToggle = ({ icon: Icon, label, active, onClick }) => (
    <button type="button" onClick={onClick} className={cn("flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-2 flex-1", active ? "border-primary bg-primary/5 text-primary shadow-sm" : "border-slate-50 text-slate-400 bg-slate-50/50")}>
        <Icon className="h-5 w-5" /><span className="text-[8px] font-black uppercase tracking-tighter">{label}</span>
    </button>
);

const CreateRide = () => {
    const { profile: currentUserProfile } = useOutletContext();
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

    const routeDataRef = useRef(null);

    useEffect(() => {
        const calculateRoute = async () => {
            if (!origin || !destination) return;
            setIsCalculatingRoute(true);
            try {
                const coords = `${origin.coordinates.lng},${origin.coordinates.lat};${destination.coordinates.lng},${destination.coordinates.lat}`;
                const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=polyline`);
                const data = await res.json();
                if (data.code === 'Ok' && data.routes[0]) {
                    const route = data.routes[0];
                    const prevDistance = routeDataRef.current?.distance;
                    routeDataRef.current = { distance: route.distance / 1000, polyline: route.geometry };

                    // REFINAMIENTO (Fallo 5): Si la distancia cambia significativamente o no había precio, sugerir
                    if (!price || (prevDistance && Math.abs(prevDistance - routeDataRef.current.distance) > 5)) {
                        setPrice((routeDataRef.current.distance * 0.18).toFixed(2));
                    }
                }
            } catch (e) { console.error(e); } finally {
                setIsCalculatingRoute(false);
            }
        };
        calculateRoute();
    }, [origin, destination]);

    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!origin?.coordinates || !destination?.coordinates) return toast.error("Selecciona puntos de ruta válidos");
        if (isCalculatingRoute) return toast.error("Espera a que termine el cálculo de ruta...");

        const numPrice = parseFloat(price.toString().replace(',', '.'));
        const distance = routeDataRef.current?.distance || 0;

        // BLINDAJE FRONTERA: Sincronización con el motor SQL (0.60€/km max)
        const maxAllowedRate = 0.60;
        if (distance > 0 && (numPrice / distance) > maxAllowedRate) {
            return toast.error("Precio excesivo detectado", {
                description: `El máximo para esta distancia (${distance.toFixed(1)}km) es de ${(distance * maxAllowedRate).toFixed(2)}€. Por favor, ajusta tu oferta.`
            });
        }

        const [h, m] = time.split(':').map(Number);
        const departure = new Date(date);
        departure.setHours(h, m, 0, 0);

        if (isBefore(departure, new Date())) return toast.error("La hora de salida ya ha pasado.");
        if (isCalculatingRoute) return toast.error("Calculando ruta óptima, por favor espera...");

        setIsConfirmOpen(true);
    };

    const handleConfirmPublish = async () => {
        if (isSubmitting) return; // Fallo 7
        setIsSubmitting(true);
        const toastId = toast.loading("Publicando viaje...");

        try {
            const [h, m] = time.split(':').map(Number);
            const departure = new Date(date);
            departure.setHours(h, m, 0, 0);

            const rideData = {
                origin,
                destination,
                waypoints: waypoints.filter(w => w !== null),
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

            const newRideId = await createSingleRide(rideData);
            toast.success("¡Viaje publicado!", { id: toastId });
            navigate('/dashboard');
        } catch (error) {
            toast.error("Error al publicar", { id: toastId, description: error.message });
        } finally {
            setIsSubmitting(false);
            setIsConfirmOpen(false);
        }
    };

    const isVerified = true;

    if (!currentUserProfile) return null;

    return (
        <div className="bg-slate-50 min-h-screen pb-32 font-sans">
            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20 flex items-center gap-4">
                <Button variant="ghost" size="icon" className="rounded-2xl bg-slate-50 size-12 shadow-sm" onClick={() => navigate('/dashboard')}>
                    <ChevronLeft className="h-6 w-6 text-slate-900" />
                </Button>
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none text-left">Publicar</h1>
                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1 text-left italic">Elite Mobility</p>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-8">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <Card className="border-none shadow-xl rounded-[2.5rem] p-6 bg-white space-y-6">
                        <div className="flex items-center gap-3">
                            <div className="bg-emerald-50 p-2.5 rounded-xl"><Navigation size={18} className="text-emerald-600" /></div>
                            <h3 className="font-black text-slate-900 uppercase italic tracking-tighter">Itinerario</h3>
                        </div>
                        <div className="space-y-4">
                            <AddressAutocomplete label="Punto de origen" onSelect={setOrigin} icon={<div className="h-2 w-2 rounded-full bg-emerald-500" />} />
                            <AddressAutocomplete label="Punto de llegada" onSelect={setDestination} icon={<div className="h-2 w-2 rounded-full bg-primary" />} />
                        </div>
                    </Card>

                    <div className="grid grid-cols-2 gap-4">
                        <Card className="border-none shadow-lg rounded-[2rem] p-6 bg-white space-y-4 text-center">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Fecha y Hora</p>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full h-14 rounded-2xl border-slate-100 bg-slate-50 font-black text-xs uppercase tracking-tighter">
                                        {format(date, "dd MMM", { locale: es })}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="p-0 border-none shadow-2xl rounded-3xl overflow-hidden">
                                    <Calendar mode="single" selected={date} onSelect={setDate} fromDate={startOfToday()} locale={es} />
                                </PopoverContent>
                            </Popover>
                            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-14 rounded-2xl border-none bg-slate-50 font-black text-center text-lg" />
                        </Card>

                        <Card className="border-none shadow-lg rounded-[2rem] p-6 bg-white space-y-4 text-center">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Plazas y Precio</p>
                            <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-xl">
                                <button
                                    type="button"
                                    onClick={() => setSeats(Math.max(1, seats - 1))}
                                    disabled={seats <= 1}
                                    className="w-12 py-2 rounded-lg text-lg font-black text-slate-400 hover:bg-slate-200 disabled:opacity-30 transition-all"
                                >
                                    -
                                </button>
                                <div className="flex-1 text-center font-black text-xl text-slate-900">
                                    {seats}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSeats(Math.min(8, seats + 1))}
                                    disabled={seats >= 8}
                                    className="w-12 py-2 rounded-lg text-lg font-black text-slate-400 hover:bg-slate-200 disabled:opacity-30 transition-all"
                                >
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
                        <div className="flex items-center justify-between">
                            <h3 className="font-black text-slate-900 uppercase italic tracking-tighter">Opciones Elite</h3>
                            <button type="button" onClick={() => setIsWomenOnly(!isWomenOnly)} className={cn("flex items-center gap-2 px-4 py-2 rounded-full border-2 transition-all", isWomenOnly ? "bg-pink-50 border-pink-200 text-pink-600 shadow-sm shadow-pink-100" : "bg-slate-50 border-transparent text-slate-400")}>
                                <Heart size={14} className={isWomenOnly ? "fill-pink-600" : ""} />
                                <span className="text-[9px] font-black uppercase tracking-widest leading-none">Solo Mujeres</span>
                            </button>
                        </div>
                        <div className="flex gap-3">
                            <PreferenceToggle icon={Music} label="Música" active={preferences.music} onClick={() => setPreferences(p => ({ ...p, music: !p.music }))} />
                            <PreferenceToggle icon={Dog} label="Mascotas" active={preferences.pets} onClick={() => setPreferences(p => ({ ...p, pets: !p.pets }))} />
                            <PreferenceToggle icon={Baby} label="Niños" active={preferences.kids} onClick={() => setPreferences(p => ({ ...p, kids: !p.kids }))} />
                        </div>
                        <div className="pt-2 border-t border-slate-50">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Modo de Aprobación</p>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setApprovalMode('automatic')}
                                    className={cn(
                                        "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-1 text-center",
                                        approvalMode === 'automatic' ? "border-emerald-500 bg-emerald-50/50 text-emerald-700 shadow-sm" : "border-slate-50 text-slate-400 bg-slate-50/30"
                                    )}
                                >
                                    <Sparkles className={cn("h-4 w-4 mb-1", approvalMode === 'automatic' && "text-emerald-500")} />
                                    <span className="text-[10px] font-black uppercase tracking-tighter leading-none">Automática</span>
                                    <span className="text-[8px] font-medium opacity-60">Instantánea</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setApprovalMode('manual')}
                                    className={cn(
                                        "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-1 text-center",
                                        approvalMode === 'manual' ? "border-indigo-500 bg-indigo-50/50 text-indigo-700 shadow-sm" : "border-slate-50 text-slate-400 bg-slate-50/30"
                                    )}
                                >
                                    <ShieldCheck className={cn("h-4 w-4 mb-1", approvalMode === 'manual' && "text-indigo-500")} />
                                    <span className="text-[10px] font-black uppercase tracking-tighter leading-none">Manual</span>
                                    <span className="text-[8px] font-medium opacity-60">Tú eliges</span>
                                </button>
                            </div>
                        </div>
                        <Textarea placeholder="Ej: Maletero amplio, salgo puntual..." className="min-h-[100px] rounded-2xl bg-slate-50 border-none shadow-inner p-5 font-medium italic text-slate-600" value={details} onChange={(e) => setDetails(e.target.value)} />
                    </Card>

                    <div className="pt-4">
                        <Button type="submit" disabled={isSubmitting || !origin || !destination || isCalculatingRoute} className="w-full h-20 rounded-[2.2rem] bg-slate-900 hover:bg-slate-800 text-white font-black text-xl tracking-tighter shadow-2xl active:scale-95 transition-all border-none uppercase italic">
                            {isCalculatingRoute ? (
                                <>
                                    <Loader2 className="animate-spin h-6 w-6 mr-2" />
                                    Calculando Ruta...
                                </>
                            ) : isSubmitting ? (
                                <Loader2 className="animate-spin h-8 w-8" />
                            ) : (
                                <>CONTINUAR <ChevronRight size={24} className="ml-2 text-primary" /></>
                            )}
                        </Button>
                    </div>
                </form>

                <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
                    <AlertDialogContent className="rounded-3xl border-none shadow-2xl bg-white max-w-md w-[90vw]">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="font-black text-2xl uppercase italic tracking-tighter text-slate-900">Confirmar Viaje</AlertDialogTitle>
                            <div className="space-y-4 pt-4">
                                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl">
                                    <div className="flex items-center gap-3">
                                        <CalendarIcon className="h-5 w-5 text-slate-400" />
                                        <div>
                                            <p className="font-bold text-slate-900 text-sm">{format(date, "dd MMM", { locale: es })}</p>
                                            <p className="text-xs font-bold text-slate-400">{time}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-black text-xl text-emerald-600">{price}€</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">por plaza</p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex gap-2 items-start">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                                        <p className="text-xs font-bold text-slate-700">{origin?.address}</p>
                                    </div>
                                    <div className="flex gap-2 items-start">
                                        <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                                        <p className="text-xs font-bold text-slate-700">{destination?.address}</p>
                                    </div>
                                </div>
                            </div>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="gap-2 sm:gap-0 mt-6">
                            <AlertDialogCancel className="rounded-xl font-bold border-none bg-slate-50 h-12">Revisar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleConfirmPublish} disabled={isSubmitting} className="h-14 rounded-2xl bg-slate-900 text-white font-black uppercase italic tracking-tighter shadow-xl px-8">
                                {isSubmitting ? <Loader2 className="animate-spin" /> : "PUBLICAR AHORA"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </main>
        </div>
    );
};

export default CreateRide;
