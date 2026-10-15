import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldCheck, Smartphone, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

const PhoneVerificationDialog = ({ open, onOpenChange, phoneNumber }) => {
    const [code, setCode] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const { refreshProfile, profile } = useOutletContext();

    const handleConfirm = async () => {
        if (!code || code.length !== 6 || !phoneNumber) return;
        setIsVerifying(true);
        try {
            // 1. Confirmar el código OTP con Supabase
            // Nota: Para verificar un cambio de teléfono o verificación, usamos type: 'sms' o 'phone_change'
            const { error: verifyError } = await supabase.auth.verifyOtp({
                phone: phoneNumber,
                token: code,
                type: 'sms'
            });

            if (verifyError) throw verifyError;

            // 2. Actualizar el perfil en la tabla profiles
            const { error: updateError } = await supabase
                .from('profiles')
                .update({
                    is_phone_verified: true,
                    phone: phoneNumber
                })
                .eq('id', profile.id);

            if (updateError) throw updateError;

            // 3. Refrescar el perfil local
            if (refreshProfile) await refreshProfile();

            toast.success("¡Teléfono verificado!", {
                icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
                description: "Tu identidad ha sido reforzada con éxito."
            });
            onOpenChange(false);

        } catch (error) {
            console.error("Error verifyOtp:", error);
            toast.error("Código incorrecto", {
                description: "El código introducido no es válido o ha caducado."
            });
        } finally {
            setIsVerifying(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md rounded-3xl border-none shadow-2xl overflow-hidden glass p-0">
                <div className="bg-primary/5 p-8 border-b border-primary/10 text-center">
                    <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Smartphone className="h-8 w-8 text-primary" />
                    </div>
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black tracking-tight">Verifica tu móvil</DialogTitle>
                        <DialogDescription className="font-medium text-slate-500 mt-2">
                            Hemos enviado un código de 6 dígitos al <span className="text-primary font-bold">{phoneNumber}</span>
                        </DialogDescription>
                    </DialogHeader>
                </div>

                <div className="p-10 space-y-8">
                    <div className="flex justify-center">
                        <Input
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                            maxLength={6}
                            placeholder="000000"
                            className="h-14 text-center text-4xl tracking-[0.5em] font-black rounded-2xl border-2 border-slate-100 focus:border-primary transition-all w-full max-w-[280px]"
                        />
                    </div>

                    <div className="space-y-4">
                        <Button
                            onClick={handleConfirm}
                            disabled={isVerifying || code.length !== 6}
                            className="w-full h-12 rounded-2xl text-xl font-black tracking-tight shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
                        >
                            {isVerifying ? (
                                <><Loader2 className="h-6 w-6 animate-spin mr-3" /> Verificando...</>
                            ) : (
                                <><ShieldCheck className="h-6 w-6 mr-3" /> Confirmar Código</>
                            )}
                        </Button>

                        <p className="text-center text-xs font-bold text-muted-foreground">
                            ¿No has recibido nada? <button className="text-primary hover:underline" onClick={() => toast.info("Reenviando código...")}>Reenviar código</button>
                        </p>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default PhoneVerificationDialog;
