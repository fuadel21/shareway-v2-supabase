import { useState, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
    ShieldCheck,
    Camera,
    Phone,
    Mail,
    Loader2,
    ArrowLeft,
    CheckCircle2,
    ChevronRight,
    Lock,
    Sparkles,
    Shield,
    Fingerprint,
    BadgeCheck,
    Zap,
    Trophy,
    GraduationCap
} from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import PhoneVerificationDialog from './PhoneVerificationDialog';
import SubPageHeader from './SubPageHeader';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const VerificationStep = ({ icon: Icon, title, description, status, actionText, onClick, isLoading, isCompleted, isDisabled, index }) => {
    const { t } = useTranslation();
    const isPending = status === 'pending' || status === 'processing';

    let statusText = actionText;
    if (isCompleted) statusText = t('verification.status_completed');
    else if (isPending) statusText = t('verification.status_pending');

    return (
        <div
            className={cn(
                "group relative flex items-center gap-6 p-8 bg-white rounded-[3rem] border border-slate-100 hover:shadow-2xl hover:shadow-primary/5 transition-all duration-500 animate-in fade-in slide-in-from-bottom-8",
                isDisabled && "opacity-40 grayscale pointer-events-none"
            )}
            style={{ animationDelay: `${index * 150}ms` }}
        >
            <div className={cn(
                "p-5 rounded-[1.8rem] transition-all duration-500 shadow-sm",
                isCompleted ? 'bg-emerald-50 text-emerald-500' : isPending ? 'bg-orange-50 text-primary' : 'bg-slate-50 text-slate-400'
            )}>
                {isCompleted ? <BadgeCheck className="h-8 w-8" /> : <Icon className="h-8 w-8" />}
            </div>

            <div className="flex-1 space-y-1 text-left">
                <div className="flex items-center gap-2">
                    <p className="text-xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">{title}</p>
                    {isCompleted && <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-normal max-w-[200px]">{description}</p>
            </div>

            <Button
                onClick={onClick}
                variant={isCompleted ? "ghost" : "default"}
                disabled={isCompleted || isPending || isLoading || isDisabled}
                className={cn(
                    "h-14 min-w-[120px] rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] transition-all",
                    isCompleted && "bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
                    !isCompleted && "bg-navy text-white shadow-xl hover:scale-105 active:scale-95"
                )}
            >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isCompleted ? <CheckCircle2 className="h-4 w-4 mr-2" /> : null}
                {isCompleted ? t('verification.action_ready') : statusText}
            </Button>

            <div className={cn(
                "absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1/2 rounded-full transition-all duration-700",
                isCompleted ? "bg-emerald-500 opacity-100" : "bg-slate-100 opacity-0"
            )} />
        </div>
    );
};

