import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';
import "leaflet-defaulticon-compatibility";
import L from 'leaflet';
import { supabase } from '../lib/supabase';
import { format, isValid, isAfter, subMinutes } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Plus, Search, Car, Loader2, Calendar, Leaf, Sparkles, Navigation,
    Megaphone, Languages, Clock, UserCheck, Bell, MessageSquare,
    Activity, MapPin, ArrowRight, Star, ShieldCheck, Heart, Info
} from 'lucide-react';
import { searchRides, searchRequests, getAvailableRides, fulfillRequest } from '@/services/rideService';
import AddressAutocomplete from './AddressAutocomplete';
import { useTranslation } from 'react-i18next';
import { performanceUtils } from '@/utils/week1Optimizations';

const createCustomIcon = (color, isRequest = false) => {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: ${color}; width: 30px; height: 30px; border-radius: 50% 50% 50% 0; position: absolute; transform: rotate(-45deg); left: 50%; top: 50%; margin: -15px 0 0 -15px; border: 3px solid white; box-shadow: 0 10px 20px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center;">
            <div style="transform: rotate(45deg); color: white; font-size: 12px;">${isRequest ? '👤' : '🚗'}</div>
        </div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });
};

const RIDE_ICON = createCustomIcon('#10b981', false);
const REQUEST_ICON = createCustomIcon('#92400e', true);

function ChangeView({ center, zoom }) {
    const map = useMap();
    useEffect(() => {
        if (center && Array.isArray(center) && typeof center[0] === 'number') {
            map.setView(center, zoom || map.getZoom(), { animate: true });
        }
    }, [center, zoom]);
    return null;
}

