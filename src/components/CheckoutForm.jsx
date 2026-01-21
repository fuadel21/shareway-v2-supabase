
import React, { useState } from 'react'; // <-- ¡LA IMPORTACIÓN CRÍTICA QUE FALTABA!
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const CheckoutForm = ({ onSuccessfulPayment }) => {
    const stripe = useStripe();
    const elements = useElements();

    const [isProcessing, setIsProcessing] = useState(false);
    const [errorMessage, setErrorMessage] = useState(null);

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!stripe || !elements) {
            // Stripe.js no se ha cargado todavía, deshabilita el envío del formulario.
            return;
        }

        setIsProcessing(true);
        setErrorMessage(null);

        const { error, paymentIntent } = await stripe.confirmPayment({
            elements,
            confirmParams: {
                // No es necesaria una `return_url` ya que manejamos el resultado aquí mismo
            },
            redirect: 'if_required' // Evita la redirección si el pago se puede confirmar sin pasos adicionales
        });

        if (error) {
            // Este bloque se ejecuta si hay un error del lado del cliente (p.ej., tarjeta inválida)
            // o si el usuario cancela la autenticación (p.ej., 3D Secure).
            setErrorMessage(error.message);
            toast.error("Error en el pago", { description: error.message });
            setIsProcessing(false);
        } else if (paymentIntent && paymentIntent.status === 'succeeded') {
            // El pago se ha procesado con éxito en el backend.
            toast.success("¡Pago confirmado!");
            onSuccessfulPayment();
        } else {
            // Caso inesperado
            setErrorMessage("Ocurrió un estado de pago inesperado.");
            setIsProcessing(false);
        }
    };

    const handleElementChange = (event) => {
        if (event.error) {
            setErrorMessage(event.error.message);
        } else {
            setErrorMessage(null);
        }
    };

    return (
        <form onSubmit={handleSubmit} id="payment-form">
            <PaymentElement id="payment-element" onChange={handleElementChange} />

            {errorMessage && (
                <div id="payment-message" className="text-red-600 text-sm mt-4 text-center p-2 bg-red-50 rounded-md">
                    {errorMessage}
                </div>
            )}

            <Button
                type="submit"
                disabled={!stripe || !elements || isProcessing}
                className="w-full mt-6"
                size="lg"
            >
                {isProcessing ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Procesando...</>
                ) : (
                    `Pagar`
                )}
            </Button>
        </form>
    );
};

export default CheckoutForm;