function VerificationSettings() {
    const { t } = useTranslation();
    const { profile, user: currentUser, refreshProfile } = useOutletContext();
    const navigate = useNavigate();
    const [isProcessing, setIsProcessing] = useState(null);
    const [showPhoneDialog, setShowPhoneDialog] = useState(false);

    const handlePhoneVerification = async () => {
        if (!profile?.phone) {
            return toast.warning(t('verification.phone_missing'), {
                description: t('verification.phone_missing_desc'),
                action: { label: t('common.save'), onClick: () => navigate('/edit-profile') },
            });
        }

        setIsProcessing('phone');
        try {
            const { error } = await supabase.auth.signInWithOtp({
                phone: profile.phone,
            });
            if (error) throw error;
            setShowPhoneDialog(true);
            toast.info(t('verification.code_sent'), { description: t('verification.code_sent_desc') });
        } catch (error) {
            toast.error(t('common.error'), { description: error.message });
        } finally {
            setIsProcessing(null);
        }
    };

    const handleResendEmail = async () => {
        if (!currentUser?.email) return;
        setIsProcessing('email');
        try {
            const { error } = await supabase.auth.resend({ type: 'signup', email: currentUser.email });
            if (error) throw error;
            toast.success(t('verification.email_sent'), { description: t('verification.email_sent_desc') });
        } catch (error) {
            toast.error(t('common.error'), { description: error.message });
        } finally {
            setIsProcessing(null);
        }
    };

    const steps = useMemo(() => [
        {
            key: 'email',
            icon: Mail,
            title: t('verification.email_title'),
            description: t('verification.email_desc'),
            isCompleted: !!currentUser?.email_confirmed_at,
            action: handleResendEmail
        },
        {
            key: 'phone',
            icon: Phone,
            title: t('verification.phone_title'),
            description: t('verification.phone_desc'),
            isCompleted: !!profile?.is_phone_verified,
            action: handlePhoneVerification
        },
        {
            key: 'identity',
            icon: Fingerprint,
            title: t('verification.identity_title'),
            description: t('verification.identity_desc'),
            isCompleted: ['verified', 'approved'].includes(profile?.verification?.status),
            status: profile?.verification?.status,
            action: () => navigate('/verification-center')
        }
    ], [currentUser, profile, t]);

    const completedSteps = steps.filter(s => s.isCompleted).length;
    const progress = (completedSteps / steps.length) * 100;

    return (
        <div className="min-h-screen bg-slate-50 pb-40">
            <SubPageHeader title={t('verification.title')} backTo="/settings" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-12 text-left">

                {/* GAMIFIED PROGRESS CARD */}
                <Card className="rounded-[4rem] border-none shadow-2xl bg-white overflow-hidden p-10 space-y-8">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <h2 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">{t('verification.trust_level')}</h2>
                            <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">
                                {completedSteps === 3 ? t('verification.elite_profile') : t('verification.level_of', { current: completedSteps + 1 })}
                            </p>
                        </div>
                        <div className="h-16 w-16 bg-navy rounded-[1.5rem] flex items-center justify-center text-white shadow-xl rotate-3">
                            <Trophy className="h-8 w-8 text-primary" />
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between px-2">
                            <div className="flex gap-4 text-left">
                                <div className="flex -space-x-2">
                                    {[1, 2, 3].map((s) => (
                                        <div key={s} className={cn(
                                            "h-3 w-3 rounded-full border-2 border-white transition-colors duration-1000",
                                            completedSteps >= s ? "bg-primary" : "bg-slate-100"
                                        )} />
                                    ))}
                                </div>
                                <span className="text-[10px] font-black uppercase text-slate-400">{t('verification.goal')}</span>
                            </div>
                            <span className="text-xl font-black text-slate-900 italic uppercase">{Math.round(progress)}%</span>
                        </div>
                        <div className="h-4 w-full bg-slate-50 rounded-full overflow-hidden p-0.5 border border-slate-100">
                            <div
                                className="h-full bg-primary rounded-full transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(255,107,0,0.3)]"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>

                    <div className="p-6 bg-primary/5 rounded-3xl border border-primary/10 flex items-center gap-4">
                        <Zap className="h-6 w-6 text-primary flex-shrink-0" />
                        <p className="text-xs font-bold text-slate-600 leading-relaxed italic">
                            {t('verification.benefit_info')}
                        </p>
                    </div>
                </Card>

                {/* VERIFICATION STEPS */}
                <div className="space-y-4">
                    {steps.map((step, idx) => (
                        <VerificationStep
                            key={step.key}
                            index={idx}
                            icon={step.icon}
                            title={step.title}
                            description={step.description}
                            isCompleted={step.isCompleted}
                            status={step.status}
                            actionText={step.key === 'identity' ? t('verification.action_upload') : step.key === 'phone' ? t('verification.action_sms') : t('verification.action_send')}
                            onClick={step.action}
                            isLoading={isProcessing === step.key}
                        />
                    ))}
                </div>

                {/* PREMIUM CTA / INFO */}
                <div className="bg-navy p-12 rounded-[4rem] relative overflow-hidden group text-left">
                    <div className="absolute -bottom-10 -right-10 opacity-5 grayscale group-hover:grayscale-0 transition-all duration-1000 group-hover:rotate-12">
                        <ShieldCheck className="size-64 text-primary" />
                    </div>

                    <div className="relative z-10 space-y-8">
                        <div className="size-20 bg-primary/20 rounded-[2rem] flex items-center justify-center backdrop-blur-md">
                            <GraduationCap className="size-10 text-primary" />
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-3xl font-black text-white tracking-tighter italic uppercase leading-tight">{t('verification.privileges_title')}</h4>
                            <p className="text-xs font-medium text-white/50 leading-relaxed">
                                {t('verification.privileges_desc')}
                            </p>
                        </div>

                        <Button variant="outline" className="h-16 px-10 rounded-2xl bg-white/5 border-white/10 text-white font-black text-xs uppercase tracking-widest hover:bg-white/10">
                            {t('verification.more_info')}
                        </Button>
                    </div>
                </div>

                <p className="text-center text-[10px] text-slate-300 font-black uppercase tracking-[0.3em] pb-10">
                    Trust Evolution Engine v2.0 • ShareWay
                </p>
            </main>

            <PhoneVerificationDialog
                open={showPhoneDialog}
                onOpenChange={setShowPhoneDialog}
                phoneNumber={profile?.phone}
            />
        </div>
    );
}

export default VerificationSettings;
