import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import * as rpc from '@/lib/supabaseRPC';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button.jsx';
import { Loader2, ShieldCheck, AlertCircle, Lock, Euro } from 'lucide-react';
import { cn } from '@/lib/utils';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

const CheckoutForm = ({ amount, onSuccessfulPayment, onClose }) => {
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
                const { success } = await rpc.safeCall(
                    supabase.rpc('credit_wallet_on_success', { 
                        p_payment_intent_id: paymentIntent.id,
                        p_amount: amount 
                    }),
                    'credit_wallet_on_success'
                );

                if (!success) throw new Error("Pago recibido, pero el saldo tardará unos minutos en aparecer.");

                toast.success("¡Recarga completada!");
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
            <div className="p-5 bg-slate-50 rounded-3xl border border-slate-100 shadow-inner min-h-[280px]">
                <PaymentElement options={{ layout: 'accordion' }} />
            </div>
            {errorMessage && (
                <div className="p-4 bg-red-50 text-red-600 text-[11px] font-bold rounded-2xl border border-red-100 flex items-start gap-2">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                </div>
            )}
            <div className="flex gap-3">
                <Button type="button" onClick={onClose} variant="ghost" disabled={isLoading} className="rounded-xl font-bold text-slate-400">Cancelar</Button>
                <Button type="submit" disabled={!stripe || isLoading} className="flex-1 h-14 rounded-2xl bg-slate-900 text-white font-black uppercase italic tracking-widest shadow-xl">
                    {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : `PAGAR ${amount.toFixed(2)}€`}
                </Button>
            </div>
        </form>
    );
};

const AddFundsModal = ({ isOpen, onClose, onSuccess }) => {
    const { user } = useOutletContext();
    const [amount, setAmount] = useState(20);
    const [step, setStep] = useState('amount'); 
    const [clientSecret, setClientSecret] = useState(null);
    const [isPreparing, setIsPreparing] = useState(false);

    const handleContinue = async () => {
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount < 5) return toast.error("Mínimo 5.00 €");
        setIsPreparing(true);
        try {
            const { data, error } = await supabase.functions.invoke('create-payment-intent', {
                body: { amount: numAmount, user_id: user.id },
            });
            if (error || !data?.clientSecret) throw new Error("Motor de pagos no disponible.");
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
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && resetAndClose()}>
            <DialogContent className="rounded-[2.5rem] border-none shadow-2xl p-8 max-w-md bg-white outline-none">
                <DialogHeader className="space-y-2">
                    <div className="flex items-center gap-3">
                        <div className="size-12 bg-slate-900 rounded-2xl flex items-center justify-center shadow-lg">
                            <ShieldCheck className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter text-slate-900">Recarga</DialogTitle>
                            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-primary">Trust Core™ Financial</p>
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
                                className="pl-12 h-24 rounded-[2rem] bg-slate-50 border-none font-black text-4xl italic text-slate-900" 
                            />
                            <Euro className="absolute left-5 top-1/2 -translate-y-1/2 text-primary size-6" />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            {[10, 20, 50].map(val => (
                                <button key={val} type="button" onClick={() => setAmount(val)} className={cn("rounded-2xl h-16 font-black text-sm transition-all border-2", Number(amount) === val ? "bg-primary border-primary text-white shadow-lg" : "bg-white border-slate-100 text-slate-400")}>{val}€</button>
                            ))}
                        </div>
                        <Button onClick={handleContinue} disabled={isPreparing || !amount} className="w-full h-20 rounded-[2rem] bg-slate-900 text-white font-black text-lg uppercase shadow-2xl active:scale-95 transition-all">
                            {isPreparing ? <Loader2 className="size-6 animate-spin" /> : "CONTINUAR"}
                        </Button>
                    </div>
                ) : (
                    <div className="pt-4 min-h-[350px]">
                        {clientSecret && (
                            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'flat' } }}>
                                <CheckoutForm amount={Number(amount)} onSuccessfulPayment={() => { onSuccess(); resetAndClose(); }} onClose={resetAndClose} />
                            </Elements>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default AddFundsModal;
