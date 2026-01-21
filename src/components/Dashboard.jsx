import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';
import "leaflet-defaulticon-compatibility";
import L from 'leaflet';
import { supabase } from '../lib/supabase';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Search, Users, Car, Info, Loader2, Calendar, Star, Leaf, Sparkles, Navigation, Map as MapIcon, List as ListIcon, MapPin, Megaphone, ChevronRight, Euro, Filter, UserCheck, ShieldCheck, Sprout, Trees, Mountain } from 'lucide-react';
import { searchRides, getAvailableRides, fulfillRequest } from '@/services/rideService';
import { calculateImpact, getImpactEquivalency, formatImpactDisplay } from '@/utils/climateImpact';
import AddressAutocomplete from './AddressAutocomplete';

// Componente para centrar el mapa suavemente
function ChangeView({ center, zoom }) {
    const map = useMap();
    useEffect(() => {
        if (center && Array.isArray(center) && typeof center[0] === 'number') {
            map.setView(center, zoom || map.getZoom(), { animate: true });
        }
    }, [center, zoom, map]);
    return null;
}

const AISuggestionCard = ({ count }) => (
    <div className="bg-gradient-to-br from-indigo-600/90 to-violet-700/90 backdrop-blur-md rounded-3xl p-5 mb-6 text-white shadow-xl relative overflow-hidden group border border-white/20">
        <div className="absolute -right-4 -top-4 opacity-10 group-hover:scale-110 transition-transform duration-700">
            <Sparkles size={100} />
        </div>
        <div className="relative z-10 flex items-start gap-4">
            <div className="bg-white/20 p-2 rounded-xl">
                <Sparkles className="h-5 w-5 text-amber-300" />
            </div>
            <div className="flex-1">
                <h4 className="text-[10px] font-black tracking-[0.2em] mb-1 italic uppercase">Inteligencia Compartida</h4>
                <p className="text-xs text-indigo-50 font-medium leading-relaxed">
                    {count > 0
                        ? `Hay ${count} trayectos disponibles hoy. ¡Optimiza tu ruta y ahorra CO2!`
                        : "No hay viajes activos ahora, ¡sé el primero en publicar uno!"}
                </p>
            </div>
        </div>
    </div>
);