const RideCard = ({ item, isSelected, onClick }) => {
    const isRequest = item.type === 'request';
    const profile = isRequest ? item.requester : item.driver;
    const name = profile?.display_name || profile?.full_name || 'Usuario';
    const photo = profile?.avatar_url || profile?.photo_url;

    const seatsAvailable = item.seats_available ?? (isRequest ? item.seats_needed : 0);
    const departureDate = item.departure_time ? new Date(item.departure_time) : null;
    const timeLabel = (departureDate && isValid(departureDate)) ? format(departureDate, "HH:mm") : '--:--';
    const dayLabel = (departureDate && isValid(departureDate)) ? format(departureDate, "d MMM", { locale: es }) : '';

    return (
        <div
            onClick={() => onClick(item)}
            className={cn(
                "group relative bg-white rounded-[2rem] p-4 mb-4 transition-all duration-500 cursor-pointer overflow-hidden border-2",
                isSelected ? "border-primary shadow-xl scale-[1.02] z-10" : "border-transparent hover:border-slate-100 shadow-sm"
            )}
        >
            <div className="absolute top-4 right-4 flex flex-col gap-2 items-end z-20">
                {item.is_women_only && <div className="bg-pink-500 text-white p-1.5 rounded-full shadow-lg"><Heart size={10} className="fill-white" /></div>}
                {profile?.is_verified && <div className="bg-blue-500 text-white p-1.5 rounded-full shadow-lg"><ShieldCheck size={10} /></div>}
            </div>

            <div className="flex items-center justify-between mb-4 relative z-10">
                <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12 border-2 border-white shadow-md">
                        <AvatarImage src={photo} className="object-cover" />
                        <AvatarFallback className="font-bold bg-slate-100 text-slate-400">{name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="text-left">
                        <p className="font-black text-slate-900 text-xs tracking-tight">{name}</p>
                        <span className={cn("text-[7px] font-black uppercase px-2 py-0.5 rounded-full border", isRequest ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-emerald-50 text-emerald-700 border-emerald-100")}>
                            {isRequest ? 'Solicitante' : 'Conductor'}
                        </span>
                    </div>
                </div>
                <div className="text-right">
                    <p className="font-black text-xl tracking-tighter text-primary">{item.price || item.suggested_price || 0}€</p>
                </div>
            </div>

            <div className="space-y-1 mb-4 relative z-10 bg-slate-50/50 p-3 rounded-2xl">
                <p className="text-[10px] font-bold text-slate-600 truncate uppercase">DE: {item.origin?.name || 'Origen'}</p>
                <p className="text-[10px] font-black text-slate-900 truncate uppercase italic">A: {item.destination?.name || 'Destino'}</p>
            </div>

            <div className="flex items-center justify-between pt-2 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-slate-400"><Clock size={12} /><span className="text-[9px] font-black text-slate-900">{timeLabel}</span></div>
                    <div className="flex items-center gap-1.5 text-slate-400"><Calendar size={12} /><span className="text-[9px] font-bold text-slate-400">{dayLabel}</span></div>
                </div>
                <Button
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onClick(item, true); }}
                    className="h-8 px-5 rounded-xl text-[8px] font-black tracking-widest uppercase italic bg-slate-900"
                >
                    {isRequest ? 'VER SOLICITUD' : 'VER DETALLES'}
                </Button>
            </div>
        </div>
    );
};

function Dashboard() {
    const { user, profile } = useOutletContext();
    const navigate = useNavigate();
    const { t } = useTranslation();

    const [allData, setAllData] = useState([]);
    const [activeFilter, setActiveFilter] = useState('Todos');
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mapCenter, setMapCenter] = useState([40.416775, -3.703790]);
    const [zoom, setZoom] = useState(6);

    const fetchData = useCallback(async () => {
        if (!user || !profile) return;
        setLoading(true);
        try {
            const now = new Date();
            const marginTime = subMinutes(now, 60).toISOString();

            // 1. Obtenemos viajes disponibles
            const rides = await getAvailableRides();

            // 2. Obtenemos solicitudes de pasajeros
            const { data: requests } = await supabase
                .from('ride_requests')
                .select('*, requester:profiles!requester_id(*)')
                .eq('status', 'pending')
                .gte('departure_time', marginTime);

            // FILTRADO DE GRADO INDUSTRIAL (Client Side matching)
            const filteredRides = (rides || []).filter(r => {
                const isNotMine = r.driver_id !== user.id;
                const genderShield = !r.is_women_only || profile.gender === 'female';
                const isFuture = isAfter(new Date(r.departure_time), subMinutes(new Date(), 30));
                return isNotMine && genderShield && isFuture;
            }).map(r => ({ ...r, type: 'ride' }));

            const filteredRequests = (requests || []).filter(req => {
                const isNotMine = req.requester_id !== user.id;
                // Filter out expired requests (in the past)
                const isFuture = isAfter(new Date(req.departure_time), new Date());
                // Los conductores ven las solicitudes para aceptarlas
                return isNotMine && isFuture;
            }).map(req => ({ ...req, type: 'request' }));

            const combined = [...filteredRides, ...filteredRequests].sort((a, b) =>
                new Date(a.departure_time) - new Date(b.departure_time)
            );

            setAllData(combined);
        } catch (error) {
            console.error("Dashboard Sync Error:", error);
            toast.error("Error al sincronizar mapa");
        } finally {
            setLoading(false);
        }
    }, [user, profile]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleLocateMe = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition((pos) => {
                setMapCenter([pos.coords.latitude, pos.coords.longitude]);
                setZoom(14);
                toast.success("Ubicación actualizada");
            }, () => toast.error("No se pudo obtener ubicación"));
        }
    };

    const itemsToDisplay = useMemo(() => {
        let filtered = allData || [];
        if (activeFilter === 'Viajes') filtered = filtered.filter(i => i.type === 'ride');
        if (activeFilter === 'Solicitudes') filtered = filtered.filter(i => i.type === 'request');
        if (activeFilter === 'Próximos') {
            const now = new Date();
            filtered = filtered.filter(i => isAfter(new Date(i.departure_time), now));
        }
        return filtered;
    }, [allData, activeFilter]);

    const handleCardClick = (item, forceNavigate = false) => {
        if (!item) return;
        if (forceNavigate) {
            navigate(item.type === 'request' ? `/request/${item.id}` : `/ride/${item.id}`);
            return;
        }
        setSelectedItemId(item.id);
        const coords = item.origin?.coordinates || item.origin;
        if (coords?.lat || coords?.latitude) {
            setMapCenter([coords.lat || coords.latitude, coords.lng || coords.longitude]);
            setZoom(14);
        }
    };

    if (!profile) return null;

    return (
        <div className="h-screen w-screen flex bg-slate-100 overflow-hidden font-sans text-left">
            <div className="w-[380px] bg-white border-r border-slate-100 shadow-2xl flex flex-col z-50">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-primary h-10 w-10 rounded-xl flex items-center justify-center shadow-lg"><Sparkles className="h-5 w-5 text-white" /></div>
                        <div><h2 className="text-lg font-black text-slate-900 tracking-tighter uppercase italic leading-none">ShareWay</h2><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Explorar Trayectos</p></div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-6">
                    <div className="relative z-[100]"><AddressAutocomplete label="¿A dónde vas hoy?" onSelect={(dest) => { if (dest?.coordinates) { setMapCenter([dest.coordinates.lat, dest.coordinates.lng]); setZoom(12); } }} icon={<Search className="h-4 w-4 text-slate-400" />} /></div>

                    <div className="grid grid-cols-2 gap-2">
                        <Button onClick={() => navigate('/publish')} className="h-14 rounded-2xl bg-slate-900 text-white flex flex-col items-center justify-center gap-0.5 shadow-lg active:scale-95 transition-transform"><Plus className="h-4 w-4 text-primary" /><span className="font-black text-[8px] uppercase tracking-widest italic">Ofrecer</span></Button>
                        <Button onClick={() => navigate('/request')} className="h-14 rounded-2xl bg-white text-slate-900 border-slate-100 border shadow-sm active:scale-95 transition-transform"><Megaphone className="h-4 w-4 text-amber-800" /><span className="font-black text-[8px] uppercase tracking-widest italic">Pedir</span></Button>
                    </div>

                    <div className="sticky top-0 bg-white z-20 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar border-b border-slate-50">
                        {['Todos', 'Viajes', 'Solicitudes', 'Próximos'].map((f) => (
                            <button key={f} onClick={() => setActiveFilter(f)} className={cn("px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest transition-all border whitespace-nowrap", activeFilter === f ? "bg-primary text-white border-primary shadow-md" : "bg-white text-slate-500 border-slate-100")}>{f}</button>
                        ))}
                    </div>

                    <div className="space-y-3">
                        {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary/40 h-8 w-8" /></div> : itemsToDisplay.length > 0 ? itemsToDisplay.map((item) => (
                            <RideCard key={item.id} item={item} isSelected={selectedItemId === item.id} onClick={handleCardClick} />
                        )) : <div className="text-center py-16 bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-100"><Car className="mx-auto h-10 w-10 text-slate-200 mb-2 opacity-30" /><p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Sin resultados en esta zona</p></div>}
                    </div>
                </div>
            </div>

            <div className="flex-1 relative">
                <Button onClick={handleLocateMe} className="absolute top-6 right-6 z-[1000] h-12 w-12 rounded-2xl bg-white text-slate-900 shadow-2xl border-none flex items-center justify-center hover:bg-slate-50 transition-all"><Navigation className="h-5 w-5 text-primary" /></Button>

                <MapContainer center={mapCenter} zoom={zoom} className="h-full w-full" zoomControl={false}>
                    <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
                    <ChangeView center={mapCenter} zoom={zoom} />
                    {itemsToDisplay.map((item) => {
                        const coords = item.origin?.coordinates || item.origin;
                        const lat = coords?.lat || coords?.latitude;
                        const lng = coords?.lng || coords?.longitude;
                        if (!lat || !lng) return null;
                        return (
                            <Marker key={item.id} position={[lat, lng]} icon={item.type === 'request' ? REQUEST_ICON : RIDE_ICON} eventHandlers={{ click: () => handleCardClick(item) }}>
                                <Popup><div className="p-2 text-center min-w-[100px]"><p className="font-black text-[10px] text-slate-900 mb-2 uppercase italic">{item.destination?.name || 'Destino'}</p><Button size="sm" className={cn("h-7 rounded-lg text-[8px] font-black w-full", item.type === 'request' ? "bg-amber-800" : "bg-slate-900")} onClick={() => handleCardClick(item, true)}>VER DETALLES</Button></div></Popup>
                            </Marker>
                        );
                    })}
                </MapContainer>
            </div>
        </div>
    );
}

export default Dashboard;
