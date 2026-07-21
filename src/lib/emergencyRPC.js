import { supabase } from './supabase';
import { safeCall } from './supabaseRPC';

export const triggerEmergencyAlertV2 = (rideId, currentLocation, metadata = {}) =>
  safeCall(() => supabase.rpc('trigger_emergency_alert_v2', {
    p_ride_id: rideId,
    p_current_location: currentLocation,
    p_metadata: metadata,
  }), 'trigger_emergency_alert_v2');
