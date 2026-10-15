import { useState, useEffect } from 'react';
import { useOutletContext, useSearchParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card.jsx';
import { KeyRound, Trash2, Loader2, Mail, AlertCircle, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import SubPageHeader from './SubPageHeader';
import { cn } from '@/lib/utils';

function AccountSettings() {
    const { user, refreshProfile } = useOutletContext();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSendingReset, setIsSendingReset] = useState(false);

    useEffect(() => {
        if (searchParams.get('success') || searchParams.get('reauth')) {
            const newParams = new URLSearchParams(searchParams.toString());
            newParams.delete('success');
            newParams.delete('reauth');
            setSearchParams(newParams);
        }
    }, [searchParams, setSearchParams]);

    const handlePasswordReset = async () => {
        if (!user?.email) return toast.error("No se ha podido identificar tu correo.");
        setIsSendingReset(true);
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
                redirectTo: `${window.location.origin}/settings/security?view=update-password`,
            });
            if (error) throw error;
            toast.success("Enlace de seguridad enviado", { description: "Revisa tu bandeja de entrada para cambiar la contraseña." });
        } catch (error) {
            toast.error(error.message || "No se pudo enviar el correo de reseteo.");
        } finally {
            setIsSendingReset(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (!user || !window.confirm("¿Estás ABSOLUTAMENTE seguro? Esta acción es irreversible y perderás todos tus datos.")) return;

        setIsDeleting(true);
        try {
            const { error } = await supabase.rpc('delete_user_account');
            if (error) throw error;

            await supabase.auth.signOut();
            toast.success("Cuenta eliminada correctamente.", { description: "Esperamos volver a verte pronto." });
        } catch (error) {
            toast.error(error.message || "No se pudo eliminar la cuenta.");
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-40">
            <SubPageHeader title="Privacidad & Cuenta" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-5 animate-in fade-in slide-in-from-bottom-6 duration-700">

                {/* CAMBIO DE CONTRASEÑA PREMIUM */}
                <Card className="rounded-3xl border-none shadow-xl bg-white overflow-hidden p-5 space-y-8">
                    <div className="flex items-center gap-6">
                        <div className="size-16 rounded-2xl bg-orange-50 text-primary flex items-center justify-center">
                            <KeyRound className="size-8" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase italic leading-none mb-1">Tu Contraseña</h2>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Protección de acceso externo</p>
                        </div>
                    </div>

                    <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-2">
                        <p className="text-sm font-medium text-slate-600 leading-relaxed">
                            Para cambiar tu contraseña, te enviaremos un enlace seguro a:
                        </p>
                        <p className="text-sm font-black text-slate-900 bg-white inline-block px-3 py-1 rounded-lg border">
                            {user?.email}
                        </p>
                    </div>

                    <Button
                        onClick={handlePasswordReset}
                        disabled={isSendingReset}
                        className="w-full h-12 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-primary/20"
                    >
                        {isSendingReset ? <Loader2 className="animate-spin" /> : <Mail className="mr-2 size-5" />}
                        Solicitar Enlace de Cambio
                    </Button>
                </Card>

                {/* ELIMINACIÓN DE CUENTA PREMIUM */}
                <Card className="rounded-3xl border-none shadow-xl bg-white overflow-hidden">
                    <div className="p-8 space-y-8">
                        <div className="flex items-center gap-6">
                            <div className="size-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center">
                                <ShieldAlert className="size-8" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-black text-red-600 tracking-tighter uppercase italic leading-none mb-1">Zona Crítica</h2>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Eliminación de datos</p>
                            </div>
                        </div>

                        <div className="p-6 bg-red-50 rounded-3xl border border-red-100 flex items-start gap-4">
                            <AlertCircle className="size-6 text-red-500 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-xs font-black text-red-900 uppercase">Aviso de Irreversibilidad</p>
                                <p className="text-[10px] font-bold text-red-700/70 leading-relaxed uppercase tracking-widest">
                                    Al eliminar tu cuenta, se borrará tu historial de viajes, saldo actual y contactos de emergencia. No podrás recuperar esta información.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="px-8 pb-8 pt-0">
                        <Button
                            variant="destructive"
                            onClick={handleDeleteAccount}
                            disabled={isDeleting}
                            className="w-full h-12 rounded-2xl font-black text-xs uppercase tracking-[0.2em] bg-red-600 hover:bg-red-700 transition-colors"
                        >
                            {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 className="mr-2 size-5" />}
                            Eliminar Cuenta Permanentemente
                        </Button>
                    </div>
                </Card>

                <p className="text-center text-[10px] text-slate-300 font-black uppercase tracking-[0.3em] pb-10">
                    Account Data Protocol v2.1 • ShareWay
                </p>
            </main>
        </div>
    );
}

export default AccountSettings;
