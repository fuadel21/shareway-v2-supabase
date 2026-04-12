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
import { Plus, Search, Users, Car, Info, Loader2, Calendar, Star, Leaf, Sparkles, Navigation, Map as MapIcon, List as ListIcon, MapPin, Megaphone, ChevronRight, Euro, Filter, UserCheck, ShieldCheck, Sprout, Trees, Mountain, Languages } from 'lucide-react';
import { searchRides, getAvailableRides, fulfillRequest } from '@/services/rideService';
import { calculateImpact, getImpactEquivalency, formatImpactDisplay } from '@/utils/climateImpact';
import AddressAutocomplete from './AddressAutocomplete';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';

// Componente para centrar el mapa suavemente
function ChangeView({ center, zoom }) {
    const map = useMap();
    useEffect(() => {
        if (center && Array.isArray(center) && typeof center[0] === 'number') {
            map.setView(center, zoom || map.getZoom(), { animate: true });
        }
    }, [center, zoom]);
    return null;
}

const ImpactBadge = ({ profile }) => {
    if (!profile) return null;
    const savedKg = parseFloat(profile.total_co2_saved) || 0;

    return (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] pointer-events-none">
            <div className="bg-slate-950/90 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full shadow-2xl flex items-center gap-2">
                <div className="size-5 bg-emerald-500 rounded-full flex items-center justify-center">
                    <Leaf size={10} className="text-white" />
                </div>
                <div className="text-left leading-none">
                    <p className="text-[8px] font-black italic text-white tracking-widest uppercase">
                        {savedKg.toFixed(1)} <span className="text-emerald-400">KG CO₂</span>
                    </p>
                </div>
            </div>
        </div>
    );
};

const AISuggestionCard = ({ count }) => {
    const { t } = useTranslation();
    const message = count > 0
        ? t('dashboard.ai_suggestion_active', { count }).replace('{{count}}', count)
        : t('dashboard.ai_suggestion_empty');

    return (
        <div className="bg-gradient-to-br from-indigo-600/90 to-violet-700/90 backdrop-blur-md rounded-2xl p-3 mb-3 text-white shadow-xl relative overflow-hidden">
            <div className="flex items-start gap-2 text-left">
                <div className="bg-white/20 p-1.5 rounded-lg">
                    <Sparkles className="h-3 w-3 text-amber-300" />
                </div>
                <div className="flex-1">
                    <h4 className="text-[8px] font-black tracking-wider mb-0.5 italic uppercase">{t('coming_soon.lab_title')}</h4>
                    <p className="text-[10px] text-indigo-50 font-medium leading-snug">
                        {message}
                    </p>
                </div>
            </div>
        </div>
    );
};