const RideCard = ({ item, isSelected, onClick, onAcceptRequest }) => {
    const isRequest = item.type === 'request';
    const profile = isRequest ? item.requester : item.driver;
    const name = profile?.display_name || profile?.full_name || 'Usuario';
    const photo = profile?.avatar_url || profile?.photo_url;
    const isVerified = profile?.verification?.status === 'verified';

    const impactData = useMemo(() => {
        if (!item.distance) return null;
        const distKm = parseFloat(item.distance) / 1000;
        const { savedKg } = calculateImpact(distKm, 1);
        const equivalency = getImpactEquivalency(savedKg);
        return { savedKg, equivalency, ...formatImpactDisplay(savedKg) };
    }, [item.distance]);

    const departureDate = item.departure_time ? new Date(item.departure_time) : null;
    const timeLabel = (departureDate && isValid(departureDate)) ? format(departureDate, "HH:mm") : '--:--';

    return (
        <div
            onClick={() => onClick(item)}
            className={cn(
                "group relative bg-white border border-slate-100 rounded-[2.5rem] p-5 mb-4 transition-all cursor-pointer",
                isSelected ? "ring-2 ring-primary border-transparent shadow-2xl bg-white scale-[1.02]" : "hover:shadow-xl hover:bg-white"
            )}
        >
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Avatar className="h-12 w-12 border-2 border-white shadow-md">
                            <AvatarImage src={photo} />
                            <AvatarFallback className="font-bold bg-slate-100 text-slate-400">{name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className={cn(
                            "absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-white flex items-center justify-center shadow-sm",
                            isRequest ? "bg-amber-400" : "bg-emerald-500"
                        )}>
                            {isRequest ? <UserCheck size={10} className="text-white" /> : <Car size={10} className="text-white" />}
                        </div>
                    </div>
                    <div>
                        <div className="flex items-center gap-1">
                            <p className="font-black text-slate-900 text-sm leading-none mb-1">{name}</p>
                            {isVerified && <ShieldCheck size={12} className="text-emerald-500 mb-1" />}
                            {profile?.eco_tier && profile.eco_tier !== 'Seed' && (
                                <div className={cn(
                                    "flex items-center gap-0.5 px-1.5 py-0.5 rounded-full mb-1",
                                    profile.eco_tier === 'Forest' ? "bg-emerald-100 text-emerald-800" :
                                        profile.eco_tier === 'Tree' ? "bg-green-100 text-green-700" :
                                            "bg-lime-100 text-lime-700"
                                )}>
                                    {profile.eco_tier === 'Forest' ? <Mountain size={8} /> :
                                        profile.eco_tier === 'Tree' ? <Trees size={8} /> : <Sprout size={8} />}
                                    <span className="text-[7px] font-black uppercase tracking-wider">{profile.eco_tier}</span>
                                </div>
                            )}
                        </div>
                        <span className={cn(
                            "text-[8px] font-black uppercase tracking-[0.15em] px-2 py-0.5 rounded-md",
                            isRequest ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                        )}>
                            {isRequest ? 'Busca plazas' : 'Ofrece plazas'}
                        </span>
                    </div>
                </div>
                <div className="text-right">
                    <p className="font-black text-xl text-slate-900 tracking-tighter leading-none">{item.price || item.suggested_price || 0}€</p>
                    {impactData && (
                        <div className="flex flex-col items-end mt-1">
                            <div className="flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 shadow-sm">
                                <Leaf size={8} className="text-emerald-600" />
                                <p className="text-[9px] font-black text-emerald-700 uppercase tracking-wider leading-none">
                                    -{impactData.value} {impactData.unit}
                                </p>
                            </div>
                            {isSelected && impactData.equivalency && (
                                <p className="text-[8px] text-emerald-600 font-medium italic mt-0.5 max-w-[100px] leading-tight">
                                    {impactData.equivalency}
                                </p>
                            )}
                        </div>
                    )}
                    <p className="text-[9px] font-bold text-slate-400 mt-1 uppercase tracking-widest leading-none">
                        {timeLabel}
                    </p>
                </div>
            </div>

            <div className="space-y-3 mb-4 pl-2">
                <div className="flex items-center gap-3 relative">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
                    <p className="text-[11px] font-bold text-slate-500 truncate uppercase tracking-tight">{item.origin?.address || item.origin?.name || 'Origen'}</p>
                    <div className="absolute left-1 top-3 bottom-0 w-px bg-slate-100" />
                </div>
                <div className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                    <p className="text-[11px] font-black text-slate-900 truncate uppercase tracking-tight">{item.destination?.address || item.destination?.name || 'Destino'}</p>
                </div>
            </div>

            <div className="flex gap-2">
                {isSelected && !isRequest && (
                    <Button className="flex-1 h-10 rounded-2xl bg-slate-900 text-white font-black text-[10px] tracking-widest uppercase italic shadow-lg" onClick={(e) => { e.stopPropagation(); onClick(item, true); }}>Ver Detalles</Button>
                )}

                {isRequest && (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button className="flex-1 h-10 rounded-2xl bg-primary text-white font-black text-[10px] uppercase tracking-widest italic shadow-xl" onClick={(e) => e.stopPropagation()}>ACEPTAR SOLICITUD</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="rounded-[3rem] p-8 border-none shadow-2xl">
                            <AlertDialogHeader>
                                <AlertDialogTitle className="text-2xl font-black italic tracking-tighter uppercase leading-none text-primary">ACEPTACIÓN INSTANTÁNEA</AlertDialogTitle>
                                <AlertDialogDescription className="text-slate-500 font-medium">Al aceptar, se creará el viaje oficial y se cobrarán <strong>{item.suggested_price}€</strong> del saldo de {name.split(' ')[0]} automáticamente.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="bg-slate-50 p-6 rounded-3xl space-y-4 my-4">
                                <div className="flex justify-between items-center"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ganancia estimada</span><span className="text-2xl font-black text-slate-900">{(parseFloat(item.suggested_price || 0) * 0.9).toFixed(2)}€</span></div>
                                <p className="text-[8px] text-slate-400 uppercase font-bold text-center">Incluye comisión de servicio (10%)</p>
                            </div>
                            <AlertDialogFooter className="gap-2">
                                <AlertDialogCancel className="h-14 rounded-2xl font-bold border-none bg-slate-100">CANCELAR</AlertDialogCancel>
                                <AlertDialogAction className="h-14 rounded-2xl bg-slate-900 text-white font-black italic shadow-xl shadow-slate-200" onClick={() => onAcceptRequest(item)}>CONFIRMAR Y LLEVAR</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
            </div>
        </div>
    );
};

function Dashboard() {
    const { user, profile } = useOutletContext();
    const navigate = useNavigate();

    const [allData, setAllData] = useState([]);
    const [activeFilter, setActiveFilter] = useState('Todos');
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mapCenter, setMapCenter] = useState([40.416775, -3.703790]);
    const [zoom, setZoom] = useState(6);
    const [isPanelVisible, setIsPanelVisible] = useState(true);
    const [destinationSearch, setDestinationSearch] = useState(null);

    // Elite Filters State
    const [seatsNeeded, setSeatsNeeded] = useState(1);
    const [maxPrice, setMaxPrice] = useState(50);
    const [searchRadius, setSearchRadius] = useState(20000); // 20km
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const now = new Date().toISOString();
            const rides = await getAvailableRides();
            const { data: requests } = await supabase.from('ride_requests').select('*, requester:profiles!requester_id(*)').eq('status', 'pending').neq('requester_id', user.id).gte('departure_time', now);

            setAllData([
                ...(rides || []).map(ride => ({
                    ...ride,
                    type: 'ride',
                    driver: {
                        id: ride.driver_id,
                        display_name: ride.driver_display_name,
                        photo_url: ride.driver_photo_url,
                        rating: ride.driver_rating,
                        eco_tier: ride.driver_eco_tier,
                        verification: { status: ride.driver_verified }
                    }
                })),
                ...(requests || []).map(r => ({ ...r, type: 'request' }))
            ].sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time)));
        } catch (error) {
            console.error("⛔ Dashboard Fetch Error:", error);
            toast.error("Error al sincronizar datos del mapa");
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchData();

        // REALTIME: Sync changes in rides
        const channel = supabase
            .channel('dashboard-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, (payload) => {
                setAllData(prev => prev.map(item => {
                    if (item.type === 'ride' && item.id === payload.new?.id) {
                        return { ...item, ...payload.new };
                    }
                    return item;
                }));
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [fetchData]);

    const handleSearch = async (destination, forcedFilters = {}) => {
        const filters = {
            seats: forcedFilters.seats || seatsNeeded,
            price: forcedFilters.price || maxPrice,
            radius: forcedFilters.radius || searchRadius
        };

        setDestinationSearch(destination);
        if (!destination || !destination.coordinates) {
            fetchData();
            return;
        }

        setLoading(true);
        try {
            const originObj = { lat: mapCenter[0], lng: mapCenter[1] };
            const destObj = {
                lat: destination.coordinates.lat || destination.coordinates.latitude,
                lng: destination.coordinates.lng || destination.coordinates.longitude
            };

            const results = await searchRides({
                origin: originObj,
                destination: destObj,
                date: null,
                seats: filters.seats,
                maxPrice: filters.price,
                radius: filters.radius
            });
            setAllData(results);
            setMapCenter([destObj.lat, destObj.lng]);
            setZoom(11);
        } catch (e) {
            console.error(e);
            toast.error("Error al buscar viajes");
        } finally {
            setLoading(false);
        }
    };

    const itemsToDisplay = useMemo(() => {
        let filtered = allData || [];
        if (activeFilter === 'Viajes') filtered = filtered.filter(i => i.type === 'ride');
        if (activeFilter === 'Solicitudes') filtered = filtered.filter(i => i.type === 'request');
        return filtered;
    }, [allData, activeFilter]);

    const handleCardClick = (item, forceNavigate = false) => {
        if (!item) return;
        if (forceNavigate) { navigate(`/ride/${item.id}`); return; }
        setSelectedItemId(item.id);
        const coords = item.origin?.coordinates || item.origin;
        if (coords) {
            const lat = coords.latitude || coords.lat;
            const lng = coords.longitude || coords.lng;
            if (lat && lng) { setMapCenter([lat, lng]); setZoom(14); }
        }
    };

    const handleAcceptRequest = async (request) => {
        const toastId = toast.loading("Procesando aceptación...");
        try {
            const newRideId = await fulfillRequest(request);
            toast.success("¡Viaje creado!", { id: toastId });
            navigate(`/ride/${newRideId}`);
        } catch (error) {
            toast.error("Error al procesar", { id: toastId, description: error.message });
        }
    };

    if (!profile) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-primary h-10 w-10 opacity-20" /></div>;

    return (
        <div className="h-full w-full relative bg-slate-100 overflow-hidden">
            <div className="absolute inset-0 z-0">
                <MapContainer center={mapCenter} zoom={zoom} className="h-full w-full" zoomControl={false}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <ChangeView center={mapCenter} zoom={zoom} />
                    {itemsToDisplay.map((item) => {
                        const coords = item.origin?.coordinates || item.origin;
                        const lat = coords?.lat || coords?.latitude;
                        const lng = coords?.lng || coords?.longitude;
                        if (!lat || !lng) return null;
                        const key = `${item.type}-${item.id}`;
                        return (
                            <Marker key={key} position={[lat, lng]} eventHandlers={{ click: () => handleCardClick(item) }}>
                                <Popup className="premium-popup">
                                    <div className="p-3 text-center min-w-[120px]">
                                        <p className="font-black text-[10px] text-slate-900 mb-2 truncate uppercase italic">{item.destination?.address || item.destination?.name}</p>
                                        <Button size="sm" className="h-8 rounded-xl bg-slate-900 text-[9px] font-black w-full uppercase italic" onClick={() => handleCardClick(item, true)}>VER DETALLES</Button>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}
                </MapContainer>
            </div>

            <div className={cn("absolute top-0 left-0 bottom-0 w-full max-w-[420px] z-10 transition-all duration-700 ease-in-out transform", isPanelVisible ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0")}>
                <div className="h-full flex flex-col bg-white border-r border-slate-100 shadow-2xl overflow-hidden">
                    <div className="p-8 pb-4 space-y-6">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="bg-primary h-12 w-12 rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
                                <Sparkles className="h-6 w-6 text-white" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">ShareWay</h2>
                                <p className="text-[10px] font-black text-slate-400 tracking-[0.2em] uppercase mt-1 italic">Elite Mobility</p>
                            </div>
                        </div>

                        <div className="relative group z-50">
                            <AddressAutocomplete
                                label="¿Cuál es tu destino?"
                                onSelect={handleSearch}
                                icon={<Search className="h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors" />}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <Button onClick={() => navigate('/publish')} className="h-16 rounded-[1.5rem] bg-slate-900 text-white shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex flex-col items-center justify-center gap-1 border-none group"><Plus className="h-4 w-4 text-primary group-hover:rotate-90 transition-transform" /><span className="font-black text-[9px] uppercase tracking-widest italic">Ofrecer</span></Button>
                            <Button onClick={() => navigate('/request')} className="h-16 rounded-[1.5rem] bg-white text-slate-900 border-slate-100 hover:bg-slate-50 hover:scale-[1.02] active:scale-95 transition-all flex flex-col items-center justify-center gap-1 border shadow-sm group"><Megaphone className="h-4 w-4 text-amber-500 group-hover:scale-110 transition-transform" /><span className="font-black text-[9px] uppercase tracking-widest italic">Pedir</span></Button>
                        </div>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pt-2 items-center">
                            {['Todos', 'Viajes', 'Solicitudes'].map((f) => (
                                <button key={f} onClick={() => setActiveFilter(f)} className={cn("px-6 py-2.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all border whitespace-nowrap italic", activeFilter === f ? "bg-primary text-white border-primary shadow-lg" : "bg-white text-slate-500 border-slate-100 hover:border-slate-200")}>{f}</button>
                            ))}
                            <button
                                onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                                className={cn(
                                    "p-2.5 rounded-full border transition-all flex items-center justify-center min-w-[40px]",
                                    isFilterPanelOpen ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-100 text-slate-400"
                                )}
                            >
                                <Filter size={14} />
                            </button>
                        </div>

                        {isFilterPanelOpen && (
                            <div className="bg-slate-50/80 backdrop-blur-sm rounded-3xl p-5 space-y-4 border border-slate-100 animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest pl-1">Plazas de interés</label>
                                        <div className="flex items-center bg-white rounded-xl border border-slate-100 overflow-hidden h-10">
                                            <button onClick={() => { setSeatsNeeded(Math.max(1, seatsNeeded - 1)); if (destinationSearch) handleSearch(destinationSearch, { seats: Math.max(1, seatsNeeded - 1) }); }} className="px-3 h-full hover:bg-slate-50">-</button>
                                            <span className="flex-1 text-center text-xs font-bold">{seatsNeeded}</span>
                                            <button onClick={() => { setSeatsNeeded(Math.min(8, seatsNeeded + 1)); if (destinationSearch) handleSearch(destinationSearch, { seats: Math.min(8, seatsNeeded + 1) }); }} className="px-3 h-full hover:bg-slate-50">+</button>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest pl-1">Precio máx.</label>
                                        <div className="flex items-center bg-white rounded-xl border border-slate-100 px-3 h-10 gap-2">
                                            <Euro size={12} className="text-primary" />
                                            <input
                                                type="number"
                                                value={maxPrice}
                                                onChange={(e) => { setMaxPrice(e.target.value); if (destinationSearch) handleSearch(destinationSearch, { price: e.target.value }); }}
                                                className="w-full text-xs font-bold bg-transparent border-none outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center px-1">
                                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Radio de búsqueda</label>
                                        <span className="text-[10px] font-black text-primary uppercase italic">{searchRadius / 1000}km</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="5000"
                                        max="50000"
                                        step="5000"
                                        value={searchRadius}
                                        onChange={(e) => { setSearchRadius(e.target.value); if (destinationSearch) handleSearch(destinationSearch, { radius: e.target.value }); }}
                                        className="w-full accent-primary h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 overflow-y-auto px-8 pb-8 pt-2 custom-scrollbar space-y-4">
                        <AISuggestionCard count={itemsToDisplay.length} />
                        <div className="flex items-center justify-between mb-4 px-1"><h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic opacity-50">Explorar Comunidad</h3><Filter size={12} className="text-slate-300" /></div>
                        {loading ? (<div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary/40 h-8 w-8" /></div>) : itemsToDisplay.length > 0 ? (itemsToDisplay.map((item) => (<RideCard key={`${item.type}-${item.id}`} item={item} isSelected={selectedItemId === item.id} onClick={handleCardClick} onAcceptRequest={handleAcceptRequest} />))) : (<div className="text-center py-16 bg-slate-50/50 rounded-[2.5rem] border-2 border-dashed border-slate-100"><Car className="mx-auto h-12 w-12 text-slate-200 mb-3 opacity-30" /><p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic">Sin resultados cercanos</p></div>)}
                    </div>
                </div>
            </div>

            <button onClick={() => setIsPanelVisible(!isPanelVisible)} className={cn("absolute top-1/2 -translate-y-1/2 z-50 h-12 w-12 bg-white rounded-full shadow-2xl border border-slate-100 flex items-center justify-center active:scale-90 transition-all lg:flex hidden", isPanelVisible ? "left-[396px]" : "left-4")}>
                <ChevronRight className={cn("h-6 w-6 text-slate-400 transition-transform duration-500", isPanelVisible ? "rotate-180" : "rotate-0")} />
            </button>
            <div className="absolute top-10 right-10 z-[1000]"><Button className="h-14 w-14 rounded-2xl bg-white/80 backdrop-blur-xl text-slate-900 shadow-2xl active:scale-90 transition-all border-none" size="icon" onClick={() => { if (navigator.geolocation) { navigator.geolocation.getCurrentPosition((pos) => { setMapCenter([pos.coords.latitude, pos.coords.longitude]); setZoom(14); }); } }}><Navigation className="h-5 w-5 text-primary" /></Button></div>
        </div>
    );
}

export default Dashboard;
