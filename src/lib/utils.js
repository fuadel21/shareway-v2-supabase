import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Helper para decodificar polilíneas de Google/OSRM sin depender del SDK de Google Maps
export function decodePolyline(str, precision = 5) {
  if (!str) return [];
  let index = 0,
    lat = 0,
    lng = 0,
    coordinates = [],
    shift = 0,
    result = 0,
    byte = null,
    latitude_change,
    longitude_change,
    factor = Math.pow(10, precision);

  while (index < str.length) {
    byte = null;
    shift = 0;
    result = 0;

    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = result = 0;

    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

    lat += latitude_change;
    lng += longitude_change;

    coordinates.push({ lat: lat / factor, lng: lng / factor });
  }

  return coordinates;
}

/**
 * Calcula la distancia entre dos puntos en la tierra usando la fórmula Haversine (en KM)
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const coordinates = [lat1, lon1, lat2, lon2].map(Number);
  if (coordinates.some((value) => !Number.isFinite(value))) return 0;

  const [safeLat1, safeLon1, safeLat2, safeLon2] = coordinates;
  if (safeLat1 < -90 || safeLat1 > 90 || safeLat2 < -90 || safeLat2 > 90
    || safeLon1 < -180 || safeLon1 > 180 || safeLon2 < -180 || safeLon2 > 180) return 0;
  const R = 6371; // Radio de la Tierra en km
  const dLat = (safeLat2 - safeLat1) * Math.PI / 180;
  const dLon = (safeLon2 - safeLon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(safeLat1 * Math.PI / 180) * Math.cos(safeLat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
