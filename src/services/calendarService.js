import { format } from 'date-fns';
import { supabase } from '@/lib/supabase.js';

export const getLocalDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return format(date, 'yyyy-MM-dd');
};

const normalizeRide = (ride, userId) => ({
  id: ride.id,
  type: 'ride',
  role: String(ride.driver_id) === String(userId) ? 'driver' : 'passenger',
  title: `${ride.origin_address || ride.origin?.name || 'Origen'} → ${ride.destination_address || ride.destination?.name || 'Destino'}`,
  origin: ride.origin_address || ride.origin?.name || ride.origin?.address || 'Origen',
  destination: ride.destination_address || ride.destination?.name || ride.destination?.address || 'Destino',
  startsAt: ride.departure_time,
  status: ride.status || 'scheduled',
  price: ride.price || 0,
  seats: ride.total_seats || ride.seats || ride.seats_available || 1,
  actionUrl: `/ride/${ride.id}`,
  raw: ride,
});

const normalizeRequest = (request) => ({
  id: request.id,
  type: 'request',
  role: 'passenger',
  title: `${request.origin?.name || request.origin?.address || 'Origen'} → ${request.destination?.name || request.destination?.address || 'Destino'}`,
  origin: request.origin?.name || request.origin?.address || 'Origen',
  destination: request.destination?.name || request.destination?.address || 'Destino',
  startsAt: request.departure_time,
  status: request.status || 'active',
  price: request.suggested_price || 0,
  seats: request.requested_seats || request.seats_needed || 1,
  actionUrl: `/request/${request.id}`,
  raw: request,
});

export const getTripCalendarEvents = async (userId, { from, to } = {}) => {
  if (!userId) return [];

  const startDate = from || new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString();
  const endDate = to || new Date(new Date().getFullYear(), new Date().getMonth() + 3, 0).toISOString();

  const [drivingRes, passengerRes, requestsRes] = await Promise.all([
    supabase
      .from('rides')
      .select('*')
      .eq('driver_id', userId)
      .gte('departure_time', startDate)
      .lte('departure_time', endDate)
      .order('departure_time', { ascending: true }),
    supabase
      .from('rides')
      .select('*')
      .contains('participant_ids', [userId])
      .gte('departure_time', startDate)
      .lte('departure_time', endDate)
      .order('departure_time', { ascending: true }),
    supabase
      .from('ride_requests')
      .select('*')
      .eq('requester_id', userId)
      .gte('departure_time', startDate)
      .lte('departure_time', endDate)
      .order('departure_time', { ascending: true }),
  ]);

  const errors = [drivingRes.error, passengerRes.error, requestsRes.error].filter(Boolean);
  if (errors.length) throw errors[0];

  const ridesMap = new Map();
  [...(drivingRes.data || []), ...(passengerRes.data || [])].forEach((ride) => {
    ridesMap.set(ride.id, normalizeRide(ride, userId));
  });

  const requests = (requestsRes.data || []).map(normalizeRequest);

  return [...ridesMap.values(), ...requests]
    .filter((event) => event.startsAt)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
};

export const groupEventsByDate = (events = []) => events.reduce((acc, event) => {
  const key = getLocalDateKey(event.startsAt);
  if (!key) return acc;
  if (!acc[key]) acc[key] = [];
  acc[key].push(event);
  return acc;
}, {});

export const getUpcomingEvents = (events = [], limit = 6) => {
  const now = new Date();
  return events
    .filter((event) => new Date(event.startsAt) >= now)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .slice(0, limit);
};