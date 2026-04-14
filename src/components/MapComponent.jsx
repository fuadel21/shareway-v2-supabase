import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents, ZoomControl } from 'react-leaflet';
import * as L from 'leaflet';
import { cn } from '@/lib/utils';
import 'leaflet/dist/leaflet.css';
import polyline from '@mapbox/polyline';

// --- Iconos de Coche Personalizados (SVG) ---
const createCarIcon = (color, isSelected = false) => {
    const size = isSelected ? 48 : 36;
    return new L.DivIcon({
        html: `
            <div style="position: relative; display: flex; align-items: center; justify-content: center; width: ${size}px; height: ${size}px;">
                <!-- Efecto de Sombra/Pulso -->
                <div style="
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    background-color: ${color};
                    border-radius: 50%;
                    opacity: 0.2;
                    filter: blur(8px);
                    animation: car-pulse 2s infinite;
                "></div>
                <!-- SVG del Coche -->
                <div style="
                    position: relative;
                    z-index: 10;
                    width: ${size - 10}px;
                    height: ${size - 10}px;
                    background-color: white;
                    border: 2.5px solid ${color};
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                ">
                    <svg width="70%" height="70%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M19 17h1a1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1V16a1 1 0 0 0 1 1h1m14 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm-3-6 1.34-3.348A2 2 0 0 1 7.191 6.5H16.81a2 2 0 0 1 1.85 1.152L20 11H4z" 
                              stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>
                <!-- Indicador de Dirección (Triángulo pequeño abajo) -->
                <div style="
                    position: absolute;
                    bottom: -4px;
                    width: 0;
                    height: 0;
                    border-left: 6px solid transparent;
                    border-right: 6px solid transparent;
                    border-top: 6px solid ${color};
                    z-index: 5;
                "></div>
            </div>
            <style>
                @keyframes car-pulse {
                    0% { transform: scale(0.9); opacity: 0.3; }
                    50% { transform: scale(1.3); opacity: 0.1; }
                    100% { transform: scale(0.9); opacity: 0.3; }
                }
            </style>
        `,
        className: 'custom-car-icon',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
    });
};

const createLiveIcon = (photoUrl) => new L.DivIcon({
    html: `
        <div style="position: relative; display: flex; align-items: center; justify-content: center;">
            <div style="
                position: absolute;
                width: 44px;
                height: 44px;
                background-color: #10b981;
                border-radius: 50%;
                opacity: 0.2;
                filter: blur(8px);
                animation: pulse-live 1.5s infinite;
            "></div>
            <div style="
                width: 32px;
                height: 32px;
                background-color: white;
                border: 3px solid #10b981;
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.2);
                position: relative;
                z-index: 10;
                overflow: hidden;
                display: flex; align-items: center; justify-content: center;">
                <img src="${photoUrl || 'https://api.dicebear.com/7.x/avataaars/svg?seed=driver'}" 
                    style="width: 100%; height: 100%; object-fit: cover;" 
                    onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=fallback'"
                />
            </div>
            <div style="
                position: absolute;
                bottom: -4px;
                right: -4px;
                width: 14px;
                height: 14px;
                background-color: #10b981;
                border: 2px solid white;
                border-radius: 50%;
                z-index: 20;
            "></div>
        </div>
        <style>
            @keyframes pulse-live {
                0% { transform: scale(1); opacity: 0.5; }
                50% { transform: scale(1.6); opacity: 0; }
                100% { transform: scale(1); opacity: 0.5; }
            }
        </style>
    `,
    className: 'live-leaflet-icon',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
});

function MapUpdater({ center, zoom, follow }) {
    const map = useMap();

    useEffect(() => {
        // --- Solución Crítica: Invalidad tamaño para forzar renderizado ---
        const timer = setTimeout(() => {
            map.invalidateSize();
        }, 100);

        const handleResize = () => map.invalidateSize();
        window.addEventListener('resize', handleResize);

        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', handleResize);
        };
    }, [map]);

    useEffect(() => {
        const container = map.getContainer();
        if (!container) return; 
        if (center && typeof center.lat === 'number' && typeof center.lng === 'number') {
            const options = follow ? { duration: 1.5, animate: true } : { duration: 2, easeLinearity: 0.25 };
            try {
                map.flyTo([center.lat, center.lng], zoom || map.getZoom(), options);
            } catch (e) {
                console.warn("🛡️ stability: Map animation interrupted", e);
            }
        }
    }, [center, zoom, map, follow]);
    return null;
}

