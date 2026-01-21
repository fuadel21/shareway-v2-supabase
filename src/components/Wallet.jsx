import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';
import AddFundsModal from './AddFundsModal';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import {
    Loader2,
    ArrowUpRight,
    ArrowDownLeft,
    Wallet as WalletIcon,
    Plus,
    Sparkles,
    ShieldCheck,
    History,
    Zap,
    TrendingUp,
    Clock,
    ChevronLeft,
    AlertCircle,
    CreditCard
} from 'lucide-react'; // ✅ CORREGIDO: Importación única y válida
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const TransactionItem = ({ tx, index }) => {
    if (!tx) return null;

    const isDeposit = tx.type === 'deposit_stripe' || tx.type === 'deposit' || tx.type === 'refund' || tx.amount > 0;
    const isHold = tx.type === 'hold';
    const amount = parseFloat(tx.amount || 0);
    const dateObj = new Date(tx.created_at);
    const safeDate = isValid(dateObj) ? format(dateObj, "d MMM, HH:mm", { locale: es }) : "Reciente";

    return (
        <div
            className="group flex items-center justify-between p-5 bg-white border border-slate-100 rounded-[2rem] hover:shadow-md transition-all mb-3 animate-in fade-in slide-in-from-bottom-2"
            style={{ animationDelay: `${index * 50}ms` }}
        >
            <div className="flex items-center gap-4">
                <div className={cn(
                    "h-12 w-12 rounded-2xl flex items-center justify-center shadow-sm border",
                    isDeposit ? "bg-emerald-50 text-emerald-600 border-emerald-100" : isHold ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-slate-50 text-slate-600 border-slate-100"
                )}>
                    {isDeposit ? <ArrowUpRight size={20} /> : isHold ? <ShieldCheck size={20} /> : <ArrowDownLeft size={20} />}
                </div>
                <div className="min-w-0">
                    <p className="font-black text-slate-900 text-[11px] uppercase tracking-tight italic truncate max-w-[180px]">
                        {tx.description || "Transacción"}
                    </p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1 mt-1">
                        <Clock className="h-3 w-3" /> {safeDate}
                    </p>
                </div>
            </div>
            <div className="text-right">
                <p className={cn("font-black text-base tracking-tighter italic", isDeposit ? "text-emerald-600" : "text-slate-900")}>
                    {amount > 0 ? "+" : ""}{amount.toFixed(2)}€
                </p>
                {tx.balance_after && (
                    <p className="text-[8px] text-slate-400 uppercase font-black tracking-widest mt-0.5">Saldo: {parseFloat(tx.balance_after).toFixed(2)}€</p>
                )}
            </div>
        </div>
    );
};

const Wallet = () => {
    const { user } = useOutletContext();
    const navigate = useNavigate();
    const { wallet, loadingWallet, refreshWallet } = useWallet(user);
    const [transactions, setTransactions] = useState([]);
    const [isLoadingTxs, setIsLoadingTxs] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

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
            console.error("Failed to fetch transactions:", e);
        } finally {
            setIsLoadingTxs(false);
        }
    }, [user?.id]);

    useEffect(() => {
        fetchTransactions();

        const channel = supabase.channel(`wallet_txs_${user?.id}`)
            .on('postgres_changes', 
                { event: 'INSERT', schema: 'public', table: 'transactions', filter: `user_id=eq.${user?.id}` },
                () => fetchTransactions()
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [user?.id, fetchTransactions]);

    const balance = useMemo(() => parseFloat(wallet?.balance || 0), [wallet]);
    const heldBalance = useMemo(() => parseFloat(wallet?.heldBalance || 0), [wallet]);

    if (loadingWallet && isLoadingTxs) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sincronizando Bóveda...</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-50 min-h-screen pb-32 font-sans text-left">
            <AddFundsModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={async () => {
                    await refreshWallet();
                    await fetchTransactions();
                }}
            />

            <header className="bg-white px-6 py-8 border-b border-slate-100 sticky top-0 z-20 shadow-sm">
                <div className="max-w-xl mx-auto flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')} className="rounded-2xl bg-slate-50 size-12">
                        <ChevronLeft className="h-6 w-6 text-slate-900" />
                    </Button>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">Mi Cartera</h1>
                        <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">Trust Core™ Active</p>
                    </div>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-6 space-y-8 text-left">
                <Card className="border-none shadow-2xl bg-slate-900 overflow-hidden rounded-[2.5rem] relative group text-left">
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform duration-1000">
                        <Zap className="h-32 w-32 text-white" />
                    </div>
                    <CardContent className="p-8 text-white relative z-10 text-left">
                        <div className="flex justify-between items-start mb-10 text-left">
                            <div>
                                <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">Saldo disponible</p>
                                <h2 className="text-5xl font-black tracking-tighter italic">
                                    {balance.toFixed(2)}<span className="text-2xl ml-1 text-primary">€</span>
                                </h2>
                            </div>
                            <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-xl">
                                <WalletIcon className="h-6 w-6 text-white" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-10 text-left">
                            <div className="bg-white/5 rounded-3xl p-5 border border-white/5 backdrop-blur-sm">
                                <p className="text-[8px] text-slate-500 uppercase font-black tracking-[0.2em] mb-2 flex items-center gap-1">
                                    <ShieldCheck className="h-3 w-3 text-amber-500" /> En garantía
                                </p>
                                <p className="text-xl font-black italic">{heldBalance.toFixed(2)}€</p>
                            </div>
                            <div className="bg-white/5 rounded-3xl p-5 border border-white/5 backdrop-blur-sm opacity-40">
                                <p className="text-[8px] text-slate-500 uppercase font-black tracking-[0.2em] mb-2 flex items-center gap-1">
                                    <TrendingUp className="h-3 w-3" /> Cashback
                                </p>
                                <p className="text-xl font-black italic">0.00€</p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <Button
                                onClick={() => setIsModalOpen(true)}
                                className="flex-1 h-16 rounded-[1.5rem] bg-white text-slate-900 hover:bg-slate-100 font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95 transition-all"
                            >
                                <Plus className="mr-2 h-5 w-5 text-primary" /> RECARGAR SALDO
                            </Button>
                            <Button
                                variant="outline"
                                className="h-16 w-16 rounded-[1.5rem] bg-white/10 border-white/10 text-white hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center"
                                onClick={() => navigate('/settings')}
                            >
                                <CreditCard className="h-6 w-6" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <div className="space-y-6 text-left">
                    <div className="flex items-center justify-between px-2 text-left">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2 italic">
                            <History className="h-4 w-4 text-primary" /> Actividad Financiera
                        </h3>
                    </div>

                    <div className="space-y-1">
                        {transactions.length > 0 ? (
                            transactions.map((tx, idx) => <TransactionItem key={tx.id} tx={tx} index={idx} />)
                        ) : (
                            <div className="bg-white/50 border border-slate-100 rounded-[3rem] p-20 text-center border-dashed">
                                <Sparkles className="h-8 w-8 text-slate-200 mx-auto mb-4" />
                                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic">Bóveda vacía</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Wallet;
