import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase.js';
import { confirmTripAndPay } from '../lib/supabaseRPC.js';
import { useWallet } from '../hooks/useWallet.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog.jsx';
import { Button } from './ui/button.jsx';
import { 
    Loader2, Lock, CreditCard, ShieldCheck, 
    AlertCircle, Wallet, CheckCircle2, ChevronRight 
} from 'lucide-react';
import { cn } from '../lib/utils.js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

const CheckoutForm = ({ rideId, amount, onSuccess, onClose, clientSecret }) => {
    const stripe = useStripe();
    const elements = useElements();
    const { user } = useOutletContext();
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);
    const [isProcessingServer, setIsProcessingServer] = useState(false);

    const handlePostPayment = async () => {
        setIsProcessingServer(true);
        setErrorMessage(null);
        let attempts = 0;
        const maxAttempts = 15;

        const checkBooking = async () => {
            try {
                const { data: ride } = await supabase.from('rides')
                    .select('participant_ids')
                    .eq('id', rideId)
                    .single();

                if (ride?.participant_ids?.includes(user?.id)) {
                    toast.success("¡Reserva confirmada!", {
                        description: "Tu plaza y tu pago han sido asegurados correctamente."
                    });
                    if (onSuccess) await onSuccess();
                    return;
                }
            } catch (e) {
                console.warn("Polling error:", e);
            }
            
            attempts++;
            if (attempts >= maxAttempts) {
                setErrorMessage("El banco ha confirmado el pago, pero internet va lento. Recarga la app en unos minutos.");
                setIsProcessingServer(false);
            } else {
                setTimeout(checkBooking, 2000);
            }
        };

        checkBooking();
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!stripe || !elements || !user || isLoading) return;

        setIsLoading(true);
        setErrorMessage(null);

        try {
            const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
                elements,
                confirmParams: { return_url: window.location.href },
                redirect: 'if_required',
            });

            if (confirmError) {
                setErrorMessage(confirmError.message);
            } else if (paymentIntent.status === 'succeeded') {
                await handlePostPayment();
            }
        } catch (err) {
            setErrorMessage(err.message || "Error inesperado.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in zoom-in duration-300">
            <div className="p-4 bg-white rounded-3xl border border-slate-100 shadow-inner">
                <PaymentElement options={{ layout: 'accordion' }} />
            </div>

            {errorMessage && (
                <div className="text-red-600 text-xs font-bold bg-red-50 p-4 rounded-2xl border border-red-100 flex items-start gap-2 text-left">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                </div>
            )}

            <div className="flex gap-3">
                <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading || isProcessingServer} className="flex-1 h-14 rounded-2xl font-bold text-slate-400">Cancelar</Button>
                <Button type="submit" disabled={!stripe || isLoading || isProcessingServer} className="flex-[2] h-14 rounded-2xl bg-slate-900 text-white font-black uppercase italic tracking-widest shadow-xl">
                    {(isLoading || isProcessingServer) ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                        <span className="flex items-center gap-2">
                            <Lock className="h-4 w-4" /> {isProcessingServer ? "Procesando..." : "Confirmar Pago"}
                        </span>
                    )}
                </Button>
            </div>
            
            {isProcessingServer && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-3xl animate-in zoom-in">
                    <Loader2 className="h-12 w-12 animate-spin text-slate-900 mb-4" />
                    <p className="text-sm font-black uppercase tracking-widest text-slate-900">Validando pago en red...</p>
                    <p className="text-xs text-slate-500 mt-2 text-center px-4">Esto puede tardar unos segundos. Por favor, no cierres esta ventana.</p>
                </div>
            )}
        </form>
    );
};

