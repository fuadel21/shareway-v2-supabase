import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2, ShieldOff, Car, MapPin, Navigation } from 'lucide-react';
import MapComponent from './MapComponent';
import { decodePolyline } from '@/lib/utils';

function PublicTrackingPage() {
    const { rideId } = useParams();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');

    const [ride, setRide] = useState(null);
    const [isValid, setIsValid] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!rideId || !token) {
            setError("Enlace de seguimiento inválido.");
            setIsValid(false);
            setLoading(false);
            return;
        }

        const verifyAndFetch = async () => {
            try {
                // Verificar token y obtener viaje en un solo paso si es posible, 
                // o primero verificar y luego suscribirse.
                // Supabase: Suponemos que existe una función RPC o tabla de share_tokens
                const { data, error: rpcError } = await supabase.rpc('verify_share_token', {
                    p_ride_id: rideId,
                    p_token: token
                });

                if (rpcError || !data?.success) {
                    throw new Error(data?.error || "Token inválido o expirado.");
                }

                setIsValid(true);

                // Suscribirse al viaje para obtener ubicación en tiempo real
                const fetchRide = async () => {
                    const { data: rideData, error: rideError } = await supabase
                        .from('rides')
                        .select('*, driver:profiles!driver_id(display_name, photo_url)')
                        .eq('id', rideId)
                        .single();

                    if (rideData) {
                        setRide({
                            ...rideData,
                            type: 'ride',
                            decodedPath: rideData.overview_polyline ? decodePolyline(rideData.overview_polyline) : []
                        });
                    }
                };

                fetchRide();

                const channel = supabase.channel(`tracking_${rideId}`)
                    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, (payload) => {
                        setRide(prev => ({ ...prev, ...payload.new }));
                    })
                    .subscribe();

                return () => { supabase.removeChannel(channel); };

            } catch (err) {
                setError(err.message);
                setIsValid(false);
                setLoading(false);
            } finally {
                setLoading(false);
            }
        };

        verifyAndFetch();
    }, [rideId, token]);

    if (loading) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-slate-50">
                <div className="relative">
                    <div className="h-24 w-24 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                    <Car className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 text-primary" />
                </div>
                <p className="mt-6 font-black text-primary tracking-tight animate-pulse">LOCALIZANDO VIAJE...</p>
            </div>
        );
    }

    if (error || !isValid) {
        return (
            <div className="h-screen flex flex-col items-center justify-center text-center p-8 bg-slate-50">
                <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-red-100 max-w-sm">
                    <ShieldOff className="h-20 w-20 text-red-500 mx-auto mb-6" />
                    <h2 className="text-3xl font-black text-gray-900 tracking-tight mb-4">Acceso Denegado</h2>
                    <p className="text-muted-foreground font-medium leading-relaxed">{error || "El enlace de seguimiento no es válido o ha expirado."}</p>
                    <button onClick={() => window.location.href = '/'} className="mt-8 w-full bg-primary text-white font-black h-12 rounded-2xl shadow-lg shadow-primary/20">IR A INICIO</button>
                </div>
            </div>
        );
    }

    const currentPos = ride?.driver_location ? { lat: ride.driver_location.lat, lng: ride.driver_location.lng } : null;

    return (
        <div className="h-screen w-screen relative bg-slate-100 overflow-hidden font-sans">
            {/* Header Flotante */}
            <header className="absolute top-6 left-6 right-6 z-50">
                <div className="glass h-20 rounded-[2rem] border border-white/20 shadow-2xl flex items-center px-6 gap-4">
                    <div className="bg-primary/10 p-3 rounded-2xl animate-bounce">
                        <Navigation className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-grow overflow-hidden">
                        <h1 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground mb-0.5">En camino a</h1>
                        <p className="text-lg font-black truncate tracking-tight text-gray-800">{ride?.destination?.address?.split(',')[0] || 'Destino'}</p>
                    </div>
                </div>
            </header>

            {/* Mapa Leaflet */}
            <div className="absolute inset-0 z-0">
                <MapComponent
                    center={currentPos || ride?.origin}
                    zoom={15}
                    itemsToDisplay={ride ? [ride] : []}
                    selectedItemId={ride?.id}
                />
            </div>

            {/* Card de Información Temporal */}
            <div className="absolute bottom-10 left-6 right-6 z-50">
                <div className="glass p-6 rounded-[2.5rem] border border-white/20 shadow-2xl flex items-center gap-5">
                    <div className="h-16 w-16 rounded-full bg-white shadow-inner flex items-center justify-center border-4 border-emerald-500/20 overflow-hidden">
                        {ride?.driver?.photo_url ? (
                            <img src={ride.driver.photo_url} alt="Conductor" className="h-full w-full object-cover" />
                        ) : (
                            <Car className="h-8 w-8 text-primary" />
                        )}
                    </div>
                    <div className="flex-grow">
                        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Conductor</p>
                        <p className="text-xl font-black text-gray-800 tracking-tight">{ride?.driver?.display_name || 'Conductor ShareWay'}</p>
                        <div className="flex items-center gap-1.5 mt-1 text-emerald-600 font-bold text-xs uppercase tracking-wider">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
                            Ubicación en tiempo real
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default PublicTrackingPage;
