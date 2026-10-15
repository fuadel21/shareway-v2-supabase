import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import {
    Loader2, Landmark, TrendingUp, Clock,
    Banknote, History, ArrowUpRight, ShieldCheck,
    BadgeCheck, ExternalLink, Wallet
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

const copyByLanguage = {
    es: {
        stripeLinkError: 'No se pudo generar el enlace de Stripe.',
        withdrawableBalance: 'Balance Retirable',
        heldBalance: 'En Retención',
        amountPrompt: 'Ingresa el monto a transferir',
        transferNotice: 'Las transferencias suelen tardar entre 24h y 72h hábiles según tu entidad bancaria.',
        transferButton: 'Transferir a mi banco',
        manageStripe: 'Gestionar cuenta y datos bancarios en Stripe',
        transactionHistory: 'Historial de Transacciones',
        recent: 'Reciente',
        tripCredit: 'Abono Viaje',
        transferred: 'Transferido',
        pending: 'Pendiente',
        noTransactions: 'Sin transacciones registradas'
    },
    en: {
        stripeLinkError: 'Could not generate the Stripe link.',
        withdrawableBalance: 'Withdrawable Balance',
        heldBalance: 'On Hold',
        amountPrompt: 'Enter the amount to transfer',
        transferNotice: 'Transfers usually take between 24 and 72 business hours depending on your bank.',
        transferButton: 'Transfer to my bank',
        manageStripe: 'Manage account and bank details in Stripe',
        transactionHistory: 'Transaction History',
        recent: 'Recent',
        tripCredit: 'Ride Credit',
        transferred: 'Transferred',
        pending: 'Pending',
        noTransactions: 'No transactions recorded'
    },
    ar: {
        stripeLinkError: 'تعذر إنشاء رابط Stripe.',
        withdrawableBalance: 'الرصيد القابل للسحب',
        heldBalance: 'قيد الحجز',
        amountPrompt: 'أدخل المبلغ المراد تحويله',
        transferNotice: 'عادةً تستغرق التحويلات بين 24 و72 ساعة عمل حسب البنك.',
        transferButton: 'تحويل إلى بنكي',
        manageStripe: 'إدارة الحساب والبيانات البنكية في Stripe',
        transactionHistory: 'سجل المعاملات',
        recent: 'حديث',
        tripCredit: 'رصيد الرحلة',
        transferred: 'تم التحويل',
        pending: 'قيد الانتظار',
        noTransactions: 'لا توجد معاملات مسجلة'
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const StatusCard = ({ isConnected, onConnect, isConnecting }) => {
    const { t } = useTranslation();
    return (
        <Card className={cn(
            "rounded-3xl border-none shadow-xl overflow-hidden relative group transition-all duration-700",
            isConnected ? "bg-slate-900 text-white" : "bg-white text-slate-900 border border-slate-100"
        )}>
            <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:scale-125 transition-transform duration-1000"><BadgeCheck size={100} /></div>
            <CardContent className="p-4 relative z-10 space-y-4">
                <div className="flex items-center gap-4">
                    <div className={cn("size-12 rounded-xl flex items-center justify-center shadow-lg", isConnected ? "bg-primary text-slate-950" : "bg-slate-50 text-slate-400")}><Landmark className="h-6 w-6" /></div>
                    <div>
                        <h3 className="font-black text-lg uppercase tracking-tighter italic leading-none mb-1">{t('payouts.channel_title')}</h3>
                        <p className={cn("text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border w-fit", isConnected ? "text-emerald-400 border-emerald-400/20 bg-emerald-400/5" : "text-amber-500 border-amber-500/20 bg-amber-50")}>
                            {isConnected ? t('payouts.status_connected') : t('payouts.status_pending')}
                        </p>
                    </div>
                </div>
                {!isConnected && (
                    <div className="space-y-4">
                        <p className="text-[10px] font-bold text-slate-400 leading-relaxed italic">{t('payouts.description')}</p>
                        <Button onClick={onConnect} disabled={isConnecting} className="w-full h-12 rounded-xl bg-slate-950 text-white font-black text-[9px] uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all">
                            {isConnecting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <ExternalLink className="mr-2 h-4 w-4" />} {t('payouts.setup_button')}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

function PayoutSettings() {
    const { profile, user } = useOutletContext();
    const { t, i18n } = useTranslation();
    const language = getLanguage(i18n.language);
    const copy = copyByLanguage[language];
    const { wallet, refreshWallet } = useWallet(user);
    const [isConnecting, setIsConnecting] = useState(false);
    const [transactions, setTransactions] = useState([]);
    const [amount, setAmount] = useState('');
    const [isRequesting, setIsRequesting] = useState(false);

    const balance = wallet?.balance || 0;
    const heldBalance = wallet?.held_balance || 0;

    const fetchHistory = useCallback(async () => {
        if (!user) return;
        try {
            const { data } = await supabase
                .from('transactions')
                .select('*')
                .eq('user_id', user.id)
                .in('type', ['payout', 'payout_request', 'ride_earnings'])
                .order('created_at', { ascending: false });

            if (data) setTransactions(data);
        } catch (e) { console.error(e); }
    }, [user]);

    useEffect(() => { fetchHistory(); }, [fetchHistory]);

    const handleConnectAccount = async () => {
        setIsConnecting(true);
        try {
            const res = await createStripeConnectOnboarding(window.location.href);
            if (res.success && res.data?.url) window.location.href = res.data.url;
            else throw new Error(res.error || copy.stripeLinkError);
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
            await fetchHistory();
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

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-5">
                <StatusCard isConnected={isConnected} onConnect={handleConnectAccount} isConnecting={isConnecting} />

                {isConnected && (
                    <div className="space-y-6">
                        <Card className="rounded-3xl md:rounded-3xl border-none shadow-xl bg-white p-5 md:p-10 space-y-6 md:space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="text-left space-y-2 bg-slate-50 p-6 rounded-3xl border border-slate-100 relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:scale-125 transition-transform"><TrendingUp size={40} /></div>
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] leading-none italic">{copy.withdrawableBalance}</p>
                                    <h2 className="text-2xl md:text-4xl font-black text-slate-900 tracking-tighter italic leading-none">{balance.toFixed(2)}€</h2>
                                </div>
                                <div className="text-left space-y-2 bg-emerald-50/30 p-6 rounded-3xl border border-emerald-100/50 relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:scale-125 transition-transform"><Clock size={40} /></div>
                                    <p className="text-[9px] font-black text-emerald-600/60 uppercase tracking-[0.3em] leading-none italic">{copy.heldBalance}</p>
                                    <h2 className="text-2xl md:text-4xl font-black text-emerald-600 tracking-tighter italic leading-none">{heldBalance.toFixed(2)}€</h2>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-center italic">{copy.amountPrompt}</p>
                                <div className="relative group">
                                    <Banknote className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 md:h-6 md:w-6 text-primary transition-transform group-focus-within:scale-110" />
                                    <Input
                                        type="number"
                                        placeholder="0.00"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className="h-12 md:h-14 pl-14 text-xl md:text-2xl font-black rounded-2xl md:rounded-3xl bg-slate-50 border-none shadow-inner text-slate-900 focus-visible:ring-primary"
                                    />
                                </div>

                                <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-3">
                                    <ShieldCheck className="size-4 text-blue-600 mt-0.5 shrink-0" />
                                    <p className="text-[9px] font-bold text-blue-800 leading-relaxed uppercase tracking-wide">
                                        {copy.transferNotice}
                                    </p>
                                </div>

                                <Button
                                    onClick={handleRequest}
                                    disabled={isRequesting || balance < 10 || !amount}
                                    className="w-full h-12 md:h-14 rounded-2xl md:rounded-3xl bg-slate-900 text-white font-black text-base md:text-lg uppercase italic tracking-widest shadow-2xl active:scale-95 transition-all disabled:opacity-30"
                                >
                                    {isRequesting ? <Loader2 className="animate-spin size-5 md:size-6" /> : copy.transferButton}
                                </Button>
                            </div>
                        </Card>

                        <Button
                            variant="outline"
                            onClick={handleConnectAccount}
                            disabled={isConnecting}
                            className="w-full h-14 rounded-2xl border-2 border-slate-200 bg-white text-slate-500 font-black text-[10px] uppercase tracking-widest italic hover:bg-slate-50 transition-all gap-2"
                        >
                            {isConnecting ? <Loader2 className="animate-spin size-4" /> : <ExternalLink size={14} />}
                            {copy.manageStripe}
                        </Button>
                    </div>
                )}

                <div className="space-y-6">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] ml-4 flex items-center gap-2 italic">
                        <History size={14} className="text-primary" /> {copy.transactionHistory}
                    </h3>
                    <div className="space-y-3">
                        {transactions.length > 0 ? transactions.map((t_item, idx) => {
                            const date = new Date(t_item.created_at);
                            const isEarning = t_item.type === 'ride_earnings';

                            return (
                                <div key={t_item.id} className="bg-white p-6 rounded-3xl border border-slate-100 flex justify-between items-center shadow-sm hover:shadow-md transition-all animate-in fade-in" style={{ animationDelay: `${idx * 50}ms` }}>
                                    <div className="flex items-center gap-5">
                                        <div className={cn(
                                            "p-4 rounded-2xl",
                                            isEarning ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400"
                                        )}>
                                            {isEarning ? <TrendingUp className="size-6" /> : <ArrowUpRight className="size-6" />}
                                        </div>
                                        <div>
                                            <p className="font-black text-slate-900 text-lg tracking-tighter italic leading-none">
                                                {isEarning ? '+' : ''}{parseFloat(t_item.amount).toFixed(2)}€
                                            </p>
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">
                                                {isValid(date) ? format(date, 'd MMMM, HH:mm', { locale: language === 'es' ? es : enUS }) : copy.recent}
                                            </p>
                                        </div>
                                    </div>
                                    <span className={cn("px-4 py-2 rounded-full text-[8px] font-black uppercase tracking-widest italic border",
                                        isEarning ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                        t_item.status === 'completed' ? "bg-blue-50 text-blue-600 border-blue-100" : "bg-amber-50 text-amber-600 border-amber-100")}>
                                        {isEarning ? copy.tripCredit : t_item.status === 'completed' ? copy.transferred : copy.pending}
                                    </span>
                                </div>
                            );
                        }) : (
                            <div className="py-24 flex flex-col items-center justify-center bg-white/50 rounded-3xl border-2 border-dashed border-slate-100">
                                <Wallet className="size-12 text-slate-100 mb-4 opacity-20" />
                                <p className="text-center text-slate-300 font-black text-[10px] uppercase tracking-[0.3em] italic">{copy.noTransactions}</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}

export default PayoutSettings;