const BookingPaymentModal = ({ isOpen, onClose, rideId, amount, pickupLocation, pickupAddress, onSuccess }) => {
    const { user } = useOutletContext();
    const { wallet, refreshWallet } = useWallet(user);
    const [paymentMethod, setPaymentMethod] = useState('wallet');
    const [clientSecret, setClientSecret] = useState(null);
    const [isPreparing, setIsPreparing] = useState(false);
    const [isProcessingWallet, setIsProcessingWallet] = useState(false);

    const hasBalance = wallet?.balance >= amount;

    useEffect(() => {
        if (isOpen && wallet) {
            setPaymentMethod(wallet.balance >= amount ? 'wallet' : 'card');
        }
    }, [isOpen, wallet, amount]);

    useEffect(() => {
        const prepareStripe = async () => {
            if (isOpen && paymentMethod === 'card' && !clientSecret && rideId && user) {
                setIsPreparing(true);
                try {
                    const { data, error } = await supabase.functions.invoke('create-booking-payment-intent', {
                        body: { rideId, pickupLocation, pickupAddress, totalAmount: amount },
                    });
                    if (error || !data?.clientSecret) throw new Error(data?.error?.message || "Stripe no disponible");
                    setClientSecret(data.clientSecret);
                } catch (e) {
                    toast.error("Error Stripe", { description: e.message });
                    setPaymentMethod('wallet');
                } finally {
                    setIsPreparing(false);
                }
            }
        };
        prepareStripe();
    }, [isOpen, paymentMethod, rideId, user, amount, clientSecret]);

    const handleWalletPayment = async () => {
        setIsProcessingWallet(true);
        try {
            const { success, error, data } = await confirmTripAndPay(rideId, null, {
                pickupLocation: pickupLocation ?? null,
                pickupAddress: pickupAddress ?? null,
                price: amount != null ? Number(amount) : null
            });

            if (!success) throw new Error(error || 'No se pudo procesar la reserva.');

            if (data?.success) {
                toast.success("¡Reserva confirmada!", {
                    description: "Se ha descontado el importe de tu saldo ShareWay."
                });
                refreshWallet();
                if (onSuccess) await onSuccess();
            } else {
                toast.error("Error en reserva", { description: data?.message || "No se pudo procesar." });
            }
        } catch (e) {
            toast.error("Error crítico", { description: e.message });
        } finally {
            setIsProcessingWallet(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            {/* CORRECCIÓN FINAL: Z-INDEX SUPERIOR AL BOTTOM NAVBAR (Z-100) Y PADDING AGRESIVO */}
            <DialogContent className="sm:max-w-[460px] rounded-[2.5rem] border-none shadow-2xl p-0 bg-slate-50 overflow-hidden outline-none z-[100]">
                <div className="h-full max-h-[90vh] flex flex-col">
                    
                    {/* Header Fijo */}
                    <div className="p-8 pb-4">
                        <DialogHeader className="space-y-1">
                            <DialogTitle className="text-2xl font-black italic uppercase tracking-tighter text-slate-900 flex items-center gap-3">
                                <div className="size-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
                                    <Lock className="h-5 w-5 text-white" />
                                </div>
                                Finalizar Reserva
                            </DialogTitle>
                            <DialogDescription className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Selecciona tu método de pago seguro
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    {/* Contenido con Scroll y margen de seguridad extra */}
                    <div className="flex-1 overflow-y-auto px-8 pb-32 no-scrollbar">
                        <div className="space-y-6">
                            {/* INFO PRECIO */}
                            <div className="bg-slate-900 rounded-3xl p-6 text-white relative overflow-hidden group shadow-xl text-left">
                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                                    <ShieldCheck size={80} />
                                </div>
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-1">Total a pagar</p>
                                <p className="text-4xl font-black italic tracking-tighter">
                                    {Number(amount).toFixed(2)}<span className="text-xl ml-1">€</span>
                                </p>
                            </div>

                            {/* SELECTOR DE MÉTODO */}
                            <div className="grid grid-cols-2 gap-3">
                                <button 
                                    onClick={() => setPaymentMethod('wallet')}
                                    className={cn(
                                        "flex flex-col items-center justify-center gap-2 p-4 rounded-3xl border-2 transition-all",
                                        paymentMethod === 'wallet' 
                                            ? "bg-white border-primary shadow-lg ring-1 ring-primary/20" 
                                            : "bg-slate-100/50 border-transparent text-slate-400 hover:bg-white"
                                    )}
                                >
                                    <Wallet size={20} className={paymentMethod === 'wallet' ? "text-primary" : ""} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Billetera</span>
                                </button>
                                <button 
                                    onClick={() => setPaymentMethod('card')}
                                    className={cn(
                                        "flex flex-col items-center justify-center gap-2 p-4 rounded-3xl border-2 transition-all",
                                        paymentMethod === 'card' 
                                            ? "bg-white border-primary shadow-lg ring-1 ring-primary/20" 
                                            : "bg-slate-100/50 border-transparent text-slate-400 hover:bg-white"
                                    )}
                                >
                                    <CreditCard size={20} className={paymentMethod === 'card' ? "text-primary" : ""} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Tarjeta</span>
                                </button>
                            </div>

                            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                                {paymentMethod === 'wallet' ? (
                                    <div className="space-y-4">
                                        <div className={cn(
                                            "p-5 rounded-3xl border-2 flex items-center justify-between",
                                            hasBalance ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"
                                        )}>
                                            <div className="text-left">
                                                <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Saldo Disponible</p>
                                                <p className={cn("text-xl font-black", hasBalance ? "text-emerald-700" : "text-red-700")}>
                                                    {wallet?.balance?.toFixed(2) || '0.00'}€
                                                </p>
                                            </div>
                                            {hasBalance ? <CheckCircle2 className="text-emerald-500" /> : <AlertCircle className="text-red-500" />}
                                        </div>

                                        {hasBalance ? (
                                            <Button 
                                                onClick={handleWalletPayment}
                                                disabled={isProcessingWallet}
                                                className="w-full h-16 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase italic tracking-widest shadow-xl shadow-emerald-200"
                                            >
                                                {isProcessingWallet ? <Loader2 className="animate-spin" /> : <>Confirmar con Saldo <ChevronRight className="ml-2" size={18} /></>}
                                            </Button>
                                        ) : (
                                            <div className="space-y-3">
                                                <p className="text-[10px] text-red-600 font-bold text-center italic">No tienes saldo suficiente en tu billetera.</p>
                                                <Button 
                                                    onClick={() => setPaymentMethod('card')}
                                                    variant="outline" 
                                                    className="w-full h-14 rounded-2xl border-slate-200 text-slate-600 font-black uppercase tracking-widest"
                                                >
                                                    Usar Tarjeta de Crédito
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {isPreparing ? (
                                            <div className="flex flex-col items-center justify-center py-10 gap-3">
                                                <Loader2 className="animate-spin text-primary opacity-20" size={30} />
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Enlazando con Stripe...</p>
                                            </div>
                                        ) : clientSecret ? (
                                            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'flat' } }}>
                                                <CheckoutForm
                                                    rideId={rideId}
                                                    amount={amount}
                                                    onSuccess={onSuccess}
                                                    onClose={onClose}
                                                    clientSecret={clientSecret}
                                                />
                                            </Elements>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default BookingPaymentModal;
