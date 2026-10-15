import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Moon, Sun, Palette, Monitor, Zap, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import SubPageHeader from './SubPageHeader';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

function AppearanceSettings() {
    const { t } = useTranslation();
    const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
    const navigate = useNavigate();

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    const themes = [
        { id: 'light', name: t('appearance.original_light'), icon: Sun, color: 'text-amber-500', bg: 'bg-white', border: 'border-slate-200' },
        { id: 'dark', name: t('appearance.deep_space'), icon: Moon, color: 'text-indigo-400', bg: 'bg-slate-900', border: 'border-slate-800' },
    ];

    return (
        <div className="min-h-screen bg-slate-50 pb-40 font-sans">
            <SubPageHeader title={t('appearance.title')} backTo="/settings" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-5 text-left">

                {/* HERO CARD */}
                <div className="bg-slate-900 rounded-3xl p-10 relative overflow-hidden group shadow-2xl shadow-slate-200">
                    <div className="absolute top-0 right-0 p-8 opacity-5 rotate-12 group-hover:scale-110 transition-transform">
                        <Palette size={140} className="text-white" />
                    </div>

                    <div className="relative z-10 space-y-6">
                        <div className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_15px_rgba(34,211,238,0.5)]" />
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Visual Interface v2.5</span>
                        </div>

                        <div className="space-y-1">
                            <h2 className="text-4xl font-black text-white tracking-tighter italic uppercase leading-none">{t('appearance.customization')}</h2>
                            <p className="text-white/40 font-bold text-xs uppercase tracking-widest">{t('appearance.customization_desc')}</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-4 italic">{t('appearance.choose_mode')}</p>

                    <div className="grid grid-cols-2 gap-4">
                        {themes.map((t_item) => {
                            const isSelected = theme === t_item.id;
                            return (
                                <button
                                    key={t_item.id}
                                    onClick={() => setTheme(t_item.id)}
                                    className={cn(
                                        "relative flex flex-col items-center justify-center p-8 rounded-3xl transition-all duration-500 group",
                                        isSelected
                                            ? "bg-white shadow-2xl shadow-primary/5 ring-4 ring-primary/20 scale-105 z-10 border-transparent"
                                            : "bg-white/60 hover:bg-white border border-slate-100 grayscale hover:grayscale-0 shadow-sm"
                                    )}
                                >
                                    <div className={cn(
                                        "size-16 rounded-2xl flex items-center justify-center mb-4 transition-all group-hover:rotate-6",
                                        isSelected ? "bg-primary text-white shadow-lg" : "bg-slate-100 text-slate-400"
                                    )}>
                                        <t_item.icon size={28} />
                                    </div>
                                    <span className={cn(
                                        "font-black text-[10px] uppercase tracking-widest",
                                        isSelected ? "text-slate-900" : "text-slate-400"
                                    )}>{t_item.name}</span>

                                    {isSelected && (
                                        <div className="absolute top-4 right-4 text-primary animate-in zoom-in">
                                            <CheckCircle2 size={16} />
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="bg-white p-8 rounded-3xl border border-slate-100 space-y-6">
                    <div className="flex items-center gap-4">
                        <div className="size-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-500">
                            <Monitor size={24} />
                        </div>
                        <div>
                            <h4 className="font-black text-slate-900 uppercase italic tracking-tighter">{t('appearance.auto_mode')}</h4>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">{t('appearance.sync_system')}</p>
                        </div>
                        <div className="flex-1 text-right">
                            <span className="text-[9px] font-black bg-slate-100 text-slate-400 px-3 py-1.5 rounded-full uppercase tracking-widest">{t('appearance.coming_soon')}</span>
                        </div>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed italic border-t border-slate-50 pt-4">
                        {t('appearance.auto_mode_desc')}
                    </p>
                </div>

                <div className="p-8 bg-primary/5 rounded-3xl border border-primary/10 flex items-start gap-4">
                    <Sparkles className="size-6 text-primary shrink-0" />
                    <div>
                        <h4 className="font-black text-slate-900 tracking-tight text-sm uppercase italic">{t('appearance.high_performance')}</h4>
                        <p className="text-xs text-slate-500 font-medium leading-relaxed mt-1 italic">
                            {t('appearance.performance_desc')}
                        </p>
                    </div>
                </div>

                <p className="text-center text-[10px] text-slate-300 font-black uppercase tracking-[0.3em] pb-10">
                    Interface Engine v4.0 • ShareWay
                </p>
            </main>
        </div>
    );
}

export default AppearanceSettings;
