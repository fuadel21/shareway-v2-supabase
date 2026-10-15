import { useEffect, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';

/**
 * Componente de retorno de Stripe Connect
 * Blindado contra memory leaks y desincronización de perfiles.
 */
function StripeReturn() {
    const navigate = useNavigate();
    const { user, refreshProfile } = useOutletContext();
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;

        if (!user?.id) {
            // BLINDAJE: Si no hay sesión al volver, redirigir a login para seguridad
            navigate('/login');
            return;
        }

        const verifyAccount = async () => {
            const toastId = toast.info("Sincronizando con Stripe...", { duration: Infinity });
            
            try {
                // Invocamos la función de verificación con timeout preventivo implícito de Supabase
                const { data, error } = await supabase.functions.invoke('check-stripe-account-status', {
                    body: { userId: user.id }
                });

                if (error) throw error;

                if (data?.success) {
                    toast.success("¡Cuenta vinculada!", { 
                        id: toastId, 
                        description: "Ya puedes empezar a recibir tus ganancias.",
                        duration: 5000
                    });
                    
                    // Sincronizar el estado global del perfil inmediatamente
                    if (refreshProfile) await refreshProfile();
                } else {
                    toast.warning("Registro incompleto", { 
                        id: toastId,
                        description: "Asegúrate de completar todos los pasos en Stripe.",
                        duration: 5000
                    });
                }

            } catch (error) {
                console.error("🛡️ stability: Stripe verification failed:", error);
                toast.error("Error de sincronización", { 
                    id: toastId,
                    description: "No pudimos verificar tu cuenta. Intenta de nuevo desde Ajustes.",
                    duration: 5000
                });
            } finally {
                // BLINDAJE: Solo navegar si el componente sigue montado
                if (isMounted.current) {
                    navigate('/settings/payouts', { replace: true });
                }
            }
        };

        verifyAccount();

        return () => {
            isMounted.current = false;
            toast.dismiss(); // Limpiar cualquier toast persistente al salir
        };
    }, [navigate, user?.id, refreshProfile]);

    return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 space-y-6 animate-in fade-in duration-700">
            <div className="relative">
                <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full animate-pulse" />
                <div className="relative bg-white p-8 rounded-3xl shadow-2xl border border-slate-100 flex items-center justify-center">
                    <Loader2 className="h-12 w-12 text-primary animate-spin" strokeWidth={1.5} />
                </div>
            </div>
            <div className="text-center space-y-2">
                <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase italic leading-none">Validando Credenciales</h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] italic">Seguridad ShareWay en tiempo real</p>
            </div>
            <p className="text-sm text-slate-500 font-medium">Serás redirigido en unos segundos...</p>
        </div>
    );
}

export default StripeReturn;
