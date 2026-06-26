const SITE_URL = 'https://www.shareway.es';

export const getReferralCode = (profile, user) => {
  const source = profile?.id || user?.id || profile?.email || user?.email || '';
  const clean = String(source).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return clean.slice(0, 8) || 'SHAREWAY';
};

export const getReferralUrl = (profile, user) => `${SITE_URL}/invite/${getReferralCode(profile, user)}`;

export const getReferralMessage = (profile, user) => {
  const url = getReferralUrl(profile, user);
  return `Únete a ShareWay para compartir coche, ahorrar en trayectos y reducir emisiones. Regístrate aquí: ${url}`;
};

export const savePendingReferralCode = (code) => {
  if (!code) return;
  try {
    window.localStorage.setItem('shareway_referral_code', String(code).toUpperCase());
  } catch (error) {
    console.warn('Referral code could not be stored', error);
  }
};

export const getPendingReferralCode = () => {
  try {
    return window.localStorage.getItem('shareway_referral_code');
  } catch (error) {
    return null;
  }
};
