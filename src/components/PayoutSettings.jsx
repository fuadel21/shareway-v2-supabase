import { useState, useEffect, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import {
    Loader2, Landmark, ChevronLeft,
    Banknote, History, ArrowUpRight, ShieldCheck,
    BadgeCheck, ExternalLink, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import SubPageHeader from './SubPageHeader';
import { useWallet } from '../hooks/useWallet';
import { createStripeConnectOnboarding, createPayoutRequest } from '@/lib/supabaseRPC';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { format, isValid } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';

const StatusCard = ({ isConnected, onConnect, isConnecting }) => {
    const { t } = useTranslation();
    return (
        <Card className={cn(
            "rounded-[2.5rem] md:rounded-[3rem] border-none shadow-2xl overflow-hidden relative group transition-all duration-700",
            isConnected ? "bg-slate-950 text-white" : "bg-white text-slate-900 shadow-slate-200/50"
        )}>
            <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:scale-125 transition-transform duration-1000"><BadgeCheck size={140} /></div>
            <CardContent className="p-6 md:p-10 relative z-10 space-y-6 md:space-y-8">
                <div className="flex items-center gap-4 md:gap-6">
                    <div className={cn("size-12 md:size-16 rounded-xl md:rounded-[1.5rem] flex items-center justify-center shadow-2xl", isConnected ? "bg-primary text-slate-950" : "bg-slate-50 text-slate-400")}><Landmark className="h-6 w-6 md:h-8 md:w-8" /></div>
                    <div>
                        <h3 className="font-black text-xl md:text-2xl uppercase tracking-tighter italic leading-none mb-1.5 md:mb-2">{t('payouts.channel_title')}</h3>
                        <p className={cn("text-[8px] md:text-[10px] font-black uppercase tracking-widest px-2.5 md:px-3 py-1 rounded-full border w-fit", isConnected ? "text-emerald-400 border-emerald-400/20 bg-emerald-400/5" : "text-amber-500 border-amber-500/20 bg-amber-50")}>
                            {isConnected ? t('payouts.status_connected') : t('payouts.status_pending')}
                        </p>
                    </div>
                </div>
                {!isConnected ? (
                    <div className="space-y-4">
                        <p className="text-[11px] md:text-xs font-medium text-slate-400 leading-relaxed italic">{t('payouts.description')}</p>
                        <Button onClick={onConnect} disabled={isConnecting} className="w-full h-14 md:h-16 rounded-2xl md:rounded-[1.5rem] bg-slate-950 text-white font-black text-[9px] md:text-[10px] uppercase tracking-[0.2em] shadow-2xl active:scale-95 transition-all">
                            {isConnecting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <ExternalLink className="mr-2 h-4 w-4" />} {t('payouts.setup_button')}
                        </Button>
                    </div>
                ) : (
                    <div className="flex items-center gap-3 text-[10px] font-black text-white/40 uppercase tracking-[0.2em] bg-white/5 p-4 rounded-2xl border border-white/5"><ShieldCheck className="h-4 w-4 text-emerald-400" /> {t('payouts.active_identity')}</div>
                )}
            </CardContent>
        </Card>
    );
};

function PayoutSettings() {
    const { profile, user } = useOutletContext();
    const { t, i18n } = useTranslation();
    const { wallet, refreshWallet } = useWallet(user);
    const [isConnecting, setIsConnecting] = useState(false);
    const [payouts, setPayouts] = useState([]);
    const [amount, setAmount] = useState('');
    const [isRequesting, setIsRequesting] = useState(false);

    const balance = wallet?.balance || 0;

    const fetchPayouts = useCallback(async () => {
        if (!user) return;
        try {
            const { data } = await supabase.from('payout_requests').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
            if (data) setPayouts(data);
        } catch (e) { console.error(e); }
    }, [user]);

    useEffect(() => { fetchPayouts(); }, [fetchPayouts]);

    const handleConnectAccount = async () => {
        setIsConnecting(true);
        try {
            const res = await createStripeConnectOnboarding(window.location.href);
            if (res.success && res.data?.url) window.location.href = res.data.url;
            else throw new Error(res.error || "No se pudo generar el enlace de Stripe.");
        } catch (error) {
            toast.error(t('common.error'), { description: error.message });
            setIsConnecting(false);
        }
    };

    const handleRequest = async () => {
        const val = parseFloat(amount);
        if (val < 10) return toast.error(t('payouts.min_amount_error'));
        if (val > balance) return toast.error(t('payouts.insufficient_balance'));

        setIsRequesting(true);
        const toastId = toast.loading(t('payouts.processing_toast'));
        try {
            const res = await createPayoutRequest(val);
            if (!res.success) throw new Error(res.error);

            toast.success(t('payouts.success_toast'), { id: toastId, description: t('payouts.success_description') });
            setAmount('');
            await refreshWallet();
            await fetchPayouts();
        } catch (error) {
            toast.error(t('common.error'), { id: toastId, description: error.message });
        } finally {
            setIsRequesting(false);
        }
    };

    const isConnected = profile?.stripe_onboarding_complete || profile?.stripe_account_verified;

    return (
        <div className="bg-slate-50 min-h-screen pb-40 font-sans">
            <SubPageHeader title={t('payouts.title')} backTo="/settings" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-8">
                <StatusCard isConnected={isConnected} onConnect={handleConnectAccount} isConnecting={isConnecting} />

                {isConnected && (
                    <Card className="rounded-[2.5rem] md:rounded-[3rem] border-none shadow-xl bg-white p-8 md:p-10 space-y-6 md:space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                        <div className="text-center space-y-2">
                            <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] leading-none italic">{t('payouts.retrievable_funds')}</p>
                            <h2 className="text-4xl md:text-6xl font-black text-slate-900 tracking-tighter italic leading-none">{balance.toFixed(2)}€</h2>
                        </div>

                        <div className="space-y-4">
                            <div className="relative group">
                                <Banknote className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 md:h-6 md:w-6 text-primary transition-transform group-focus-within:scale-110" />
                                <Input
                                    type="number"
                                    placeholder="0.00"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="h-16 md:h-20 pl-14 text-xl md:text-2xl font-black rounded-2xl md:rounded-3xl bg-slate-50 border-none shadow-inner text-slate-900 focus-visible:ring-primary"
                                />
                            </div>

                            <div className="p-3 md:p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-3">
                                <AlertCircle className="size-3.5 md:size-4 text-blue-600 mt-0.5 shrink-0" />
                                <p className="text-[9px] md:text-[10px] font-bold text-blue-800 leading-relaxed uppercase tracking-wide">
                                    {t('payouts.security_notice')}
                                </p>
                            </div>

                            <Button
                                onClick={handleRequest}
                                disabled={isRequesting || balance < 10 || !amount}
                                className="w-full h-16 md:h-20 rounded-2xl md:rounded-[2rem] bg-slate-900 text-white font-black text-base md:text-lg uppercase italic tracking-widest shadow-2xl active:scale-95 transition-all"
                            >
                                {isRequesting ? <Loader2 className="animate-spin size-5 md:size-6" /> : t('payouts.transfer_button')}
                            </Button>
                        </div>
                    </Card>
                )}

                <div className="space-y-6">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] ml-4 flex items-center gap-2 italic">
                        <History size={14} className="text-primary" /> {t('payouts.audit_title')}
                    </h3>
                    <div className="space-y-3">
                        {payouts.length > 0 ? payouts.map((p, idx) => {
                            const date = new Date(p.created_at);
                            return (
                                <div key={p.id} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 flex justify-between items-center shadow-sm hover:shadow-md transition-all animate-in fade-in" style={{ animationDelay: `${idx * 50}ms` }}>
                                    <div className="flex items-center gap-5">
                                        <div className={cn("p-4 rounded-2xl", p.status === 'completed' ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400")}><ArrowUpRight className="size-6" /></div>
                                        <div>
                                            <p className="font-black text-slate-900 text-lg tracking-tighter italic leading-none">{parseFloat(p.amount).toFixed(2)}€</p>
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">{isValid(date) ? format(date, 'd MMMM, HH:mm', { locale: i18n.language === 'es' ? es : enUS }) : 'Reciente'}</p>
                                        </div>
                                    </div>
                                    <span className={cn("px-4 py-2 rounded-full text-[8px] font-black uppercase tracking-widest italic border",
                                        p.status === 'completed' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                            p.status === 'rejected' ? "bg-red-50 text-red-600 border-red-100" : "bg-amber-50 text-amber-600 border-amber-100")}>
                                        {p.status === 'completed' ? t('payouts.status_processed') : p.status === 'rejected' ? t('payouts.status_rejected') : t('payouts.status_pending_label')}
                                    </span>
                                </div>
                            );
                        }) : (
                            <div className="py-24 flex flex-col items-center justify-center bg-white/50 rounded-[3rem] border-2 border-dashed border-slate-100">
                                <Banknote className="size-12 text-slate-100 mb-4 opacity-20" />
                                <p className="text-center text-slate-300 font-black text-[10px] uppercase tracking-[0.3em] italic">{t('payouts.no_history')}</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}

export default PayoutSettings;
