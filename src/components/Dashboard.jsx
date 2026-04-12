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
    Activity, MapPin, ArrowRight, Star, ShieldCheck, Heart, Info, ChevronRight, X,
    BadgeCheck
} from 'lucide-react';
import { searchRides, searchRequests, getAvailableRides, fulfillRequest } from '@/services/rideService';
import AddressAutocomplete from './AddressAutocomplete';
import MapComponent from './MapComponent';
import { DraggableSheet } from './DraggableSheet';
import { useTranslation } from 'react-i18next';

const ImpactBadge = ({ profile }) => {
    if (!profile) return null;
    const savedKg = parseFloat(profile.total_co2_saved) || 0;

    return (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[40] pointer-events-none lg:top-24">
            <div className="bg-slate-950/80 backdrop-blur-xl border border-white/10 px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-3 animate-elite-in">
                <div className="size-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <Leaf size={16} className="text-white" />
                </div>
                <div className="text-left leading-tight">
                    <p className="text-xs font-black italic text-white tracking-widest uppercase">
                        {savedKg.toFixed(1)} <span className="text-emerald-400">KG CO₂</span>
                    </p>
                    <p className="text-[8px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-0.5">Impacto Positivo</p>
                </div>
            </div>
        </div>
    );
};



const RideCard = ({ item, isSelected, onClick }) => {
    const isRequest = item.type === 'request';
    const profile = isRequest ? item.requester : item.driver;
    const name = profile?.display_name || profile?.full_name || 'Usuario';
    const photo = profile?.avatar_url || profile?.photo_url;

    const departureDate = item.departure_time ? new Date(item.departure_time) : null;
    const timeLabel = (departureDate && isValid(departureDate)) ? format(departureDate, "HH:mm") : '--:--';
    const dayLabel = (departureDate && isValid(departureDate)) ? format(departureDate, "d MMM", { locale: es }) : '';

    return (
        <div
            onClick={() => onClick(item)}
            className={cn(
                "group relative bg-white rounded-3xl p-4 mb-3 transition-all duration-300 cursor-pointer overflow-hidden border border-slate-100 shadow-elite animate-elite-in",
                isSelected ? "ring-2 ring-primary ring-offset-1 z-10 shadow-xl" : "hover:border-slate-200"
            )}
        >
            <div className="absolute top-4 right-4 flex flex-col gap-2 items-end z-20">
                {item.is_women_only && <div className="bg-pink-500 text-white p-1.5 rounded-full shadow-lg"><Heart size={10} className="fill-white" /></div>}
                {(profile?.is_verified || profile?.verification?.status === 'verified') && (
                    <div className="bg-blue-500 text-white p-1.5 rounded-full shadow-lg"><ShieldCheck size={10} /></div>
                )}
            </div>

            <div className="flex items-center justify-between mb-4 relative z-10">
                <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12 border-2 border-white shadow-md">
                        <AvatarImage src={photo} className="object-cover" />
                        <AvatarFallback className="font-bold bg-slate-100 text-slate-400">{name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="text-left">
                        <h3 className="text-sm font-black text-slate-900 uppercase italic tracking-tighter leading-none">{profile?.display_name || 'Usuario'}</h3>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={cn("text-[9px] font-black uppercase px-2 py-0.5 rounded-full border shadow-sm", isRequest ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-emerald-50 text-emerald-700 border-emerald-100")}>
                                {isRequest ? 'Pasajero' : 'Conductor'}
                            </span>
                            {profile?.is_verified && <BadgeCheck size={14} className="text-blue-500" />}
                        </div>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-lg font-black text-primary tracking-tighter leading-none">{item.price || item.suggested_price || 0}€</p>
                </div>
            </div>

            <div className="space-y-2 py-3 border-y border-slate-50">
                <div className="flex items-center gap-3">
                    <div className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-tight truncate">{item.origin?.name || 'Origen'}</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="size-1.5 rounded-full bg-primary shrink-0" />
                    <p className="text-[11px] font-black text-slate-900 uppercase italic tracking-tight truncate">{item.destination?.name || 'Destino'}</p>
                </div>
            </div>

            <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5 text-slate-400"><Clock size={12} /><span className="text-[10px] font-black text-slate-900">{timeLabel}</span></div>
                    <div className="flex items-center gap-1.5 text-slate-400"><Calendar size={12} /><span className="text-[10px] font-bold text-slate-400">{dayLabel}</span></div>
                </div>
                <Button
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onClick(item, true); }}
                    className="h-10 px-5 rounded-xl text-[10px] font-black tracking-widest uppercase italic bg-slate-900 shadow-md transition-transform active:scale-95"
                >
                    {isRequest ? 'SOLICITUD' : 'DETALLES'}
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
    const [selectedItem, setSelectedItem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mapCenter, setMapCenter] = useState([40.416775, -3.703790]);
    const [zoom, setZoom] = useState(6);
    const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleResize = () => setIsMobile(window.innerWidth < 1024);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);


    const fetchData = useCallback(async () => {
        if (!user || !profile) return;
        setLoading(true);
        try {
            const now = new Date();
            const marginTime = subMinutes(now, 60).toISOString();

            const rides = await getAvailableRides();
            const { data: requests } = await supabase
                .from('ride_requests')
                .select('*, requester:profiles!requester_id(*)')
                .eq('status', 'pending')
                .gte('departure_time', marginTime);

            const filteredRides = (rides || []).filter(r => {
                const isNotMine = r.driver_id !== user.id;
                const genderShield = !r.is_women_only || profile.gender === 'female';
                const isFuture = isAfter(new Date(r.departure_time), subMinutes(new Date(), 30));
                return isNotMine && genderShield && isFuture;
            }).map(r => ({ ...r, type: 'ride' }));

            const filteredRequests = (requests || []).filter(req => {
                const isNotMine = req.requester_id !== user.id;
                return isNotMine;
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
        return filtered;
    }, [allData, activeFilter]);

    const handleSelection = (item, forceNavigate = false) => {
        if (!item) return;
        if (forceNavigate) {
            navigate(item.type === 'request' ? `/request/${item.id}` : `/ride/${item.id}`);
            return;
        }
        setSelectedItem(item);
        const coords = item.origin?.coordinates || item.origin;
        if (coords?.lat || coords?.latitude) {
            setMapCenter([coords.lat || coords.latitude, coords.lng || coords.longitude]);
            setZoom(13);
        }
    };

    if (!profile) return null;

    return (
        <div className="h-full w-full flex bg-slate-100 overflow-hidden font-sans text-left relative pt-14 lg:pt-16">
            {/* BADGE DE IMPACTO (Premium Look) */}
            <ImpactBadge profile={profile} />

            {/* MOBILE FLOATING SEARCH (Glassmorphism) */}
            <div className="lg:hidden absolute top-4 left-4 right-4 z-[40] animate-in slide-in-from-top duration-500">
                <div className="bg-white/70 backdrop-blur-2xl p-2 rounded-2xl border border-white/20 shadow-2xl">
                    <AddressAutocomplete 
                        label="¿A dónde vas?" 
                        onSelect={(dest) => { if (dest?.coordinates) { setMapCenter([dest.coordinates.lat, dest.coordinates.lng]); setZoom(12); } }} 
                        icon={<Search className="h-4 w-4 text-primary" />} 
                    />
                </div>
            </div>

            {/* SIDEBAR LIST */}
            <div className="hidden lg:flex w-[380px] bg-white border-r border-slate-100 shadow-2xl flex-col z-50 animate-in slide-in-from-left duration-500">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-primary h-10 w-10 rounded-xl flex items-center justify-center shadow-lg shadow-primary/20"><Sparkles className="h-5 w-5 text-white" /></div>
                        <div><h2 className="text-lg font-black text-slate-900 tracking-tighter uppercase italic leading-none">Explorar</h2><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-0.5">ShareWay Global</p></div>
                    </div>
                </div>

                {/* BOTONES DE ACCIÓN RÁPIDA (OFRECER/SOLICITAR) */}
                <div className="p-4 grid grid-cols-2 gap-3 bg-slate-50/50 border-b border-slate-100">
                    <Button
                        onClick={() => navigate('/publish')}
                        className="h-12 rounded-2xl bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest italic shadow-lg gap-2 border-none active:scale-95 transition-all"
                    >
                        <Plus size={14} className="text-primary" /> Ofrecer
                    </Button>
                    <Button
                        onClick={() => navigate('/request')}
                        className="h-12 rounded-2xl bg-white text-slate-900 font-black text-[10px] uppercase tracking-widest italic shadow-md gap-2 border border-slate-200 active:scale-95 transition-all"
                    >
                        <Megaphone size={14} className="text-secondary" /> Solicitar
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-6">
                    <div className="relative z-[100]"><AddressAutocomplete label="¿A dónde vas hoy?" onSelect={(dest) => { if (dest?.coordinates) { setMapCenter([dest.coordinates.lat, dest.coordinates.lng]); setZoom(12); } }} icon={<Search className="h-4 w-4 text-slate-400" />} /></div>

                    <div className="sticky top-0 bg-white z-20 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar border-b border-slate-50">
                        {['Todos', 'Viajes', 'Solicitudes'].map((f) => (
                            <button key={f} onClick={() => setActiveFilter(f)} className={cn("px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border whitespace-nowrap", activeFilter === f ? "bg-slate-900 text-white border-slate-900 shadow-md" : "bg-white text-slate-500 border-slate-100")}>{f}</button>
                        ))}
                    </div>

                    <div className="space-y-3">
                        {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary/40 h-8 w-8" /></div> : itemsToDisplay.length > 0 ? itemsToDisplay.map((item) => (
                            <RideCard key={item.id} item={item} isSelected={selectedItem?.id === item.id} onClick={handleSelection} />
                        )) : <div className="text-center py-16 bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-100"><Car className="mx-auto h-10 w-10 text-slate-200 mb-2 opacity-30" /><p className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Sin resultados</p></div>}
                    </div>
                </div>
            </div>

            {/* MAP AREA */}
            <div className="flex-1 relative h-full">
                <Button onClick={handleLocateMe} className="absolute top-6 right-6 z-[1000] h-12 w-12 rounded-2xl bg-white text-slate-900 shadow-2xl border-none flex items-center justify-center hover:bg-slate-50 transition-all active:scale-90"><Navigation className="h-5 w-5 text-primary" /></Button>
                
                {/* BOTONES DE ACCIÓN EN EL MAPA (MOBILE) */}
                {isMobile && (
                    <div className="absolute top-24 right-6 z-[1000] flex flex-col gap-3 animate-in fade-in zoom-in duration-500">
                        <Button
                            onClick={() => navigate('/publish')}
                            className="h-12 w-12 rounded-xl bg-slate-900 text-white shadow-2xl border-none active:scale-90 transition-all flex flex-col items-center justify-center gap-0.5"
                            size="icon"
                        >
                            <Plus className="h-5 w-5 text-primary" />
                            <span className="text-[6px] font-black uppercase tracking-tighter">Ofrecer</span>
                        </Button>
                        <Button
                            onClick={() => navigate('/request')}
                            className="h-12 w-12 rounded-xl bg-white/95 backdrop-blur-xl text-slate-900 shadow-xl border border-slate-100 active:scale-90 transition-all flex flex-col items-center justify-center gap-0.5"
                            size="icon"
                        >
                            <Megaphone className="h-5 w-5 text-amber-500" />
                            <span className="text-[6px] font-black uppercase tracking-tighter">Pedir</span>
                        </Button>
                    </div>
                )}


                {/* Render Map */}


                <MapComponent
                    center={{ lat: mapCenter[0], lng: mapCenter[1] }}
                    zoom={zoom}
                    itemsToDisplay={itemsToDisplay}
                    selectedItemId={selectedItem?.id}
                    onItemSelected={handleSelection}
                />

                {/* MOBILE / QUICK VIEW BOTTOM SHEET */}
                {isMobile && (
                    <div className="lg:hidden">
                        <DraggableSheet>
                            <div className="px-6 py-4 space-y-4 text-left">
                                {!selectedItem ? (
                                    <>
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="text-base font-black text-slate-900 uppercase italic tracking-widest">Disponibles</h3>
                                            <div className="flex gap-2">
                                                {['Todos', 'Viajes', 'Solicitudes'].map((f) => (
                                                    <button 
                                                        key={f} 
                                                        onClick={() => setActiveFilter(f)} 
                                                        className={cn("px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border shadow-sm", 
                                                        activeFilter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-400 border-slate-100")}
                                                    >
                                                        {f}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* QUICK ACTIONS ELIMINADAS DE AQUÍ PARA MOVER AL MAPA */}

                                        <div className="space-y-3 pb-20">
                                            {loading ? (
                                                <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary/40 h-8 w-8" /></div>
                                            ) : itemsToDisplay.length > 0 ? (
                                                itemsToDisplay.map((item) => (
                                                    <RideCard key={item.id} item={item} isSelected={selectedItem?.id === item.id} onClick={handleSelection} />
                                                ))
                                            ) : (
                                                <div className="text-center py-10 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-100">
                                                    <p className="text-[10px] font-black text-slate-300 uppercase italic">Sin resultados cerca</p>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="pb-10 space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-center gap-4">
                                                <Avatar className="h-16 w-16 border-4 border-white shadow-2xl">
                                                    <AvatarImage src={selectedItem.type === 'request' ? selectedItem.requester?.photo_url : selectedItem.driver?.photo_url} className="object-cover" />
                                                    <AvatarFallback className="bg-slate-900 text-white font-black text-xl">{selectedItem.type === 'request' ? selectedItem.requester?.display_name?.[0] : selectedItem.driver?.display_name?.[0]}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="text-xl font-black text-slate-900 uppercase italic tracking-tighter leading-none">
                                                            {selectedItem.type === 'request' ? selectedItem.requester?.display_name : selectedItem.driver?.display_name}
                                                        </h3>
                                                        {(selectedItem.type === 'request' ? selectedItem.requester?.is_verified : selectedItem.driver?.is_verified) && <BadgeCheck size={16} className="text-blue-500" />}
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-2">
                                                        <div className="flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-100">
                                                            <Star size={10} className="fill-amber-500 text-amber-500" />
                                                            <span className="text-[10px] font-black text-amber-700">{(selectedItem.type === 'request' ? 5.0 : (selectedItem.driver?.driver_rating || 5.0))}</span>
                                                        </div>
                                                        <span className={cn("text-[8px] font-black uppercase px-2 py-0.5 rounded-full border shadow-sm", selectedItem.type === 'request' ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-emerald-50 text-emerald-700 border-emerald-100")}>
                                                            {selectedItem.type === 'request' ? 'Pasajero' : 'Conductor'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="icon" className="rounded-full bg-slate-50 hover:bg-slate-100 h-10 w-10" onClick={() => setSelectedItem(null)}>
                                                <X size={20} className="text-slate-400" />
                                            </Button>
                                        </div>

                                        <div className="space-y-4 p-5 bg-slate-50 rounded-3xl border border-slate-100 shadow-inner">
                                            <div className="flex items-center gap-4">
                                                <div className="flex flex-col items-center gap-1">
                                                    <div className="size-2 rounded-full bg-emerald-500" />
                                                    <div className="w-0.5 h-4 bg-slate-200" />
                                                    <div className="size-2 rounded-full bg-primary" />
                                                </div>
                                                <div className="flex-1 space-y-1">
                                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{selectedItem.origin?.name || 'Origen'}</p>
                                                    <p className="text-base font-black text-slate-900 uppercase italic tracking-tight">{selectedItem.destination?.name || 'Destino'}</p>
                                                </div>
                                            </div>
                                            <div className="h-px bg-slate-100 w-full" />
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-6">
                                                    <div className="flex items-center gap-2 text-slate-500"><Clock size={16} /><span className="text-xs font-black text-slate-900">{format(new Date(selectedItem.departure_time), "HH:mm")}</span></div>
                                                    <div className="flex items-center gap-2 text-slate-500"><Calendar size={16} /><span className="text-xs font-bold text-slate-400">{format(new Date(selectedItem.departure_time), "d MMM", { locale: es })}</span></div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-3xl font-black text-primary tracking-tighter leading-none">{selectedItem.price || selectedItem.suggested_price || 0}€</p>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Precio Plaza</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex gap-3">
                                            <Button onClick={() => handleSelection(selectedItem, true)} className="flex-1 h-16 rounded-2xl bg-slate-900 text-white font-black text-sm uppercase italic tracking-widest shadow-2xl active:scale-95 transition-all">
                                                {selectedItem.type === 'request' ? 'Ver Solicitud' : 'Ver Detalles'} <ChevronRight size={20} className="ml-2 text-primary" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </DraggableSheet>
                    </div>
                )}


            </div>
        </div>
    );
}

export default Dashboard;
