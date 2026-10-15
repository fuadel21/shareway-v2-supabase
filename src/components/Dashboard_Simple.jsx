import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Search, Car, Loader2, Calendar, Leaf, Sparkles, Navigation, Megaphone, Languages, Clock, UserCheck, Bell, MessageSquare, Activity } from 'lucide-react';
import { searchRides, searchRequests, getAvailableRides, fulfillRequest } from '@/services/rideService';
import { calculateImpact, getImpactEquivalency, formatImpactDisplay } from '@/utils/climateImpact';
import AddressAutocomplete from './AddressAutocomplete';
import SimpleGamificationWidget from './SimpleGamificationWidget.jsx';
import { useTranslation } from 'react-i18next';

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

const decodePolyline = (encoded) => {
    if (!encoded) return [];
    let poly = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;
    while (index < len) {
        let b, shift = 0, result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        poly.push([lat * 1e-5, lng * 1e-5]);
    }
    return poly;
};

const MapController = ({ center, zoom }) => {
    const map = useMap();
    useEffect(() => {
        if (center && zoom) {
            map.setView(center, zoom);
        }
    }, [center, zoom, map]);
    return null;
};

const formatTime = (time) => {
    if (!time) return '';
    const date = new Date(time);
    return format(date, 'HH:mm', { locale: es });
};

const formatDate = (time) => {
    if (!time) return '';
    const date = new Date(time);
    return format(date, 'dd MMM', { locale: es });
};

const RideRequestItem = ({ item, isSelected, onClick, isRequest }) => {
    const { t } = useTranslation();
    const price = isRequest ? item.suggested_price : item.price;
    const seats = isRequest ? item.seats_needed : item.seats_available;
    const displayName = isRequest ? 
        (item.requester?.display_name || 'Usuario') : 
        (item.driver?.display_name || 'Conductor');
    
    return (
        <div 
            className={cn(
                "bg-white rounded-lg border border-gray-200 p-4 cursor-pointer transition-all hover:shadow-md",
                isSelected && "ring-2 ring-blue-500 shadow-lg"
            )}
            onClick={() => onClick(item)}
        >
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                        <AvatarImage src={isRequest ? item.requester?.avatar_url : item.driver?.avatar_url} />
                        <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div>
                        <h4 className="font-semibold text-sm">{displayName}</h4>
                        <p className="text-xs text-gray-500">{isRequest ? 'Solicitante' : 'Conductor'}</p>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-lg font-bold text-green-600">€{price}</div>
                    <div className="text-xs text-gray-500">{seats} plazas</div>
                </div>
            </div>
            
            <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-gray-600">Origen: {item.origin?.description || 'No especificado'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                    <span className="text-gray-600">Destino: {item.destination?.description || 'No especificado'}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{formatDate(item.departure_time)}</span>
                    <span>{formatTime(item.departure_time)}</span>
                </div>
            </div>
            
            {isSelected && (
                <div className="animate-in fade-in zoom-in duration-300">
                    <Button className={cn("w-full h-10 rounded-2xl text-white font-black text-[10px] tracking-normal uppercase italic shadow-lg", isRequest ? "bg-amber-800" : "bg-primary")} onClick={(e) => { e.stopPropagation(); onClick(item, true); }}>VER DETALLES</Button>
                </div>
            )}
        </div>
    );
};

