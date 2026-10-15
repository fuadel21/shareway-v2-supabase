import React, { useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button.jsx';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, ShieldCheck, AlertCircle, Euro } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

const copyByLanguage = {
    es: {
        balanceDelay: 'Pago recibido, pero el saldo tardará unos minutos en aparecer.',
        completed: '¡Recarga completada!',
        cancel: 'Cancelar',
        pay: 'Pagar',
        minAmount: 'Mínimo 5.00 €',
        paymentUnavailable: 'Motor de pagos no disponible.',
        title: 'Recarga',
        continue: 'Continuar'
    },
    en: {
        balanceDelay: 'Payment received, but the balance may take a few minutes to appear.',
        completed: 'Top-up completed!',
        cancel: 'Cancel',
        pay: 'Pay',
        minAmount: 'Minimum 5.00 €',
        paymentUnavailable: 'Payment engine unavailable.',
        title: 'Top Up',
        continue: 'Continue'
    },
    ar: {
        balanceDelay: 'تم استلام الدفع، لكن قد يستغرق ظهور الرصيد بضع دقائق.',
        completed: 'تمت إعادة الشحن!',
        cancel: 'إلغاء',
        pay: 'دفع',
        minAmount: 'الحد الأدنى 5.00 €',
        paymentUnavailable: 'محرك الدفع غير متاح.',
        title: 'شحن الرصيد',
        continue: 'متابعة'
    }
};

const getLanguage = (language) => {
    if (language?.startsWith('ar')) return 'ar';
    if (language?.startsWith('en')) return 'en';
    return 'es';
};

const CheckoutForm = ({ amount, onSuccessfulPayment, onClose, copy }) => {
    const stripe = useStripe();
    const elements = useElements();
    const { user } = useOutletContext();
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!stripe || !elements || !user || isLoading) return;

        setIsLoading(true);
        setErrorMessage(null);

        try {
            const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
                elements,
                confirmParams: {
                    return_url: `${window.location.origin}/wallet`,
                    payment_method_data: { billing_details: { email: user.email } }
                },
                redirect: 'if_required',
            });

            if (confirmError) throw confirmError;

            if (paymentIntent?.status === 'succeeded') {
                // The Stripe webhook is the only authority allowed to credit the
                // wallet. Do not let the browser submit an amount or duplicate
                // credit after a successful card confirmation.
                toast.success(copy.completed, { description: copy.balanceDelay });
                onSuccessfulPayment();
            }
        } catch (err) {
            setErrorMessage(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in">
            <div className="p-1 bg-slate-50 rounded-3xl border border-slate-100 shadow-inner overflow-hidden">
                <ScrollArea className="h-[320px] px-4 py-2">
                    <PaymentElement options={{ layout: 'accordion' }} />
                </ScrollArea>
            </div>
            {errorMessage && (
                <div className="p-4 bg-red-50 text-red-600 text-[11px] font-bold rounded-2xl border border-red-100 flex items-start gap-2">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                </div>
            )}
            <div className="flex gap-3">
                <Button type="button" onClick={onClose} variant="ghost" disabled={isLoading} className="rounded-xl font-bold text-slate-400">{copy.cancel}</Button>
                <Button type="submit" disabled={!stripe || isLoading} className="flex-1 h-14 rounded-2xl bg-slate-900 text-white font-black uppercase italic tracking-widest shadow-xl">
                    {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : `${copy.pay} ${amount.toFixed(2)}€`}
                </Button>
            </div>
        </form>
    );
};

const AddFundsModal = ({ isOpen, onClose, onSuccess }) => {
    const { user } = useOutletContext();
    const { i18n } = useTranslation();
    const copy = copyByLanguage[getLanguage(i18n.language)];
    const [amount, setAmount] = useState(20);
    const [step, setStep] = useState('amount');
    const [clientSecret, setClientSecret] = useState(null);
    const [isPreparing, setIsPreparing] = useState(false);
    const topUpKeyRef = useRef(null);

    const handleContinue = async () => {
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount < 5) return toast.error(copy.minAmount);
        setIsPreparing(true);
        topUpKeyRef.current = globalThis.crypto?.randomUUID?.() || `topup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try {
            const { data, error } = await supabase.functions.invoke('create-payment-intent', {
                body: { amount: numAmount, idempotencyKey: topUpKeyRef.current },
            });
            if (error || data?.error || !data?.clientSecret) {
                throw new Error(data?.error?.message || data?.error || copy.paymentUnavailable);
            }
            setClientSecret(data.clientSecret);
            setStep('payment');
        } catch (e) {
            toast.error(e.message);
        } finally {
            setIsPreparing(false);
        }
    };

    const resetAndClose = () => {
        setStep('amount');
        setClientSecret(null);
        topUpKeyRef.current = null;
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && resetAndClose()}>
            <DialogContent className="rounded-3xl border-none shadow-2xl p-8 max-w-md bg-white outline-none max-h-[90vh]">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <div className="size-12 bg-slate-900 rounded-2xl flex items-center justify-center shadow-lg">
                            <ShieldCheck className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter text-slate-900">{copy.title}</DialogTitle>
                            <DialogDescription className="text-[9px] font-black uppercase tracking-[0.3em] text-primary">Trust Core™ Financial</DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {step === 'amount' ? (
                    <div className="space-y-8 pt-6 animate-in fade-in">
                        <div className="relative group">
                            <Input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="pl-12 h-24 rounded-3xl bg-slate-50 border-none font-black text-4xl italic text-slate-900"
                            />
                            <Euro className="absolute left-5 top-1/2 -translate-y-1/2 text-primary size-6" />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            {[10, 20, 50].map(val => (
                                <button key={val} type="button" onClick={() => setAmount(val)} className={cn('rounded-2xl h-12 font-black text-sm transition-all border-2', Number(amount) === val ? 'bg-primary border-primary text-white shadow-lg' : 'bg-white border-slate-100 text-slate-400')}>{val}€</button>
                            ))}
                        </div>
                        <Button onClick={handleContinue} disabled={isPreparing || !amount} className="w-full h-14 rounded-3xl bg-slate-900 text-white font-black text-lg uppercase shadow-2xl active:scale-95 transition-all">
                            {isPreparing ? <Loader2 className="size-6 animate-spin" /> : copy.continue}
                        </Button>
                    </div>
                ) : (
                    <div className="pt-4 overflow-hidden">
                        {clientSecret && (
                            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'flat' } }}>
                                <CheckoutForm amount={Number(amount)} onSuccessfulPayment={() => { onSuccess(); resetAndClose(); }} onClose={resetAndClose} copy={copy} />
                            </Elements>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default AddFundsModal;