const RideCard = ({ item, isSelected, onClick, onAcceptRequest }) => {
    const { t } = useTranslation();
    const isRequest = item.type === 'request';
    const profile = isRequest ? item.requester : item.driver;
    const name = profile?.display_name || profile?.full_name || t('edit_profile.fields.display_name');
    const photo = profile?.avatar_url || profile?.photo_url;
    const isVerified = profile?.verification?.status === 'verified';

    const impactData = useMemo(() => {
        if (!item.distance) return null;
        const distKm = parseFloat(item.distance) / 1000;
        const { savedKg } = calculateImpact(distKm, 1);
        return formatImpactDisplay(savedKg);
    }, [item.distance]);

    const departureDate = item.departure_time ? new Date(item.departure_time) : null;
    const timeLabel = (departureDate && isValid(departureDate)) ? format(departureDate, "HH:mm") : '--:--';

    return (
        <div
            onClick={() => onClick(item)}
            className={cn(
                "relative bg-white border rounded-2xl p-3 mb-2.5 transition-all cursor-pointer text-left active:scale-[0.98]",
                isSelected ? "ring-2 ring-primary border-transparent shadow-xl" : "border-slate-100 shadow-sm"
            )}
        >
            <div className="flex items-start justify-between mb-2.5">
                <div className="flex items-center gap-2.5">
                    <div className="relative">
                        <Avatar className="h-10 w-10 border-2 border-white shadow">
                            <AvatarImage src={photo} />
                            <AvatarFallback className="font-bold bg-slate-100 text-slate-400 text-xs">{name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-white flex items-center justify-center",
                            isRequest ? "bg-amber-400" : "bg-emerald-500"
                        )}>
                            {isRequest ? <UserCheck size={8} className="text-white" /> : <Car size={8} className="text-white" />}
                        </div>
                    </div>
                    <div className="text-left flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                            <p className="font-black text-slate-900 text-xs leading-none mb-0.5 truncate">{name}</p>
                            {isVerified && <ShieldCheck size={10} className="text-emerald-500 flex-shrink-0" />}
                        </div>
                        <span className={cn(
                            "text-[7px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded inline-block",
                            isRequest ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
                        )}>
                            {isRequest ? t('dashboard.seek_seats').toUpperCase() : t('dashboard.offer_seats').toUpperCase()}
                        </span>
                    </div>
                </div>
                <div className="text-right flex-shrink-0">
                    <p className="font-black text-base text-slate-900 tracking-tighter leading-none">{item.price || item.suggested_price || 0}€</p>
                    <p className="text-[7px] font-bold text-slate-400 mt-0.5 uppercase tracking-wide">{timeLabel}</p>
                </div>
            </div>

            <div className="space-y-2 mb-2.5 pl-1 text-left">
                <div className="flex items-start gap-2 relative">
                    <div className="flex flex-col items-center flex-shrink-0">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <div className="w-px h-4 bg-slate-200 my-0.5" />
                        <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                        <p className="text-[9px] font-bold text-slate-500 truncate uppercase">{item.origin?.address || item.origin?.name || t('my_rides.no_upcoming').split(' ')[4]}</p>
                        <p className="text-[9px] font-black text-slate-900 truncate uppercase">{item.destination?.address || item.destination?.name || t('my_rides.no_upcoming').split(' ')[4]}</p>
                    </div>
                    {impactData && (
                        <div className="ml-2 px-2 py-1 bg-emerald-50 rounded-lg border border-emerald-100 flex flex-col items-center justify-center min-w-[50px] flex-shrink-0">
                            <Leaf size={9} className="text-emerald-500 mb-0.5" />
                            <span className="text-[7px] font-black text-emerald-700 leading-none">{impactData.value}</span>
                            <span className="text-[6px] font-bold text-emerald-400 uppercase">{impactData.unit}</span>
                        </div>
                    )}
                </div>
            </div>

            {isSelected && (
                <div className="animate-in fade-in zoom-in duration-200 mt-1">
                    {!isRequest ? (
                        <Button
                            className="w-full h-11 rounded-xl bg-slate-900 text-white font-black text-xs tracking-widest uppercase shadow-lg"
                            onClick={(e) => { e.stopPropagation(); onClick(item, true); }}
                        >
                            {t('dashboard.view_details')}
                        </Button>
                    ) : (
                        <Button
                            className="w-full h-11 rounded-xl bg-primary text-white font-black text-xs uppercase tracking-widest shadow-xl"
                            onClick={(e) => { e.stopPropagation(); onAcceptRequest(item); }}
                        >
                            {t('dashboard.accept_request')}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
};

function Dashboard() {
    const { user, profile } = useOutletContext();
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();

    const [allData, setAllData] = useState([]);
    const [activeFilter, setActiveFilter] = useState('Todos');
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mapCenter, setMapCenter] = useState([40.416775, -3.703790]);
    const [zoom, setZoom] = useState(6);
    const [isPanelVisible, setIsPanelVisible] = useState(false);
    const [destinationSearch, setDestinationSearch] = useState(null);


    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const now = new Date().toISOString();
            const rides = await getAvailableRides();
            const { data: requests } = await supabase.from('ride_requests').select('*, requester:profiles!requester_id(*)').eq('status', 'pending').neq('requester_id', user.id).gte('departure_time', now);

            setAllData([
                ...(rides || []).map(ride => ({ ...ride, type: 'ride' })),
                ...(requests || []).map(r => ({ ...r, type: 'request' }))
            ].sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time)));
        } catch (error) {
            console.error("🛡️ Sync Error:", error);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSearchSelect = (destination) => {
        if (!destination) {
            setDestinationSearch(null);
            fetchData();
            return;
        }
        handleSearch(destination);
    };

    const handleSearch = async (destination) => {
        setDestinationSearch(destination);
        if (!destination?.coordinates) return;

        setLoading(true);
        try {
            const destObj = {
                lat: destination.coordinates.lat || destination.coordinates.latitude,
                lng: destination.coordinates.lng || destination.coordinates.longitude
            };

            const results = await searchRides({
                origin: { lat: mapCenter[0], lng: mapCenter[1] },
                destination: destObj,
                radius: 20000
            });
            setAllData(results);
            setMapCenter([destObj.lat, destObj.lng]);
            setZoom(11);
        } catch (e) {
            toast.error("Error en búsqueda");
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
        const toastId = toast.loading("Procesando...");
        try {
            const newRideId = await fulfillRequest(request);
            toast.success("¡Viaje creado!", { id: toastId });
            navigate(`/ride/${newRideId}`);
        } catch (error) {
            toast.error("Error", { id: toastId, description: error.message });
        }
    };

    if (!profile) return null;

    return (
        <div className="h-full w-full relative bg-slate-100 overflow-hidden font-sans">
            {/* MAPA DE FONDO */}
            <div className="absolute inset-0 z-0">
                <MapContainer center={mapCenter} zoom={zoom} className="h-full w-full" zoomControl={false}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <ChangeView center={mapCenter} zoom={zoom} />
                    {itemsToDisplay.map((item) => {
                        const coords = item.origin?.coordinates || item.origin;
                        const lat = coords?.lat || coords?.latitude;
                        const lng = coords?.lng || coords?.longitude;
                        if (!lat || !lng) return null;
                        return (
                            <Marker key={`marker-${item.type}-${item.id}`} position={[lat, lng]} eventHandlers={{ click: () => handleCardClick(item) }}>
                                <Popup>
                                    <div className="p-2 text-center min-w-[100px]">
                                        <p className="font-black text-[9px] text-slate-900 mb-1.5 uppercase truncate">{item.destination?.name || 'Destino'}</p>
                                        <Button size="sm" className="h-6 rounded-lg bg-slate-900 text-[7px] font-black w-full" onClick={() => handleCardClick(item, true)}>VER</Button>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}
                </MapContainer>
            </div>

            {/* BOTTOM SHEET */}
            <div className={cn(
                "absolute bottom-0 left-0 right-0 z-[60] transition-transform duration-300 ease-out",
                isPanelVisible ? "translate-y-0" : "translate-y-[calc(100%-60px)]"
            )}>
                <div className="h-[75vh] flex flex-col bg-white shadow-2xl overflow-hidden rounded-t-3xl">
                    {/* Handle */}
                    <div
                        className="w-full py-2.5 flex items-center justify-center cursor-pointer active:bg-slate-50"
                        onClick={() => setIsPanelVisible(!isPanelVisible)}
                    >
                        <div className="w-10 h-1 bg-slate-300 rounded-full" />
                    </div>

                    <div className="px-4 pb-2.5 space-y-2.5 text-left">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="bg-primary h-9 w-9 rounded-xl flex items-center justify-center shadow-lg">
                                    <Sparkles className="h-4 w-4 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black text-slate-900 tracking-tighter uppercase italic leading-none">ShareWay</h2>
                                    <p className="text-[7px] font-black text-slate-400 tracking-widest uppercase mt-0.5">{t('dashboard.explore_community')}</p>
                                </div>
                            </div>
                            <LanguageSwitcher />
                        </div>

                        <div className="relative z-[100]">
                            <AddressAutocomplete
                                label={t('dashboard.search_label')}
                                onSelect={handleSearchSelect}
                                icon={<Search className="h-4 w-4 text-slate-400" />}
                            />
                        </div>

                        <div className="flex gap-2 overflow-x-auto no-scrollbar">
                            {['Todos', 'Viajes', 'Solicitudes'].map((f) => {
                                const filterKey = f === 'Todos' ? 'filter_all' : f === 'Viajes' ? 'filter_rides' : 'filter_requests';
                                return (
                                    <button
                                        key={f}
                                        onClick={() => setActiveFilter(f)}
                                        className={cn(
                                            "px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all border whitespace-nowrap min-h-[36px]",
                                            activeFilter === f ? "bg-primary text-white border-primary shadow-md" : "bg-white text-slate-500 border-slate-200"
                                        )}
                                    >
                                        {t(`dashboard.${filterKey}`)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-4 pb-6 pt-1 space-y-2 text-left">
                        <AISuggestionCard count={itemsToDisplay.length} />
                        {loading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="animate-spin text-primary/40 h-7 w-7" />
                            </div>
                        ) : itemsToDisplay.length > 0 ? (
                            itemsToDisplay.map((item) => (
                                <RideCard
                                    key={item.id}
                                    item={item}
                                    isSelected={selectedItemId === item.id}
                                    onClick={handleCardClick}
                                    onAcceptRequest={handleAcceptRequest}
                                />
                            ))
                        ) : (
                            <div className="text-center py-12 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-100">
                                <Car className="mx-auto h-8 w-8 text-slate-200 mb-2 opacity-30" />
                                <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">{t('dashboard.no_results')}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* CONTROLES DEL MAPA (DENTRO DEL MAPA) */}
            <div className="absolute top-20 right-4 z-[1000] flex flex-col gap-3">
                <Button
                    onClick={() => navigate('/publish')}
                    className="h-12 w-12 rounded-xl bg-slate-900 text-white shadow-2xl border-none active:scale-90 transition-all flex flex-col items-center justify-center gap-0.5"
                    size="icon"
                    title={t('nav.publish_ride')}
                >
                    <Plus className="h-5 w-5 text-primary" />
                    <span className="text-[6px] font-black uppercase tracking-tighter">Ofrecer</span>
                </Button>
                
                <Button
                    onClick={() => navigate('/request')}
                    className="h-12 w-12 rounded-xl bg-white/95 backdrop-blur-xl text-slate-900 shadow-xl border border-slate-100 active:scale-90 transition-all flex flex-col items-center justify-center gap-0.5"
                    size="icon"
                    title={t('nav.request_ride')}
                >
                    <Megaphone className="h-5 w-5 text-amber-500" />
                    <span className="text-[6px] font-black uppercase tracking-tighter">Pedir</span>
                </Button>
            </div>

            {/* BOTÓN MI UBICACIÓN */}
            <div className="absolute top-4 right-4 z-[1000]">
                <Button
                    className="h-11 w-11 rounded-xl bg-white/95 backdrop-blur-xl text-slate-900 shadow-xl border-none active:scale-90 transition-transform"
                    size="icon"
                    onClick={() => {
                        if (navigator.geolocation) {
                            navigator.geolocation.getCurrentPosition((pos) => {
                                setMapCenter([pos.coords.latitude, pos.coords.longitude]);
                                setZoom(14);
                            });
                        }
                    }}
                >
                    <Navigation className="h-5 w-5 text-primary" />
                </Button>
            </div>

            {/* BADGE DE IMPACTO */}
            <ImpactBadge profile={profile} />
        </div>
    );
}

export default Dashboard;