function MapEvents({ onClick }) {
    useMapEvents({
        click: (e) => {
            if (onClick && e.latlng) onClick(e.latlng);
        },
    });
    return null;
}

const MapComponent = ({ center, zoom, userLocation, itemsToDisplay, onMapClick, onItemSelected, selectedItemId, followLocation, pickupLocation }) => {
    const defaultCenter = useMemo(() => ({ lat: 40.416775, lng: -3.703790 }), []); // Madrid

    const carIcons = useMemo(() => ({
        ride: createCarIcon('#10b981'),      // Verde para Viajes (Ofertados)
        request: createCarIcon('#f59e0b'),   // Amarillo para Solicitudes (Pedidas)
        selected: createCarIcon('#ef4444', true), // Rojo para Seleccionado
    }), []);

    const userIcon = useMemo(() => new L.DivIcon({
        html: `<div style="width: 12px; height: 12px; background: #6366f1; border: 2.5px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(99,102,241,0.5);"></div>`,
        className: 'user-location-icon',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    }), []);

    const toLatLng = (obj) => {
        if (!obj) return null;
        const lat = parseFloat(obj.lat || obj.latitude || obj.coordinates?.lat || obj.coordinates?.latitude || 0);
        const lng = parseFloat(obj.lng || obj.longitude || obj.coordinates?.lng || obj.coordinates?.longitude || 0);
        return (lat === 0 && lng === 0) ? null : [lat, lng];
    };

    const normalizedCenter = useMemo(() => {
        if (!center) return defaultCenter;
        const coords = toLatLng(center);
        return coords ? { lat: coords[0], lng: coords[1] } : defaultCenter;
    }, [center, defaultCenter]);

    // Lógica para decodificar polylines y renderizar rutas
    const renderRoutes = useMemo(() => {
        return (itemsToDisplay || []).filter(i => i.overview_polyline).map(item => {
            try {
                const points = polyline.decode(item.overview_polyline);
                const isSelected = item.id === selectedItemId;
                return (
                    <Polyline
                        key={`route-${item.id}`}
                        positions={points}
                        pathOptions={{
                            color: item.type === 'request' ? '#f59e0b' : '#10b981',
                            weight: isSelected ? 6 : 3,
                            opacity: isSelected ? 0.8 : 0.3,
                            lineJoin: 'round',
                            dashArray: item.type === 'request' ? '10, 10' : null // Línea discontinua para peticiones
                        }}
                    />
                );
            } catch (e) {
                return null;
            }
        });
    }, [itemsToDisplay, selectedItemId]);

    return (
        <div className="w-full h-full relative overflow-hidden bg-slate-900 rounded-inherit">
            <MapContainer
                center={[normalizedCenter.lat, normalizedCenter.lng]}
                zoom={zoom || 6}
                scrollWheelZoom={true}
                className="w-full h-full grayscale-[0.1] contrast-[1.1] brightness-[0.95]"
                zoomControl={false}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                />

                <MapUpdater center={normalizedCenter} zoom={zoom} follow={followLocation} />
                <MapEvents onClick={onMapClick} />
                <ZoomControl position="bottomright" />

                {userLocation && (
                    <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon} />
                )}

                {pickupLocation && (
                    <Marker position={[pickupLocation.lat, pickupLocation.lng]} icon={carIcons.selected} />
                )}

                {renderRoutes}

                {(itemsToDisplay || []).map((item) => {
                    const isSelected = item.id === selectedItemId;

                    if (item.type === 'live-location') {
                        const coords = toLatLng(item.current_location);
                        if (!coords) return null;
                        return (
                            <Marker
                                key={`live-${item.id}`}
                                position={coords}
                                icon={createLiveIcon(item.driver_photo_url)}
                                zIndexOffset={1000}
                            />
                        );
                    }

                    const originCoords = toLatLng(item.origin);
                    if (!originCoords) return null;

                    const icon = isSelected ? carIcons.selected : (item.type === 'request' ? carIcons.request : carIcons.ride);

                    return (
                        <Marker
                            key={`marker-${item.id}`}
                            position={originCoords}
                            icon={icon}
                            eventHandlers={{
                                click: () => {
                                    if (onItemSelected) onItemSelected(item);
                                }
                            }}
                        />
                    );
                })}
            </MapContainer>
            <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-black/5" />
        </div>
    );
};

export default MapComponent;
