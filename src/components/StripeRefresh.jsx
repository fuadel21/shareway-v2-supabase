import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { AlertTriangle } from 'lucide-react';

function StripeRefresh() {
    const navigate = useNavigate();

    return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-50 text-center p-4 space-y-6">
            <div className="bg-yellow-100 p-4 rounded-full">
                <AlertTriangle className="h-12 w-12 text-yellow-500" />
            </div>
            <div className="space-y-2">
                <h1 className="text-2xl font-bold text-gray-800">El enlace ha caducado</h1>
                <p className="text-gray-600 max-w-md">
                    El enlace de conexión con Stripe ha expirado por seguridad. No te preocupes, puedes volver a intentarlo.
                </p>
            </div>
            <Button onClick={() => navigate('/settings/payouts')}>
                Volver a la Configuración de Cobros
            </Button>
        </div>
    );
}

export default StripeRefresh;
