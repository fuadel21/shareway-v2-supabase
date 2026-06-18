import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Languages } from 'lucide-react';
import { toast } from 'sonner';

const languages = [
    { code: 'es', label: 'Español', shortLabel: 'ES', toast: 'Idioma cambiado a Español' },
    { code: 'en', label: 'English', shortLabel: 'EN', toast: 'Language changed to English' },
    { code: 'ar', label: 'العربية', shortLabel: 'AR', toast: 'تم تغيير اللغة إلى العربية' }
];

const normalizeLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const LanguageSwitcher = () => {
    const { i18n } = useTranslation();
    const currentLanguage = normalizeLanguage(i18n.language);
    const currentIndex = languages.findIndex((language) => language.code === currentLanguage);
    const nextLanguage = languages[(currentIndex + 1) % languages.length];

    const toggleLanguage = () => {
        i18n.changeLanguage(nextLanguage.code);
        toast.success(nextLanguage.toast);
    };

    return (
        <Button
            variant="outline"
            size="icon"
            onClick={toggleLanguage}
            aria-label={`Cambiar idioma a ${nextLanguage.label}`}
            title={`Cambiar idioma a ${nextLanguage.label}`}
            className="rounded-full h-9 w-9 bg-white/50 backdrop-blur-md border-slate-100 shadow-sm hover:text-primary transition-all shrink-0"
        >
            <span className="sr-only">Cambiar idioma</span>
            <Languages size={16} />
            <span className="text-[9px] font-black leading-none">{currentLanguage.toUpperCase()}</span>
        </Button>
    );
};

export default LanguageSwitcher;
