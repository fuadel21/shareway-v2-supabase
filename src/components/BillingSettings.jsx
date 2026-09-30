import React, { useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';

import SubPageHeader from './SubPageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import CheckoutForm from './CheckoutForm';
import { Loader2 } from 'lucide-react';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

const creditPackages = [
    { credits: 5, price: 5.00, id: 'price_1PFl0SRxcm33Sg25w6a9aUtq' },
    { credits: 10, price: 10.00, id: 'price_1PFl0jRxcm33Sg255VzD22M0' },
    { credits: 25, price: 25.00, id: 'price_1PFl0wRxcm33Sg25bX1yVfKx' },
    { credits: 50, price: 50.00, id: 'price_1PFl1ERxcm33Sg258Jc8E9E2' },
];

const BillingSettings = () => {
    const { profile, user } = useOutletContext();
    const [selectedPackage, setSelectedPackage] = useState(null);
    const [paymentClientSecret, setPaymentClientSecret] = useState(null);
    const [payoutAmount, setPayoutAmount] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isCreatingLink, setIsCreatingLink] = useState(false);
    const [isRequestingPayout, setIsRequestingPayout] = useState(false);
    const creditPurchaseKeyRef = useRef(null);
    const payoutRequestKeyRef = useRef(null);

    const handlePackageSelect = async (pkg) => {
        if (!profile) {
            toast.error("Debes iniciar sesión para comprar créditos.");
            return;
        }

        setSelectedPackage(pkg);
        setIsProcessing(true);
        creditPurchaseKeyRef.current = globalThis.crypto?.randomUUID?.() || `credits-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        try {
            const { data, error } = await supabase.functions.invoke('create-payment-intent', {
                body: { packageId: pkg.id, idempotencyKey: creditPurchaseKeyRef.current }
            });

            if (error) throw error;

            if (data.clientSecret) {
                setPaymentClientSecret(data.clientSecret);
            } else {
                throw new Error("No se pudo inicializar el pago.");
            }
        } catch (error) {
            console.error("Error al crear la intención de pago:", error);
            toast.error("Error al iniciar el pago", { description: error.message });
            creditPurchaseKeyRef.current = null;
            setSelectedPackage(null);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCreateStripeAccountLink = async () => {
        setIsCreatingLink(true);
        try {
            const { data, error } = await supabase.functions.invoke('create-stripe-account-link', {
                body: { userId: user.id }
            });

            if (error) throw error;

            window.location.href = data.url;
        } catch (error) {
            toast.error("No se pudo crear el enlace de Stripe", { description: error.message });
        } finally {
            setIsCreatingLink(false);
        }
    };

    const handleRequestPayout = async () => {
        if (!payoutAmount || isNaN(payoutAmount)) return toast.error("Introduce una cantidad válida.");

        setIsRequestingPayout(true);
        payoutRequestKeyRef.current = globalThis.crypto?.randomUUID?.() || `payout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try {
            const { data, error } = await supabase.functions.invoke('request-payout', {
                body: { amount: parseFloat(payoutAmount), idempotencyKey: payoutRequestKeyRef.current }
            });

            if (error) throw error;
            if (!data?.success) throw new Error(data?.error || 'No se pudo crear la solicitud de retiro.');

            toast.success("¡Solicitud de pago enviada!", { description: "Recibirás tu dinero en unos días." });
            setPayoutAmount('');
            payoutRequestKeyRef.current = null;
        } catch (error) {
            toast.error("Error al solicitar el pago", { description: error.message });
        } finally {
            setIsRequestingPayout(false);
        }
    };

    const handleSuccessfulPayment = () => {
        toast.success("¡Compra completada!", {
            description: `Se han añadido ${selectedPackage?.credits} créditos a tu cuenta.`
        });
        setPaymentClientSecret(null);
        setSelectedPackage(null);
        creditPurchaseKeyRef.current = null;
    };

    const stripeOptions = { clientSecret: paymentClientSecret };

    return (
        <>
            <div className="max-w-4xl mx-auto p-4">
                <SubPageHeader title="Facturación y Cartera" />

                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle>Configuración de Pagos</CardTitle>
                        <CardDescription>Gestiona tu cuenta de Stripe para recibir pagos de tus pasajeros.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button onClick={handleCreateStripeAccountLink} disabled={isCreatingLink}>
                            {isCreatingLink ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {profile?.stripe_account_id ? 'Gestionar cuenta de Stripe' : 'Configurar cuenta de Stripe'}
                        </Button>
                    </CardContent>
                </Card>

                {profile?.stripe_account_id && (
                    <Card className="mt-6">
                        <CardHeader>
                            <CardTitle>Solicitar Pago</CardTitle>
                            <CardDescription>Retira tu saldo disponible a tu cuenta bancaria.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex items-center gap-4">
                            <Input type="number" value={payoutAmount} onChange={e => setPayoutAmount(e.target.value)} placeholder="Cantidad en EUR" className="max-w-xs" />
                            <Button onClick={handleRequestPayout} disabled={isRequestingPayout || !payoutAmount}>
                                {isRequestingPayout ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Solicitar
                            </Button>
                        </CardContent>
                    </Card>
                )}

                <Card className="mt-6">
                    <CardHeader>
                        <CardTitle>Comprar Créditos</CardTitle>
                        <CardDescription>Los créditos se usarán para futuras reservas.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {creditPackages.map(pkg => (
                                <Button
                                    key={pkg.credits}
                                    variant="outline"
                                    className="h-auto p-4 flex flex-col items-center justify-center gap-2 relative"
                                    onClick={() => handlePackageSelect(pkg)}
                                    disabled={isProcessing}
                                >
                                    {isProcessing && selectedPackage?.id === pkg.id && <Loader2 className="absolute h-6 w-6 animate-spin" />}
                                    <span className={`text-xl font-bold ${isProcessing && selectedPackage?.id === pkg.id ? 'opacity-20' : ''}`}>{pkg.credits} Créditos</span>
                                    <span className={`text-lg ${isProcessing && selectedPackage?.id === pkg.id ? 'opacity-20' : ''}`}>{pkg.price.toFixed(2)}€</span>
                                </Button>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={!!paymentClientSecret} onOpenChange={() => setPaymentClientSecret(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Comprar {selectedPackage?.credits} Créditos</DialogTitle>
                        <DialogDescription>Total a pagar: {selectedPackage?.price.toFixed(2)}€</DialogDescription>
                    </DialogHeader>
                    {paymentClientSecret && (
                        <Elements stripe={stripePromise} options={stripeOptions}>
                            <CheckoutForm onSuccessfulPayment={handleSuccessfulPayment} />
                        </Elements>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
};

export default BillingSettings;
