import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';
import AddFundsModal from './AddFundsModal';
import TransactionDetailModal from './TransactionDetailModal';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { supabase } from '@/lib/supabase';
import {
    Loader2,
    ArrowUpRight,
    ArrowDownLeft,
    Wallet as WalletIcon,
    Sparkles,
    ShieldCheck,
    History,
    Zap,
    Clock,
    ChevronLeft,
    CreditCard,
    Eye,
    EyeOff,
    RefreshCw,
    Route
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const copyByLanguage = {
    es: {
        recent: 'Reciente',
        net: 'Neto (90%)',
        locale: 'es-ES',
        centerTitle: 'Centro de cartera',
        centerDesc: 'Controla saldo, dinero en garantía y movimientos recientes antes de reservar o publicar viajes.',
        available: 'Disponible',
        protectedFunds: 'En garantía',
        movements: 'Movimientos',
        refresh: 'Actualizar',
        myTrips: 'Mis viajes',
        paymentSettings: 'Pagos',
        emptyTitle: 'Sin movimientos todavía',
        emptyDesc: 'Cuando recargues, reserves o cobres un viaje, aparecerá aquí el historial.',
        heldHint: 'El dinero en garantía se libera según el estado del viaje.'
    },
    en: {
        recent: 'Recent',
        net: 'Net (90%)',
        locale: 'en-US',
        centerTitle: 'Wallet center',
        centerDesc: 'Track balance, protected funds and recent movements before booking or publishing rides.',
        available: 'Available',
        protectedFunds: 'Protected',
        movements: 'Movements',
        refresh: 'Refresh',
        myTrips: 'My rides',
        paymentSettings: 'Payments',
        emptyTitle: 'No movements yet',
        emptyDesc: 'Top-ups, bookings and ride payouts will appear here.',
        heldHint: 'Protected funds are released according to the ride status.'
    },
    ar: {
        recent: 'حديث',
        net: 'الصافي (90%)',
        locale: 'ar-SA',
        centerTitle: 'مركز المحفظة',
        centerDesc: 'تابع الرصيد والمبالغ المحجوزة والحركات الأخيرة قبل الحجز أو نشر الرحلات.',
        available: 'متاح',
        protectedFunds: 'محجوز',
        movements: 'الحركات',
        refresh: 'تحديث',
        myTrips: 'رحلاتي',
        paymentSettings: 'المدفوعات',
        emptyTitle: 'لا توجد حركات بعد',
        emptyDesc: 'ستظهر هنا عمليات الشحن والحجوزات والمدفوعات.',
        heldHint: 'يتم تحرير المبالغ المحجوزة حسب حالة الرحلة.'
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const formatCurrency = (amount, language) => new Intl.NumberFormat(copyByLanguage[language].locale, {
    style: 'currency',
    currency: 'EUR'
}).format(Math.abs(amount));

const formatWalletDate = (dateValue, language, fallback) => {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat(copyByLanguage[language].locale, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
};

const TransactionItem = ({ tx, onClick }) => {
    const { t, i18n } = useTranslation();
    const language = getLanguage(i18n.language);
    const copy = copyByLanguage[language];
    if (!tx) return null;

    const isDeposit = tx.type === 'deposit_stripe' || tx.type === 'deposit' || tx.type === 'refund' || tx.amount > 0;
    const isHold = tx.type === 'hold';
    const amount = parseFloat(tx.amount || 0);
    const safeDate = formatWalletDate(tx.created_at, language, copy.recent);
    const formattedAmount = formatCurrency(amount, language);

    const getDescription = (desc, type) => {
        if (!desc) return t('wallet.tx_types.generic');

        if (desc.includes(' -> ')) {
            return desc.replace(/^(Pago viaje: |Cobro viaje: )/i, '');
        }

        const d = desc.toUpperCase();

        if (type === 'payout') return t('wallet.tx_types.payout');
        if (type === 'withdrawal') return t('wallet.tx_types.withdrawal');
        if (type === 'hold') return t('wallet.tx_types.ride_escrow');
        if (type === 'refund') return t('wallet.tx_types.refund');

        if (d.includes('RESERVA') || d.includes('ESCROW')) return t('wallet.tx_types.ride_escrow');
        if (d.includes('RECARGA') || d.includes('STRIPE')) return t('wallet.tx_types.stripe_deposit');
        if (d.includes('GANANCIA') || d.includes('INGRESO') || d.includes('LIQUIDACIÓN')) return t('wallet.tx_types.payout');

        return desc;
    };

    return (
        <button
            onClick={() => onClick(tx)}
            className="w-full group flex items-center justify-between p-5 bg-white border border-slate-100 rounded-[2rem] hover:shadow-md hover:border-primary/20 transition-all mb-3 text-left active:scale-[0.98]"
        >
            <div className="flex items-center gap-4 text-left">
                <div className={cn(
                    'h-12 w-12 rounded-2xl flex items-center justify-center shadow-sm border transition-colors',
                    isDeposit ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : isHold ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-slate-50 text-slate-600 border-slate-100'
                )}>
                    {isDeposit ? <ArrowUpRight size={20} /> : isHold ? <ShieldCheck size={20} /> : <ArrowDownLeft size={20} />}
                </div>
                <div className="min-w-0 text-left">
                    <p className="font-black text-slate-900 text-[11px] uppercase tracking-tight italic truncate max-w-[180px]">
                        {getDescription(tx.description, tx.type)}
                    </p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1 mt-1">
                        <Clock className="h-3 w-3" /> {safeDate}
                    </p>
                </div>
            </div>
            <div className="text-right">
                <p className={cn('font-black text-base tracking-tighter italic', isDeposit ? 'text-emerald-600' : 'text-slate-900')}>
                    {isDeposit ? '+' : '-'}{formattedAmount}
                </p>
                {tx.type === 'payout' && (
                    <p className="text-[8px] font-bold text-emerald-500/60 uppercase tracking-tighter">{copy.net}</p>
                )}
            </div>
        </button>
    );
};

const Wallet = () => {
    const { user } = useOutletContext();
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const language = getLanguage(i18n.language);
    const copy = copyByLanguage[language];
    const { wallet, loadingWallet, refreshWallet } = useWallet(user);
    const [transactions, setTransactions] = useState([]);
    const [isLoadingTxs, setIsLoadingTxs] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedTx, setSelectedTx] = useState(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [showBalance, setShowBalance] = useState(() => localStorage.getItem('wallet_privacy') !== 'true');
    const [isRefreshing, setIsRefreshing] = useState(false);

    const togglePrivacy = () => {
        const newValue = !showBalance;
        setShowBalance(newValue);
        localStorage.setItem('wallet_privacy', (!newValue).toString());
    };

    const fetchTransactions = useCallback(async () => {
        if (!user?.id) return;
        try {
            const { data, error } = await supabase
                .from('transactions')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) throw error;
            setTransactions(data || []);
        } catch (e) {
            console.error('Failed to fetch transactions:', e);
        } finally {
            setIsLoadingTxs(false);
        }
    }, [user?.id]);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await refreshWallet();
            await fetchTransactions();
        } finally {
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        fetchTransactions();

        if (!user?.id) return;

        const walletChannel = supabase
            .channel(`wallet_sync_${user.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'wallets',
                filter: `user_id=eq.${user.id}`
            }, () => refreshWallet())
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'transactions',
                filter: `user_id=eq.${user.id}`
            }, () => fetchTransactions())
            .subscribe();

        return () => {
            supabase.removeChannel(walletChannel);
        };
    }, [user?.id, fetchTransactions, refreshWallet]);

    const handleTxClick = (tx) => {
        setSelectedTx(tx);
        setIsDetailOpen(true);
    };

    const handleViewRide = (rideId) => {
        setIsDetailOpen(false);
        navigate(`/ride/${rideId}`);
    };

    const balance = useMemo(() => parseFloat(wallet?.balance || 0), [wallet]);
    const heldBalance = useMemo(() => parseFloat(wallet?.heldBalance || 0), [wallet]);
    const formattedBalance = formatCurrency(balance, language);
    const latestTransactions = transactions.length;

    if (loadingWallet && isLoadingTxs) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('common.loading')}</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-50 min-h-screen pb-40 font-sans text-left">
            <AddFundsModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={async () => { await refreshWallet(); await fetchTransactions(); }} />
            <TransactionDetailModal
                isOpen={isDetailOpen}
                onClose={() => { setIsDetailOpen(false); setSelectedTx(null); }}
                tx={selectedTx}
                onViewRide={handleViewRide}
            />

            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20 shadow-sm">
                <div className="max-w-xl mx-auto flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')} className="rounded-2xl bg-slate-50 size-12">
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div className="text-left">
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">{t('wallet.title')}</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">{t('wallet.subtitle')}</p>
                    </div>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-6 space-y-8 text-left">
                <Card className="border-none shadow-2xl bg-slate-900 overflow-hidden rounded-[2.5rem] relative group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform duration-1000">
                        <Zap className="h-32 w-32 text-white" />
                    </div>
                    <CardContent className="p-8 text-white relative z-10 text-left">
                        <div className="flex justify-between items-start mb-10 text-left">
                            <div className="text-left">
                                <div className="flex items-center gap-2 mb-2">
                                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">{t('wallet.available_balance')}</p>
                                    <button onClick={togglePrivacy}
                                            className="text-slate-500 hover:text-white transition-colors h-10 w-10 flex items-center justify-center rounded-full active:bg-white/10 active:scale-90 touch-action-manipulation">
                                        {showBalance ? <Eye size={16} /> : <EyeOff size={16} />}
                                    </button>
                                </div>
                                <h2 className="text-5xl font-black tracking-tighter italic min-h-[60px]">
                                    {showBalance ? formattedBalance : '••••••'}
                                </h2>
                            </div>
                            <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-xl"><WalletIcon className="h-6 w-6 text-white" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mb-10">
                            <div className="bg-white/5 rounded-3xl p-5 border border-white/5">
                                <p className="text-[8px] text-slate-500 uppercase font-black tracking-[0.2em] mb-2">{t('wallet.in_guarantee')}</p>
                                <p className="text-xl font-black italic">{showBalance ? `${heldBalance.toFixed(2)}€` : '•••'}</p>
                            </div>
                            <div className="bg-white/5 rounded-3xl p-5 border border-white/5 opacity-40">
                                <p className="text-[8px] text-slate-500 uppercase font-black tracking-[0.2em] mb-2">{t('wallet.cashback')}</p>
                                <p className="text-xl font-black italic">0.00€</p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <Button onClick={() => setIsModalOpen(true)}
                                    className="flex-1 h-16 rounded-[1.5rem] bg-white text-slate-900 hover:bg-slate-100 font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all">
                                {t('wallet.add_funds')}
                            </Button>
                            <Button variant="outline"
                                    className="h-16 w-16 rounded-[1.5rem] bg-white/10 border-white/10 text-white hover:bg-white/20 flex items-center justify-center active:scale-95 transition-all"
                                    onClick={() => navigate('/settings')}>
                                <CreditCard className="h-6 w-6" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden">
                    <CardContent className="p-6 space-y-5">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-4 min-w-0">
                                <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                                    <ShieldCheck className="size-6" />
                                </div>
                                <div className="min-w-0 text-left">
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">ShareWay</p>
                                    <h2 className="text-2xl font-black text-slate-900 italic uppercase tracking-tighter leading-none">{copy.centerTitle}</h2>
                                    <p className="text-[11px] font-bold text-slate-500 mt-2 leading-relaxed">{copy.centerDesc}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handleRefresh}
                                disabled={isRefreshing}
                                className="size-12 rounded-2xl bg-slate-50 text-slate-500 flex items-center justify-center active:scale-95 transition-all disabled:opacity-50"
                            >
                                <RefreshCw className={cn('size-5', isRefreshing && 'animate-spin')} />
                            </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-left">
                                <WalletIcon className="size-4 text-emerald-600 mb-2" />
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{copy.available}</p>
                                <p className="text-sm font-black text-slate-900">{showBalance ? formattedBalance : '••••'}</p>
                            </div>
                            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-left">
                                <ShieldCheck className="size-4 text-amber-600 mb-2" />
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{copy.protectedFunds}</p>
                                <p className="text-sm font-black text-slate-900">{showBalance ? `${heldBalance.toFixed(2)}€` : '•••'}</p>
                            </div>
                            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-left">
                                <History className="size-4 text-primary mb-2" />
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{copy.movements}</p>
                                <p className="text-sm font-black text-slate-900">{latestTransactions}</p>
                            </div>
                        </div>

                        <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4 flex items-start gap-3">
                            <Sparkles className="size-4 text-amber-600 mt-0.5 shrink-0" />
                            <p className="text-[11px] font-bold text-amber-700 leading-relaxed">{copy.heldHint}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <Button type="button" onClick={() => navigate('/my-rides?tab=active')} className="h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-[10px] gap-2">
                                <Route className="size-4 text-primary" /> {copy.myTrips}
                            </Button>
                            <Button type="button" onClick={() => navigate('/settings/payout')} variant="outline" className="h-14 rounded-2xl bg-white border-slate-200 text-slate-700 font-black uppercase tracking-widest text-[10px] gap-2">
                                <CreditCard className="size-4 text-primary" /> {copy.paymentSettings}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <div className="space-y-6 text-left">
                    <div className="flex items-center justify-between px-2 text-left">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 italic"><History className="h-4 w-4 text-primary" /> {t('wallet.activity')}</h3>
                        <button type="button" onClick={handleRefresh} className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-primary flex items-center gap-1">
                            <RefreshCw className={cn('size-3', isRefreshing && 'animate-spin')} /> {copy.refresh}
                        </button>
                    </div>
                    <div className="space-y-1">
                        {transactions.length > 0 ? (
                            transactions.map((tx) => <TransactionItem key={tx.id} tx={tx} onClick={handleTxClick} />)
                        ) : (
                            <div className="bg-white border border-dashed border-slate-200 rounded-[3rem] p-10 text-center">
                                <div className="size-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-5">
                                    <History className="h-8 w-8 text-slate-200" />
                                </div>
                                <h3 className="text-sm font-black text-slate-900 uppercase italic mb-2">{copy.emptyTitle}</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">{copy.emptyDesc}</p>
                                <Button onClick={() => setIsModalOpen(true)} className="mt-7 rounded-2xl bg-primary font-black text-[10px] uppercase h-12 px-8 shadow-lg shadow-primary/20">
                                    {t('wallet.add_funds')}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Wallet;
