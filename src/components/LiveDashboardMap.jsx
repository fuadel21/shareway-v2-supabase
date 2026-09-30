import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { GoogleMap, MarkerF, Polyline } from '@react-google-maps/api';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Loader2, Car } from 'lucide-react';

const mapContainerStyle = { height: '100%', width: '100%' };
const mapOptions = { disableDefaultUI: true, zoomControl: true, streetViewControl: false, mapTypeControl: false, fullscreenControl: false, zoomControlOptions: { position: 3 } };
const SPAIN_CENTER = { lat: 40.416775, lng: -3.703790 };
const toLatLng = (coords) => {
    if (!coords) return null;
    const lat = Number(coords.lat ?? coords.latitude);
    const lng = Number(coords.lng ?? coords.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const ItemCard = ({ item, navigate, isSelected, onClick }) => {
    const { origin, destination, departure_time, id, passenger_ids, seats_total, price } = item;
    const linkTo = item.type === 'ride' ? `/ride/${id}` : `/request-details/${id}`;
    const formattedTime = departure_time ? format(new Date(departure_time), "HH:mm", { locale: es }) : '';
    const formattedDate = departure_time ? format(new Date(departure_time), "dd 'de' MMMM", { locale: es }) : 'Fecha no disp.';
    const isRide = item.type === 'ride';
    const passengersCount = passenger_ids?.length || 0;

    return (
        <div 
            className={cn(
                "bg-white border rounded-lg p-4 mb-3 shadow-sm cursor-pointer hover:shadow-md transition-all",
                isSelected && "border-primary shadow-lg ring-2 ring-primary"
            )}
            onClick={onClick}
        >
           {/* ... Resto del JSX de ItemCard ... */}
        </div>
    );
};

function LiveDashboardMap() {
    const { user, mapsLoaded, mapsLoadError } = useOutletContext();
    const navigate = useNavigate();
    
    const [allRides, setAllRides] = useState([]);
    const [allRequests, setAllRequests] = useState([]);
    const [decodedPaths, setDecodedPaths] = useState({});
    const [searchTerm, setSearchTerm] = useState("");
    const [activeFilter, setActiveFilter] = useState('Próximos');
    const [isPanelExpanded, setIsPanelExpanded] = useState(true);
    const [userLocation, setUserLocation] = useState(null);
    const [selectedItemId, setSelectedItemId] = useState(null);
    const mapRef = useRef(null);

    useEffect(() => {
        if (user) {
            navigator.geolocation.getCurrentPosition(
                (position) => setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude }),
                () => console.warn("No se pudo obtener la ubicación del usuario."),
                { enableHighAccuracy: false, timeout: 10000 }
            );
        }
    }, [user]);

    useEffect(() => {
        if (!mapsLoaded) return;

        const fetchInitialData = async () => {
            // Never select public.rides directly here. The RPC returns only the
            // route, lifecycle state, driver public identity, and live location.
            const { data: ridesData, error: ridesError } = await supabase
                .rpc('get_live_ride_map');

            if (ridesError) toast.error("Error al cargar los viajes.");
            else setAllRides((ridesData || []).map(r => ({ ...r, type: 'ride' })));

            const { data: requestsData, error: requestsError } = await supabase
                .from('ride_requests')
                .select('*')
                .eq('status', 'pending');

            if (requestsError) toast.error("Error al cargar las solicitudes.");
            else setAllRequests((requestsData || []).map(r => ({ ...r, type: 'request' })));
        };

        fetchInitialData();
        // Realtime events are filtered by RLS, so an unrelated user's ride may
        // not emit a row to this session. Poll the curated read model as well.
        const refreshInterval = window.setInterval(fetchInitialData, 15000);

        const requestsChannel = supabase.channel('public:ride_requests')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests' }, () => {
                fetchInitialData();
            })
            .subscribe();

        return () => {
            window.clearInterval(refreshInterval);
            supabase.removeChannel(requestsChannel);
        };
    }, [mapsLoaded]);

    const itemsToDisplay = useMemo(() => {
        if (!user?.id) return [];
        let items;
        switch (activeFilter) {
            case 'Próximos':
                items = allRides.filter(r => r.driver_id !== user.id && r.status === 'scheduled');
                break;
            case 'En curso':
                items = allRides.filter(r => r.driver_id !== user.id && r.status === 'in_progress');
                break;
            case 'Solicitudes':
                items = allRequests.filter(req => req.requester_id !== user.id);
                break;
            default:
                items = [
                    ...allRides.filter(r => r.driver_id !== user.id),
                    ...allRequests.filter(req => req.requester_id !== user.id)
                ];
                break;
        }
        return searchTerm
            ? items.filter(i => (i.origin?.address?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || (i.destination?.address?.toLowerCase() || '').includes(searchTerm.toLowerCase()))
            : items;
    }, [allRides, allRequests, searchTerm, activeFilter, user?.id]);

    const onMapLoad = useCallback((map) => (mapRef.current = map), []);

    if (mapsLoadError) return <div className="h-full w-full flex items-center justify-center text-red-500">Error al cargar los mapas.</div>;
    
    return (
        <div className="w-full h-full relative overflow-hidden">
            {!mapsLoaded ? (
                <div className="h-full w-full flex items-center justify-center bg-muted"><Loader2 className="h-8 w-8 animate-spin"/> <span className="ml-3">Cargando mapa...</span></div>
            ) : (
                <GoogleMap mapContainerStyle={mapContainerStyle} center={SPAIN_CENTER} zoom={6} options={mapOptions} onLoad={onMapLoad} onClick={() => setSelectedItemId(null)} >
                    {userLocation && <MarkerF position={userLocation} />}
                    {itemsToDisplay.map(item => {
                        if (item.type === 'ride' && item.overview_polyline) {
                             try {
                                const path = window.google.maps.geometry.encoding.decodePath(item.overview_polyline);
                                const isSelected = item.id === selectedItemId;
                                const livePosition = toLatLng(item.current_location);
                                return (
                                    <React.Fragment key={`ride-${item.id}`}>
                                        {livePosition && <MarkerF position={livePosition} onClick={() => setSelectedItemId(item.id)} />}
                                        <Polyline path={path} options={{ strokeColor: isSelected ? '#FF5733' : '#00A3FF', strokeOpacity: isSelected ? 1.0 : 0.4, strokeWeight: 8, zIndex: isSelected ? 99 : 50 }} onClick={() => setSelectedItemId(item.id)} />
                                    </React.Fragment>
                                );
                            } catch(e) { return null; }
                        } else if (item.type === 'request') {
                            return <MarkerF key={`request-${item.id}`} position={toLatLng(item.origin.coordinates)} onClick={() => setSelectedItemId(item.id)} />
                        }
                        return null;
                    })}
                </GoogleMap>
            )}
            
            <div className={cn("absolute bottom-0 left-0 right-0 z-20 pt-4 bg-background rounded-t-2xl shadow-[0_-4px_16px_rgba(0,0,0,0.1)]", "transition-transform duration-300 ease-in-out", isPanelExpanded ? "translate-y-0" : "translate-y-[calc(100%-100px)]")}>
                  <div className="h-[calc(50vh-220px)] min-h-[150px] overflow-y-auto pr-1">
                        {itemsToDisplay.length > 0 ? itemsToDisplay.map(item => (
                            <ItemCard 
                                key={item.id} 
                                item={item} 
                                navigate={navigate} 
                                isSelected={item.id === selectedItemId} 
                                onClick={() => setSelectedItemId(item.id)} 
                            />
                        )) : <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground"><Car className="w-12 h-12 mb-4"/><p>No hay viajes que coincidan.</p></div>}
                    </div>
            </div>
        </div>
    );
}

export default LiveDashboardMap;
