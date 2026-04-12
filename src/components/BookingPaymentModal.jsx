import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, PaymentRequestButtonElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button.jsx';
import { Loader2, Lock, CreditCard, ShieldCheck, AlertCircle } from 'lucide-react';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

const CheckoutForm = ({ rideId, amount, pickupLocation, pickupAddress, onSuccess, onClose, clientSecret }) => {
    const stripe = useStripe();
    const elements = useElements();
    const { user } = useOutletContext();
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);
    const [paymentRequest, setPaymentRequest] = useState(null);
    const [isProcessingServer, setIsProcessingServer] = useState(false);

    useEffect(() => {
        if (stripe) {
            const pr = stripe.paymentRequest({
                country: 'ES',
                currency: 'eur',
                total: { label: 'Reserva ShareWay', amount: Math.round(amount * 100) },
                requestPayerName: true,
                requestPayerEmail: true,
            });

            pr.canMakePayment().then(result => {
                if (result) setPaymentRequest(pr);
            });

            pr.on('paymentmethod', async (ev) => {
                const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
                    clientSecret,
                    { payment_method: ev.paymentMethod.id },
                    { handleActions: false }
                );

                if (confirmError) {
                    ev.complete('fail');
                    setErrorMessage(confirmError.message);
                } else {
                    ev.complete('success');
                    if (paymentIntent.status === "succeeded") {
                        await handlePostPayment(paymentIntent.id);
                    }
                }
            });
        }
    }, [stripe, amount, clientSecret]);

    const handlePostPayment = async (paymentIntentId) => {
        setIsProcessingServer(true);
        setErrorMessage(null);
        let attempts = 0;
        const maxAttempts = 15; // 30 seconds

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
                await handlePostPayment(paymentIntent.id);
            }
        } catch (err) {
            setErrorMessage(err.message || "Error inesperado.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in zoom-in duration-300">
            <div className="bg-slate-900 rounded-3xl p-6 text-white relative overflow-hidden group shadow-2xl mb-4 text-left">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                    <ShieldCheck size={80} />
                </div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-1">Costo de Reserva</p>
                <p className="text-4xl font-black italic tracking-tighter">
                    {amount.toFixed(2)}<span className="text-xl ml-1">€</span>
                </p>
            </div>

            {paymentRequest && (
                <div className="mb-4">
                    <div className="mb-2"><PaymentRequestButtonElement options={{ paymentRequest }} /></div>
                    <div className="relative flex items-center gap-4 my-6">
                        <div className="h-px bg-slate-100 flex-1" />
                        <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest">o con tarjeta</span>
                        <div className="h-px bg-slate-100 flex-1" />
                    </div>
                </div>
            )}

            <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-inner">
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
                            <Lock className="h-4 w-4" /> {isProcessingServer ? "Procesando..." : "Pagar y Reservar"}
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
    const [clientSecret, setClientSecret] = useState(null);
    const [isPreparing, setIsPreparing] = useState(false);

    useEffect(() => {
        const preparePayment = async () => {
            if (isOpen && rideId && user) {
                setIsPreparing(true);
                setClientSecret(null);
                try {
                    const { data, error } = await supabase.functions.invoke('create-booking-payment-intent', {
                        body: { rideId, pickupLocation, pickupAddress, totalAmount: amount },
                    });
                    if (error || !data?.clientSecret) {
                        const errMsg = data?.error?.message || error?.message || "Motor de reservas no disponible";
                        throw new Error(errMsg);
                    }
                    setClientSecret(data.clientSecret);
                } catch (e) {
                    toast.error("Error de reserva", { description: e.message });
                    onClose();
                } finally {
                    setIsPreparing(false);
                }
            }
        };
        preparePayment();
    }, [isOpen, rideId, user]);

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
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Iniciando protocolo de reserva...</p>
                        </div>
                    ) : clientSecret ? (
                        <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'flat' } }}>
                            <CheckoutForm
                                rideId={rideId}
                                amount={amount}
                                pickupLocation={pickupLocation}
                                pickupAddress={pickupAddress}
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
