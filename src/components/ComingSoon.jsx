import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowLeft, Construction, Timer, Rocket, ShieldCheck, Zap } from 'lucide-react';
import SubPageHeader from './SubPageHeader';
import { useTranslation } from 'react-i18next';

function ComingSoon() {
    const navigate = useNavigate();
    const { t } = useTranslation();

    return (
        <div className="bg-slate-50 min-h-screen pb-40 relative overflow-hidden">
            {/* Fondo Dinámico */}
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-50">
                <div className="absolute top-1/4 right-[10%] size-96 bg-primary/10 rounded-full blur-[120px] animate-pulse" />
                <div className="absolute bottom-1/4 left-[10%] size-96 bg-indigo-500/10 rounded-full blur-[120px] animate-pulse delay-700" />
            </div>

            <SubPageHeader title={t('coming_soon.lab_title')} />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 flex flex-col items-center text-center">

                {/* ICONO CENTRAL ANIMADO */}
                <div className="relative group mb-12 animate-in zoom-in-50 duration-1000">
                    <div className="absolute inset-0 bg-primary/20 blur-[80px] rounded-full animate-pulse" />
                    <div className="size-48 bg-navy rounded-[4rem] shadow-[0_40px_100px_rgba(0,0,0,0.3)] flex items-center justify-center border-4 border-white/10 relative z-10 group-hover:rotate-12 transition-transform duration-700">
                        <Zap className="size-20 text-primary animate-bounce" />
                    </div>
                    <div className="absolute -bottom-4 -right-4 size-16 bg-white rounded-3xl flex items-center justify-center shadow-2xl border-4 border-slate-900 z-20">
                        <Construction className="size-8 text-slate-400" />
                    </div>
                </div>

                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-300">
                    <h1 className="text-5xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">
                        {t('coming_soon.main_title')} <span className="text-primary">{t('coming_soon.audit_span')}</span>
                    </h1>
                    <p className="text-sm font-bold text-slate-400 max-w-sm mx-auto uppercase tracking-[0.2em] leading-relaxed">
                        {t('coming_soon.description')}
                    </p>
                </div>

                {/* TARJETAS DE PROGRESO */}
                <div className="grid grid-cols-1 gap-4 w-full mt-16 animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-500">
                    <div className="p-8 bg-white/60 backdrop-blur-3xl rounded-3xl border border-white/60 flex items-center gap-6 shadow-xl text-left hover:scale-[1.02] transition-transform">
                        <div className="size-14 bg-emerald-50 rounded-2xl flex items-center justify-center border border-emerald-100">
                            <ShieldCheck className="size-7 text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">{t('coming_soon.status_label')}</p>
                            <p className="font-black text-slate-800 uppercase italic">{t('coming_soon.status_value')}</p>
                        </div>
                    </div>

                    <div className="p-8 bg-white/60 backdrop-blur-3xl rounded-3xl border border-white/60 flex items-center gap-6 shadow-xl text-left hover:scale-[1.02] transition-transform">
                        <div className="size-14 bg-indigo-50 rounded-2xl flex items-center justify-center border border-indigo-100">
                            <Rocket className="size-7 text-indigo-500" />
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{t('coming_soon.launch_label')}</p>
                            <p className="font-black text-slate-800 uppercase italic">{t('coming_soon.launch_value')}</p>
                        </div>
                    </div>
                </div>

                <Button
                    onClick={() => navigate(-1)}
                    className="mt-16 h-12 px-12 rounded-3xl bg-navy text-white font-black text-xs uppercase tracking-[0.3em] shadow-2xl hover:bg-navy-600 transition-all hover:scale-105 active:scale-95"
                >
                    <ArrowLeft className="mr-3 size-4" /> {t('coming_soon.back_button')}
                </Button>

            </main>
        </div>
    );
}

export default ComingSoon;
