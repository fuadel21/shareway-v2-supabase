import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents, ZoomControl } from 'react-leaflet';
import * as L from 'leaflet';
import { cn } from '@/lib/utils';
import 'leaflet/dist/leaflet.css';

// --- Iconos Personalizados Premium memorizados para evitar re-instanciación masiva ---
const createCustomIcon = (color, isSelected = false) => new L.DivIcon({
    html: `
        <div style="position: relative; display: flex; align-items: center; justify-content: center;">
            <div style="
                position: absolute;
                width: ${isSelected ? '32px' : '20px'};
                height: ${isSelected ? '32px' : '20px'};
                background-color: ${color};
                border-radius: 50%;
                opacity: 0.3;
                filter: blur(8px);
                animation: pulse 2s infinite;
            "></div>
            <div style="
                width: ${isSelected ? '16px' : '10px'};
                height: ${isSelected ? '16px' : '10px'};
                background-color: ${color};
                border: 2px solid white;
                border-radius: 50%;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                position: relative;
                z-index: 10;
                transition: all 0.3s ease;
            "></div>
        </div>
        <style>
            @keyframes pulse {
                0% { transform: scale(1); opacity: 0.3; }
                50% { transform: scale(1.8); opacity: 0.1; }
                100% { transform: scale(1); opacity: 0.3; }
            }
        </style>
    `,
    className: 'custom-leaflet-icon',
    iconSize: [isSelected ? 32 : 20, isSelected ? 32 : 20],
    iconAnchor: [isSelected ? 16 : 10, isSelected ? 16 : 10],
});

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
                display: flex;
                align-items: center;
                justify-content: center;
            ">
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

// Componente para manejar cambios de centro y zoom de forma suave y segura
function MapUpdater({ center, zoom, follow }) {
    const map = useMap();
    useEffect(() => {
        const container = map.getContainer();
        if (!container) return; // BLINDAJE: Evitar llamadas sobre mapas desmontados

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

// Capturar clicks en el mapa con validación de existencia
function MapEvents({ onClick }) {
    useMapEvents({
        click: (e) => {
            if (onClick && e.latlng) onClick(e.latlng);
        },
    });
    return null;
}

const MapComponent = ({ center, zoom, userLocation, itemsToDisplay, onMapClick, selectedItemId, followLocation }) => {
    const defaultCenter = useMemo(() => ({ lat: 40.416775, lng: -3.703790 }), []); // Madrid

    const staticIcons = useMemo(() => ({
        user: createCustomIcon('#6366f1'),
        scheduled: createCustomIcon('#818cf8'),
        active: createCustomIcon('#10b981'),
        request: createCustomIcon('#f59e0b'),
        selected: createCustomIcon('#ef4444', true),
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

    return (
        <div className="w-full h-full relative overflow-hidden bg-slate-100 rounded-inherit">
            <MapContainer
                center={[normalizedCenter.lat, normalizedCenter.lng]}
                zoom={zoom || 6}
                scrollWheelZoom={true}
                className="w-full h-full grayscale-[0.2] contrast-[1.1] brightness-[0.95]"
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
                    <Marker position={[userLocation.lat, userLocation.lng]} icon={staticIcons.user} />
                )}

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
                    const isRideActive = item.status === 'active' || item.status === 'in_progress';
                    
                    if (!originCoords) return null;

                    return (
                        <Marker
                            key={`marker-${item.id}`}
                            position={originCoords}
                            icon={isSelected ? staticIcons.selected : (item.type === 'ride' ? (isRideActive ? staticIcons.active : staticIcons.scheduled) : staticIcons.request)}
                        />
                    );
                })}
            </MapContainer>
            <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-black/5" />
        </div>
    );
};

export default MapComponent;
