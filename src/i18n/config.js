import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import es from './locales/es.json';
import en from './locales/en.json';
import ar from './locales/ar.json';
import settingsExtra from './settingsExtra';

const mergeTranslations = (base, extra) => ({
    ...base,
    ...extra,
    settings: {
        ...(base.settings || {}),
        ...(extra.settings || {})
    }
});

const applyDocumentLanguage = (lng) => {
    const normalizedLanguage = lng?.startsWith('ar') ? 'ar' : lng?.startsWith('en') ? 'en' : 'es';
    document.documentElement.lang = normalizedLanguage;
    document.documentElement.dir = normalizedLanguage === 'ar' ? 'rtl' : 'ltr';
};

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            es: { translation: mergeTranslations(es, settingsExtra.es) },
            en: { translation: mergeTranslations(en, settingsExtra.en) },
            ar: { translation: mergeTranslations(ar, settingsExtra.ar) }
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

export default i18n;
