import React, { useMemo, useState, useEffect } from 'react';
import { useOutletContext, Link, useLocation } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { Loader2, Calendar, Handshake, ShieldCheck, Package, Box, FileText, Euro, MapPin, Zap } from 'lucide-react';
import SubPageHeader from './SubPageHeader';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import MapComponent from './MapComponent';
import { getAvailableRides } from '../services/rideService';
import { cn } from '@/lib/utils';

const ItemCard = ({ item }) => {
    const isRide = item.type === 'ride';
    const dateObj = new Date(item.departure_time || item.dateTime);
    const safeDate = isValid(dateObj) ? format(dateObj, "d MMM, HH:mm", { locale: es }) : "Fecha pendiente";
    
    return (
        <Link to={`/ride/${item.id}`}>
            <Card className="p-5 hover:shadow-xl transition-all border-slate-100 group relative overflow-hidden bg-white">
                <div className="flex justify-between items-start relative z-10">
                    <div className="flex gap-4 min-w-0">
                        <div className="h-12 w-12 rounded-2xl bg-slate-50 flex items-center justify-center shrink-0 border border-slate-100 group-hover:bg-primary/10 transition-colors">
                            {isRide ? <Zap className="size-5 text-primary" /> : <Handshake className="size-5 text-indigo-500" />}
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-black text-slate-900 text-sm uppercase italic tracking-tighter truncate">
                                {item.origin?.name || 'Origen'} → {item.destination?.name || 'Destino'}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                                <Calendar className="size-3 text-slate-400" />
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{safeDate}</p>
                            </div>
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        <p className="font-black text-lg text-primary italic tracking-tighter">{item.price || item.suggested_price}€</p>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">por plaza</p>
                    </div>
                </div>
            </Card>
        </Link>
    );
};

const PackageItemCard = ({ item }) => {
    const sizeIcons = {
        small: <FileText className="size-5" />,
        medium: <Package className="size-5" />,
        large: <Box className="size-5" />
    };

    const deliveryDate = item.delivery_by ? new Date(item.delivery_by) : null;
    const safeDelivery = (deliveryDate && isValid(deliveryDate)) ? format(deliveryDate, "d MMM yyyy", { locale: es }) : "Pendiente";

    return (
        <Card className="p-5 hover:shadow-xl transition-all border-slate-100 bg-white group">
            <div className="flex justify-between items-start">
                <div className="flex items-start gap-4 min-w-0">
                    <div className="size-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100">
                        {sizeIcons[item.size] || <Package className="size-5" />}
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-black text-slate-900 text-sm uppercase italic tracking-tighter truncate">
                            Paquete: {item.origin_address?.split(',')[0]} → {item.destination_address?.split(',')[0]}
                        </h3>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Límite: {safeDelivery}</p>
                        <p className="text-xs text-slate-500 mt-2 italic line-clamp-1">"{item.description || 'Sin descripción'}"</p>
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <p className="font-black text-lg text-emerald-600 italic tracking-tighter">{parseFloat(item.price || 0).toFixed(2)}€</p>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{item.size}</p>
                </div>
            </div>
        </Card>
    );
};

