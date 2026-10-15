import React from 'react';
import {
    Dialog,
    DialogContent
} from '@/components/ui/dialog';
import {
    ArrowUpRight,
    ArrowDownLeft,
    ShieldCheck,
    Hash,
    Info,
    MapPin,
    Calendar,
    ChevronRight,
    CircleDot
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FINANCIAL_RULES } from '@/utils/pricingRules.js';

const copyByLanguage = {
    es: {
        recent: 'Reciente',
        route: 'Ruta del Viaje',
        description: 'Descripción',
        noDescription: 'Sin descripción',
        dateTime: 'Fecha y Hora',
        transactionId: 'ID de Transacción',
        relatedRide: 'Viaje Relacionado',
        viewRideDetails: 'Ver detalles del viaje',
        liquidationBreakdown: 'Desglose de Liquidación',
        protected: 'Transacción protegida por el sistema de seguridad ShareWay',
        close: 'Cerrar',
        locale: 'es-ES'
    },
    en: {
        recent: 'Recent',
        route: 'Ride Route',
        description: 'Description',
        noDescription: 'No description',
        dateTime: 'Date and Time',
        transactionId: 'Transaction ID',
        relatedRide: 'Related Ride',
        viewRideDetails: 'View ride details',
        liquidationBreakdown: 'Payout Breakdown',
        protected: 'Transaction protected by the ShareWay security system',
        close: 'Close',
        locale: 'en-US'
    },
    ar: {
        recent: 'حديث',
        route: 'مسار الرحلة',
        description: 'الوصف',
        noDescription: 'لا يوجد وصف',
        dateTime: 'التاريخ والوقت',
        transactionId: 'معرف المعاملة',
        relatedRide: 'رحلة مرتبطة',
        viewRideDetails: 'عرض تفاصيل الرحلة',
        liquidationBreakdown: 'تفاصيل التسوية',
        protected: 'المعاملة محمية بواسطة نظام أمان ShareWay',
        close: 'إغلاق',
        locale: 'ar-SA'
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const formatTransactionDate = (dateValue, copy) => {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return copy.recent;
    return new Intl.DateTimeFormat(copy.locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
};

const formatTransactionAmount = (amount, copy) => new Intl.NumberFormat(copy.locale, {
    style: 'currency',
    currency: 'EUR'
}).format(Math.abs(amount));

const TransactionDetailModal = ({ isOpen, onClose, tx, onViewRide }) => {
    const { t, i18n } = useTranslation();
    const copy = copyByLanguage[getLanguage(i18n.language)];

    if (!tx) return null;

    const isDeposit = tx.type === 'deposit_stripe' || tx.type === 'deposit' || tx.type === 'refund' || tx.amount > 0;
    const isHold = tx.type === 'hold';
    const amount = parseFloat(tx.amount || 0);
    const safeDate = formatTransactionDate(tx.created_at, copy);
    const formattedAmount = formatTransactionAmount(amount, copy);

    const getIcon = () => {
        if (isDeposit) return <ArrowUpRight className="h-8 w-8 text-emerald-600" />;
        if (isHold) return <ShieldCheck className="h-8 w-8 text-amber-600" />;
        return <ArrowDownLeft className="h-8 w-8 text-slate-600" />;
    };

    const getTypeLabel = () => {
        if (tx.type === 'payout' || tx.type === 'earning') return t('wallet.tx_types.payout');
        if (tx.type === 'withdrawal') return t('wallet.tx_types.withdrawal');
        if (tx.type === 'hold') return t('wallet.tx_types.ride_escrow');
        if (tx.type === 'refund') return t('wallet.tx_types.refund');
        if (tx.type === 'deposit_stripe') return t('wallet.tx_types.stripe_deposit');
        if (tx.type === 'compensation') return t('wallet.tx_types.compensation');
        return t('wallet.tx_types.generic');
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="rounded-3xl border-none shadow-2xl p-0 max-w-md bg-white overflow-hidden outline-none">
                <div className={cn(
                    'p-8 flex flex-col items-center justify-center text-center space-y-4',
                    isDeposit ? 'bg-emerald-50/50' : isHold ? 'bg-amber-50/50' : 'bg-slate-50'
                )}>
                    <div className={cn(
                        'h-20 w-20 rounded-3xl flex items-center justify-center shadow-sm border mb-2 bg-white',
                        isDeposit ? 'border-emerald-100' : isHold ? 'border-amber-100' : 'border-slate-100'
                    )}>
                        {getIcon()}
                    </div>
                    <div>
                        <h2 className={cn(
                            'text-4xl font-black tracking-tighter italic',
                            isDeposit ? 'text-emerald-600' : 'text-slate-900'
                        )}>
                            {isDeposit ? '+' : '-'}{formattedAmount}
                        </h2>
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mt-1">
                            {getTypeLabel()}
                        </p>
                    </div>
                </div>

                <div className="p-8 space-y-6">
                    <div className="space-y-4">
                        <div className="flex items-start gap-4">
                            <div className="mt-1 bg-slate-100 p-2 rounded-xl">
                                {tx.description?.includes(' -> ') ? (
                                    <MapPin className="size-4 text-primary" />
                                ) : (
                                    <Info className="size-4 text-slate-500" />
                                )}
                            </div>
                            <div className="flex-1">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">
                                    {tx.description?.includes(' -> ') ? copy.route : copy.description}
                                </p>
                                <p className="text-sm font-bold text-slate-700 leading-tight uppercase italic">
                                    {tx.description?.includes(' -> ')
                                        ? tx.description.replace(/^(Pago viaje: |Cobro viaje: )/i, '')
                                        : (tx.description || copy.noDescription)}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="mt-1 bg-slate-100 p-2 rounded-xl">
                                <Calendar className="size-4 text-slate-500" />
                            </div>
                            <div className="flex-1">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{copy.dateTime}</p>
                                <p className="text-sm font-bold text-slate-700 uppercase italic">{safeDate}</p>
                            </div>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="mt-1 bg-slate-100 p-2 rounded-xl">
                                <Hash className="size-4 text-slate-500" />
                            </div>
                            <div className="flex-1">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{copy.transactionId}</p>
                                <p className="text-[10px] font-mono font-bold text-slate-400 break-all uppercase tracking-tighter">{tx.id}</p>
                            </div>
                        </div>

                        {tx.related_ride_id && (
                            <div className="flex items-start gap-4 pt-2">
                                <div className="mt-1 bg-primary/10 p-2 rounded-xl">
                                    <CircleDot className="size-4 text-primary" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-1">{copy.relatedRide}</p>
                                    <Button
                                        variant="link"
                                        className="h-auto p-0 text-slate-900 font-black italic uppercase text-xs hover:text-primary transition-colors flex items-center gap-1"
                                        onClick={() => onViewRide(tx.related_ride_id)}
                                    >
                                        {copy.viewRideDetails} <ChevronRight size={14} />
                                    </Button>
                                </div>
                            </div>
                        )}

                        {(tx.type === 'payout' || tx.type === 'earning') && (
                            <div className="mt-4 p-5 bg-slate-900 rounded-3xl text-white space-y-3">
                                <p className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">{copy.liquidationBreakdown}</p>
                                <div className="flex justify-between items-center text-[11px]">
                                    <span className="text-slate-400 font-bold uppercase">{t('wallet.breakdown.total_gross')}</span>
                                    <span className="font-black italic">{(amount / FINANCIAL_RULES.DRIVER_PAYOUT_RATE).toFixed(2)}€</span>
                                </div>
                                <div className="flex justify-between items-center text-[11px]">
                                    <span className="text-slate-400 font-bold uppercase">{t('wallet.breakdown.platform_fee')}</span>
                                    <span className="text-red-400 font-black italic">-{(amount / FINANCIAL_RULES.DRIVER_PAYOUT_RATE * FINANCIAL_RULES.PLATFORM_COMMISSION_RATE).toFixed(2)}€</span>
                                </div>
                                <div className="pt-2 border-t border-white/10 flex justify-between items-center">
                                    <span className="text-primary font-black uppercase text-[10px] tracking-tight">{t('wallet.breakdown.driver_payout')}</span>
                                    <span className="text-lg font-black italic text-white">{amount.toFixed(2)}€</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="pt-4 border-t border-slate-100">
                        <div className="bg-slate-50 rounded-2xl p-4 flex items-center gap-3">
                            <ShieldCheck className="size-5 text-emerald-500" />
                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none">
                                {copy.protected}
                            </p>
                        </div>
                    </div>

                    <Button
                        onClick={onClose}
                        className="w-full h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
                    >
                        {copy.close}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default TransactionDetailModal;
