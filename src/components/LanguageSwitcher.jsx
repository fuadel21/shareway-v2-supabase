import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Languages } from 'lucide-react';
import { toast } from 'sonner';

const LanguageSwitcher = () => {
    const { i18n } = useTranslation();

    const toggleLanguage = () => {
        const newLang = i18n.language.startsWith('es') ? 'en' : 'es';
        i18n.changeLanguage(newLang);
        toast.success(newLang === 'es' ? 'Idioma cambiado a Español' : 'Language changed to English');
    };

    return (
        <Button
            variant="outline"
            size="icon"
            onClick={toggleLanguage}
            className="rounded-full h-9 w-9 bg-white/50 backdrop-blur-md border-slate-100 shadow-sm hover:text-primary transition-all shrink-0"
        >
            <Languages size={18} />
        </Button>
    );
};

export default LanguageSwitcher;
