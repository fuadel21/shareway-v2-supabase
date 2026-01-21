import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button.jsx';
import { Loader2, Lock, CreditCard, ShieldCheck, AlertCircle } from 'lucide-react'; // FASE 8: AlertCircle importado
import * as rpc from '@/lib/supabaseRPC';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

const CheckoutForm = ({ amount, onSuccess, onClose, clientSecret }) => {
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
            // 1. Confirmar Pago (clientSecret ya inyectado en el Provider)
            const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
                elements,
                confirmParams: { 
                    return_url: `${window.location.origin}/wallet`,
                },
                redirect: 'if_required',
            });

            if (confirmError) {
                setErrorMessage(confirmError.message);
            } else if (paymentIntent.status === 'succeeded') {
                // 2. BLINDAJE CRÍTICO: Acreditar en Wallet (Backend) 
                const { success, error: creditError } = await rpc.safeCall(
                    supabase.rpc('credit_wallet_on_success', { 
                        p_payment_intent_id: paymentIntent.id,
                        p_amount: amount 
                    }),
                    'credit_wallet_on_success'
                );
                
                if (!success) {
                    console.error("🛡️ stability: Direct payment wallet sync failure:", creditError);
                    toast.error('Pago recibido pero hubo un error en la sincronización.', { 
                        description: 'No cierres la app. Tu saldo se actualizará automáticamente.' 
                    });
                } else {
                    toast.success("¡Capital Validado!", { description: "Confirmando tu plaza en el viaje..." });
                    if (onSuccess) await onSuccess(); 
                }
            }
        } catch (err) {
            console.error("🛡️ Checkout Error:", err);
            setErrorMessage(err.message || "Error inesperado en el proceso de pago.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in zoom-in duration-300">
            <div className="bg-slate-900 rounded-3xl p-6 text-white relative overflow-hidden group shadow-2xl mb-4">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                    <ShieldCheck size={80} />
                </div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-1">Diferencia a cubrir</p>
                <p className="text-4xl font-black italic tracking-tighter">
                    {amount.toFixed(2)}<span className="text-xl ml-1">€</span>
                </p>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-inner min-h-[250px]">
                <PaymentElement options={{ layout: 'tabs' }} />
            </div>
            
            {errorMessage && (
                <div className="text-red-600 text-xs font-bold bg-red-50 p-4 rounded-2xl border border-red-100 flex items-start gap-2 animate-in shake-in">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                </div>
            )}
            
            <div className="flex gap-3">
                <Button 
                    type="button" 
                    variant="ghost" 
                    onClick={onClose} 
                    disabled={isLoading}
                    className="flex-1 h-14 rounded-2xl font-bold text-slate-400"
                >
                    Cancelar
                </Button>
                <Button 
                    type="submit" 
                    disabled={!stripe || isLoading} 
                    className="flex-[2] h-14 rounded-2xl bg-slate-900 text-white font-black uppercase italic tracking-widest shadow-xl hover:scale-[1.02] active:scale-95 transition-all"
                >
                    {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                        <span className="flex items-center gap-2">
                            <Lock className="h-4 w-4" /> Pagar y Reservar
                        </span>
                    )}
                </Button>
            </div>
        </form>
    );
};

const BookingPaymentModal = ({ isOpen, onClose, amount, onSuccess }) => {
    const { user } = useOutletContext();
    const [clientSecret, setClientSecret] = useState(null);
    const [isPreparing, setIsPreparing] = useState(false);

    useEffect(() => {
        const preparePayment = async () => {
            if (isOpen && amount > 0 && user) {
                setIsPreparing(true);
                try {
                    const { data, error } = await supabase.functions.invoke('create-payment-intent', {
                        body: { amount, user_id: user.id },
                    });
                    if (error || !data?.clientSecret) throw new Error("Motor de pagos no disponible");
                    setClientSecret(data.clientSecret);
                } catch (e) {
                    toast.error("Error financiero", { description: e.message });
                    onClose();
                } finally {
                    setIsPreparing(false);
                }
            }
        };
        preparePayment();
    }, [isOpen, amount, user]);

    const handleClose = () => {
        if (!isPreparing) {
            setClientSecret(null);
            onClose();
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="sm:max-w-[460px] rounded-[2.5rem] border-none shadow-2xl p-8 bg-slate-50/50 backdrop-blur-3xl overflow-hidden outline-none">
                <DialogHeader className="space-y-2">
                    <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter text-slate-900 flex items-center gap-3">
                        <div className="size-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
                            <CreditCard className="h-5 w-5 text-white" />
                        </div>
                        Completar Pago
                    </DialogTitle>
                    <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Protocolo de Pago Blindado ShareWay
                    </DialogDescription>
                </DialogHeader>
                
                <div className="mt-4">
                    {isPreparing ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Enlazando con Stripe...</p>
                        </div>
                    ) : clientSecret ? (
                        <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'flat' } }}>
                            <CheckoutForm 
                                amount={amount} 
                                clientSecret={clientSecret}
                                onSuccess={onSuccess} 
                                onClose={handleClose} 
                            />
                        </Elements>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default BookingPaymentModal;
