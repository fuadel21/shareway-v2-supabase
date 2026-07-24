const NAVIGATION_EVENT = 'shareway:navigation';
let installed = false;

export const installNavigationEvents = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  for (const method of ['pushState', 'replaceState']) {
    const original = window.history[method];
    window.history[method] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(NAVIGATION_EVENT));
      return result;
    };
  }
};

export const subscribeToNavigation = (listener) => {
  installNavigationEvents();
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATION_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATION_EVENT, listener);
  };
};
