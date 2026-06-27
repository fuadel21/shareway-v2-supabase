import { trackGrowthEvent } from '@/lib/growthAnalytics.js';

export const trackRideCreated = (rideId, rideData = {}) => trackGrowthEvent('ride_created', {
  entityType: 'ride',
  entityId: rideId ? String(rideId) : null,
  metadata: {
    origin_address: rideData.origin?.address || rideData.origin_address || null,
    destination_address: rideData.destination?.address || rideData.destination_address || null,
    distance_km: rideData.distance || null,
    price: rideData.price || null,
    seats: rideData.seats || null,
    approval_mode: rideData.approvalMode || rideData.approval_mode || null,
    is_women_only: Boolean(rideData.isWomenOnly || rideData.is_women_only),
    has_waypoints: Array.isArray(rideData.waypoints) && rideData.waypoints.length > 0,
  }
});

export const trackBookingStarted = (rideId, metadata = {}) => trackGrowthEvent('booking_started', {
  entityType: 'ride',
  entityId: rideId ? String(rideId) : null,
  metadata,
});

export const trackBookingCompleted = (rideId, metadata = {}) => trackGrowthEvent('booking_completed', {
  entityType: 'ride',
  entityId: rideId ? String(rideId) : null,
  metadata,
});

export const trackRideShared = (rideId, method = 'unknown') => trackGrowthEvent('ride_shared', {
  entityType: 'ride',
  entityId: rideId ? String(rideId) : null,
  metadata: { method },
});
