import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const mapContainerStyle = { height: '100%', width: '100%' };
const mapOptions = {
    disableDefaultUI: true,
    zoomControl: true,
};

const LiveTrackingMap = ({ rideId, initialPosition }) => {
    const { mapsLoaded, mapsLoadError } = useOutletContext();
    const [driverLocation, setDriverLocation] = useState(initialPosition ? { lat: initialPosition.lat, lng: initialPosition.lng, heading: 0 } : null);
    const mapRef = useRef(null);

    const carIcon = useMemo(() => {
        if (mapsLoaded) {
            return {
                url: 'https://cdn-icons-png.flaticon.com/512/3774/3774270.png',
                scaledSize: new window.google.maps.Size(40, 40),
                anchor: new window.google.maps.Point(20, 20),
            };
        }
        return null;
    }, [mapsLoaded]);

    useEffect(() => {
        if (!rideId) return;

        const channel = supabase.channel(`ride_location_${rideId}`)
            .on('postgres_changes', 
                { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` },
                (payload) => {
                    const newLocation = payload.new.current_location;
                    if (newLocation) {
                        setDriverLocation({ lat: newLocation.latitude, lng: newLocation.longitude, heading: newLocation.heading || 0 });
                        if (mapRef.current) {
                            mapRef.current.panTo({ lat: newLocation.latitude, lng: newLocation.longitude });
                        }
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [rideId]);

    const onMapLoad = (map) => {
        mapRef.current = map;
    };

    if (mapsLoadError) return <p>Error al cargar el mapa.</p>;
    if (!mapsLoaded || !driverLocation) return <div className="flex items-center justify-center h-full bg-gray-200"><p>Esperando ubicación del conductor...</p></div>;

    const rotatedCarIcon = useMemo(() => {
        if (carIcon) {
            return {
                ...carIcon,
                rotation: driverLocation.heading
            };
        }
        return null;
    }, [carIcon, driverLocation.heading]);

    return (
        <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={{ lat: driverLocation.lat, lng: driverLocation.lng }}
            zoom={16}
            options={mapOptions}
            onLoad={onMapLoad}
        >
           {rotatedCarIcon && <MarkerF 
                position={{ lat: driverLocation.lat, lng: driverLocation.lng }} 
                icon={rotatedCarIcon}
            />}
        </GoogleMap>
    );
};

export default LiveTrackingMap;