function Dashboard() {
    const { user, profile } = useOutletContext();
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();

    // State for UI
    const [allData, setAllData] = useState([]);
    const [activeFilter, setActiveFilter] = useState('Todos');
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mapCenter, setMapCenter] = useState([40.416775, -3.703790]);
    const [zoom, setZoom] = useState(6);

    // Simplified data fetching without advanced optimizations
    const fetchData = useCallback(async () => {
        if (!user) return;
        
        setLoading(true);
        
        try {
            const marginTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
            
            // Get rides
            const rides = await getAvailableRides(user.id);
            
            // Get requests
            const { data: requests } = await supabase
                .from('ride_requests')
                .select('*, requester:profiles!requester_id(*)')
                .eq('status', 'pending')
                .neq('requester_id', user.id)
                .gte('departure_time', marginTime);

            // Combine and sort data
            const combinedData = [
                ...(rides || []).map(ride => ({ ...ride, type: 'ride' })),
                ...(requests || []).map(r => ({ ...r, type: 'request' }))
            ].sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time));
            
            setAllData(combinedData);
            
        } catch (error) {
            console.error("Dashboard Error:", error);
            toast.error("Error al cargar datos del dashboard");
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleLocateMe = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition((pos) => {
                setMapCenter([pos.coords.latitude, pos.coords.longitude]);
                setZoom(14);
                toast.success("Ubicación actualizada");
            }, () => toast.error("No se pudo obtener tu ubicación"));
        }
    };

    const handleItemClick = (item, showDetails = false) => {
        setSelectedItemId(item.id);
        if (showDetails) {
            if (item.type === 'ride') {
                navigate(`/rides/${item.id}`);
            } else {
                navigate(`/requests/${item.id}`);
            }
        }
    };

    const filteredData = useMemo(() => {
        if (activeFilter === 'Todos') return allData;
        return allData.filter(item => 
            activeFilter === 'Rides' ? item.type === 'ride' : item.type === 'request'
        );
    }, [allData, activeFilter]);

    const selectedItem = useMemo(() => 
        allData.find(item => item.id === selectedItemId), 
        [allData, selectedItemId]
    );

    const mapItems = useMemo(() => 
        filteredData.filter(item => item.origin?.coordinates && item.destination?.coordinates),
        [filteredData]
    );

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
                    <p className="text-gray-600">Cargando dashboard...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50">
            <div className="container mx-auto px-4 py-6">
                {/* Header */}
                <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 mb-2">
                                {t('dashboard.title', 'Dashboard')}
                            </h1>
                            <p className="text-gray-600">
                                {t('dashboard.subtitle', 'Encuentra tu próximo viaje compartido')}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button onClick={handleLocateMe} variant="outline" size="sm">
                                <Navigation className="w-4 h-4 mr-2" />
                                Mi Ubicación
                            </Button>
                            <Button onClick={() => navigate('/rides/new')}>
                                <Plus className="w-4 h-4 mr-2" />
                                {t('dashboard.createRide', 'Crear Viaje')}
                            </Button>
                        </div>
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex gap-2 mb-6">
                        {['Todos', 'Rides', 'Requests'].map((filter) => (
                            <Button
                                key={filter}
                                variant={activeFilter === filter ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setActiveFilter(filter)}
                                className="rounded-full"
                            >
                                {filter === 'Todos' ? t('dashboard.all', 'Todos') : 
                                 filter === 'Rides' ? t('dashboard.rides', 'Viajes') : 
                                 t('dashboard.requests', 'Solicitudes')}
                            </Button>
                        ))}
                    </div>
                </div>

                {/* Main Content */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Map */}
                    <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
                        <div className="h-96 lg:h-full min-h-[500px]">
                            <MapContainer center={mapCenter} zoom={zoom} className="h-full">
                                <TileLayer
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                />
                                <MapController center={mapCenter} zoom={zoom} />
                                
                                {mapItems.map((item) => {
                                    const originCoords = item.origin?.coordinates;
                                    const destCoords = item.destination?.coordinates;
                                    const isSelected = selectedItem?.id === item.id;
                                    
                                    if (!originCoords || !destCoords) return null;
                                    
                                    return (
                                        <React.Fragment key={item.id}>
                                            <Marker
                                                position={[originCoords.lat, originCoords.lng]}
                                                icon={item.type === 'ride' ? RIDE_ICON : REQUEST_ICON}
                                            >
                                                <Popup>
                                                    <div className="text-sm">
                                                        <p className="font-semibold">
                                                            {item.type === 'ride' ? 'Viaje' : 'Solicitud'}
                                                        </p>
                                                        <p>€{item.type === 'ride' ? item.price : item.suggested_price}</p>
                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleItemClick(item)}
                                                            className="mt-2"
                                                        >
                                                            Ver Detalles
                                                        </Button>
                                                    </div>
                                                </Popup>
                                            </Marker>
                                            
                                            {isSelected && (
                                                <Polyline
                                                    positions={[
                                                        [originCoords.lat, originCoords.lng],
                                                        [destCoords.lat, destCoords.lng]
                                                    ]}
                                                    color={item.type === 'ride' ? '#10b981' : '#92400e'}
                                                    weight={4}
                                                    opacity={0.7}
                                                />
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </MapContainer>
                        </div>
                    </div>

                    {/* List */}
                    <div className="space-y-4 max-h-[500px] overflow-y-auto">
                        {filteredData.length === 0 ? (
                            <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
                                <Car className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                    {t('dashboard.noResults', 'No se encontraron resultados')}
                                </h3>
                                <p className="text-gray-600">
                                    {t('dashboard.noResultsDesc', 'Intenta ajustar los filtros o crear un nuevo viaje')}
                                </p>
                            </div>
                        ) : (
                            filteredData.map((item) => (
                                <RideRequestItem
                                    key={item.id}
                                    item={item}
                                    isSelected={selectedItem?.id === item.id}
                                    onClick={handleItemClick}
                                    isRequest={item.type === 'request'}
                                />
                            ))
                        )}
                    </div>
                </div>

                {/* Gamification Widget */}
                <div className="mt-6">
                    <SimpleGamificationWidget userId={user?.id} />
                </div>
            </div>
        </div>
    );
}

export default Dashboard;
