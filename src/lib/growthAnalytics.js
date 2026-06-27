import { supabase } from '@/lib/supabase.js';
import { getPendingReferralCode } from '@/lib/referrals.js';

const SESSION_KEY = 'shareway_growth_session_id';

const getSessionId = () => {
  try {
    let sessionId = window.localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.localStorage.setItem(SESSION_KEY, sessionId);
    }
    return sessionId;
  } catch (error) {
    return null;
  }
};

const getUtmParams = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      source: params.get('utm_source'),
      medium: params.get('utm_medium'),
      campaign: params.get('utm_campaign'),
    };
  } catch (error) {
    return { source: null, medium: null, campaign: null };
  }
};

export const trackGrowthEvent = async (eventName, options = {}) => {
  if (!eventName) return { success: false, error: 'Missing event name' };

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id || null;
    const utm = getUtmParams();

    const payload = {
      event_name: eventName,
      user_id: userId,
      session_id: getSessionId(),
      path: options.path || window.location.pathname,
      referrer: document.referrer || null,
      source: options.source || utm.source,
      medium: options.medium || utm.medium,
      campaign: options.campaign || utm.campaign,
      referral_code: options.referralCode || getPendingReferralCode(),
      entity_type: options.entityType || null,
      entity_id: options.entityId || null,
      metadata: options.metadata || {},
    };

    const { error } = await supabase.from('growth_events').insert(payload);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.warn('[GrowthAnalytics] Event not tracked:', eventName, error);
    return { success: false, error };
  }
};

export const trackPageView = (metadata = {}) => trackGrowthEvent('page_view', { metadata });