const ExplorePage = () => {
    const { profile, userLocation, loadingData, rides: contextRides, rideRequests: contextRequests, packages: contextPackages } = useOutletContext();
    const location = useLocation();
    const [showWomenOnly, setShowWomenOnly] = useState(false);
    const [publishedRides, setPublishedRides] = useState([]);
    const [isLoadingLocal, setIsLoadingLocal] = useState(false);

    useEffect(() => {
        const fetchRides = async () => {
            setIsLoadingLocal(true);
            try {
                const data = await getAvailableRides();
                // Normalización de coordenadas para el Mapa
                const items = (data || []).map(ride => ({
                    ...ride,
                    type: 'ride',
                    originCoords: ride.origin?.coordinates || { lat: ride.origin?.lat, lng: ride.origin?.lng },
                    destinationCoords: ride.destination?.coordinates || { lat: ride.destination?.lat, lng: ride.destination?.lng }
                }));
                setPublishedRides(items);
            } catch (error) {
                console.error("Explore fetch error:", error);
            } finally {
                setIsLoadingLocal(false);
            }
        };
        fetchRides();
    }, []);

    const defaultTab = useMemo(() => {
        const params = new URLSearchParams(location.search);
        return params.get('filter') || 'upcoming';
    }, [location.search]);

    const filteredItems = useMemo(() => {
        const allRides = contextRides || [];
        const allRequests = contextRequests || [];
        
        let filteredRides = allRides;
        if (showWomenOnly) {
            filteredRides = allRides.filter(r => r.is_women_only);
        }

        return {
            upcoming: filteredRides.filter(r => r.status === 'scheduled'),
            ongoing: filteredRides.filter(r => r.status === 'active'),
            requests: allRequests.filter(r => r.status === 'pending'),
            all: [...filteredRides, ...allRequests]
        };
    }, [contextRides, contextRequests, showWomenOnly]);

    if (loadingData || isLoadingLocal) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Escaneando Rutas...</p>
            </div>
        );
    }

    const renderList = (list, listName, component) => {
        if (!list || list.length === 0) {
            return (
                <div className="text-center py-20 bg-white rounded-[2.5rem] border border-dashed border-slate-200">
                    <p className="text-xs font-black text-slate-300 uppercase tracking-widest italic">No hay {listName} disponibles</p>
                </div>
            );
        }
        const ItemComponent = component;
        return (
            <div className="space-y-4">
                {list.map(item => <ItemComponent key={item.id} item={item} />)}
            </div>
        );
    };

    return (
        <div className="max-w-4xl mx-auto px-4 pb-32 pt-6 font-sans">
            <header className="mb-8">
                <h1 className="text-4xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">Explorar</h1>
                <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-2">ShareWay Mobility Network</p>
            </header>

            <Card className="rounded-[2.5rem] overflow-hidden shadow-2xl border-none h-80 mb-8 relative group">
                <MapComponent 
                    userLocation={userLocation}
                    itemsToDisplay={publishedRides} 
                />
                <div className="absolute top-4 right-4 z-10">
                    <div className="bg-white/80 backdrop-blur-md px-4 py-2 rounded-full border border-white shadow-lg">
                        <p className="text-[10px] font-black text-slate-900 uppercase tracking-tighter italic flex items-center gap-2">
                            <div className="size-2 bg-emerald-500 rounded-full animate-pulse" /> {publishedRides.length} Viajes activos
                        </p>
                    </div>
                </div>
            </Card>

            <Tabs defaultValue={defaultTab} className="w-full space-y-8">
                <div className="overflow-x-auto no-scrollbar pb-2">
                    <TabsList className="bg-white p-1.5 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/50 inline-flex min-w-full sm:min-w-0">
                        <TabsTrigger value="upcoming" className="rounded-full px-6 font-black text-[10px] uppercase tracking-widest">Próximos</TabsTrigger>
                        <TabsTrigger value="ongoing" className="rounded-full px-6 font-black text-[10px] uppercase tracking-widest">En Curso</TabsTrigger>
                        <TabsTrigger value="requests" className="rounded-full px-6 font-black text-[10px] uppercase tracking-widest">Solicitudes</TabsTrigger>
                        <TabsTrigger value="packages" className="rounded-full px-6 font-black text-[10px] uppercase tracking-widest">Envíos</TabsTrigger>
                        <TabsTrigger value="all" className="rounded-full px-6 font-black text-[10px] uppercase tracking-widest">Todos</TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                        <Switch id="women-only" checked={showWomenOnly} onCheckedChange={setShowWomenOnly} disabled={profile?.gender !== 'female'} />
                        <Label htmlFor="women-only" className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Solo Mujeres</Label>
                    </div>
                    <div className="bg-slate-100 h-px flex-1 mx-6 opacity-50" />
                </div>

                <TabsContent value="upcoming" className="outline-none animate-in fade-in duration-500">
                    {renderList(filteredItems.upcoming, "viajes próximos", ItemCard)}
                </TabsContent>
                <TabsContent value="ongoing" className="outline-none animate-in fade-in duration-500">
                    {renderList(filteredItems.ongoing, "viajes en curso", ItemCard)}
                </TabsContent>
                <TabsContent value="requests" className="outline-none animate-in fade-in duration-500">
                    {renderList(filteredItems.requests, "solicitudes de pasajeros", ItemCard)}
                </TabsContent>
                <TabsContent value="packages" className="outline-none animate-in fade-in duration-500">
                    {renderList(contextPackages, "envíos de paquetes", PackageItemCard)}
                </TabsContent>
                <TabsContent value="all" className="outline-none animate-in fade-in duration-500">
                    {renderList(filteredItems.all, "trayectos", ItemCard)}
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default ExplorePage;
