import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '@/lib/growthAnalytics.js';

const GrowthPageTracker = () => {
  const location = useLocation();

  useEffect(() => {
    trackPageView({
      search: location.search || null,
      hash: location.hash || null,
    });
  }, [location.pathname, location.search, location.hash]);

  return null;
};

export default GrowthPageTracker;
