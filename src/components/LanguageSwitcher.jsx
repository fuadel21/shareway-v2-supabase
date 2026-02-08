import React from 'react';
import { useTranslation } from 'react-i18next';

const LanguageSwitcher = () => {
    const { i18n } = useTranslation();

    const changeLanguage = (lng) => {
        i18n.changeLanguage(lng);
    };

    return (
        <div className="flex items-center gap-2 p-2 bg-white/50 backdrop-blur rounded-full shadow-sm border border-slate-200">
            <button
                onClick={() => changeLanguage('es')}
                className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${i18n.language.startsWith('es')
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'text-slate-500 hover:bg-slate-200'
                    }`}
            >
                ES
            </button>
            <button
                onClick={() => changeLanguage('en')}
                className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${i18n.language.startsWith('en')
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'text-slate-500 hover:bg-slate-200'
                    }`}
            >
                EN
            </button>
        </div>
    );
};

export default LanguageSwitcher;
