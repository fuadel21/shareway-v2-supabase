import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import es from './locales/es.json';
import en from './locales/en.json';
import ar from './locales/ar.json';
import settingsExtra from './settingsExtra';
import applyRideDetailsRuntimePatch from './rideDetailsRuntimePatch';

const deepMerge = (base = {}, extra = {}) => {
    const result = { ...base };
    Object.entries(extra).forEach(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = deepMerge(base[key] || {}, value);
        } else {
            result[key] = value;
        }
    });
    return result;
};

const runRuntimePatches = (lng) => {
    window.clearTimeout(window.__sharewayRuntimeI18nTimer);
    window.__sharewayRuntimeI18nTimer = window.setTimeout(() => {
        applyRideDetailsRuntimePatch(lng);
    }, 50);
};

const applyDocumentLanguage = (lng) => {
    const normalizedLanguage = lng?.startsWith('ar') ? 'ar' : lng?.startsWith('en') ? 'en' : 'es';
    document.documentElement.lang = normalizedLanguage;
    document.documentElement.dir = normalizedLanguage === 'ar' ? 'rtl' : 'ltr';
    runRuntimePatches(normalizedLanguage);
};

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            es: { translation: deepMerge(es, settingsExtra.es) },
            en: { translation: deepMerge(en, settingsExtra.en) },
            ar: { translation: deepMerge(ar, settingsExtra.ar) }
        },
        fallbackLng: 'es',
        supportedLngs: ['es', 'en', 'ar'],
        debug: false,
        interpolation: {
            escapeValue: false // React already safes from xss
        }
    });

applyDocumentLanguage(i18n.language);
i18n.on('languageChanged', applyDocumentLanguage);

if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => runRuntimePatches(i18n.language));
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

export default i18n;
