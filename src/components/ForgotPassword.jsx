import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Mail, ArrowLeft, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!email) return toast.error("Por favor, introduce tu email.");

    setIsLoading(true);
    const toastId = toast.loading("Enviando enlace de recuperación...");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      toast.success("Correo enviado con éxito", {
        id: toastId,
        description: "Revisa tu bandeja de entrada para continuar."
      });
      navigate('/login');
    } catch (error) {
      console.error("Error al recuperar contraseña:", error);
      toast.error("Error al enviar el correo", { id: toastId, description: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden px-4">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[10%] w-[30%] h-[30%] bg-indigo-500/10 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[10%] w-[30%] h-[30%] bg-pink-500/10 rounded-full blur-[100px] animate-pulse delay-700" />
      </div>

      <Card className="w-full max-w-md bg-white/70 backdrop-blur-3xl border-none shadow-[0_40px_100px_rgba(0,0,0,0.1)] rounded-3xl p-4 relative z-10 animate-in fade-in zoom-in-95 duration-700">
        <CardHeader className="space-y-6 text-center pb-10">
          <div className="flex justify-center">
            <div className="bg-navy h-24 w-24 rounded-3xl flex items-center justify-center shadow-2xl relative group overflow-hidden">
              <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />
              <Mail className="h-10 w-10 text-primary relative z-10" />
            </div>
          </div>
          <div className="space-y-3">
            <CardTitle className="text-3xl font-black text-slate-900 tracking-tighter uppercase">
              Recuperar Acceso
            </CardTitle>
            <CardDescription className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[9px] max-w-[240px] mx-auto">
              Te enviaremos un enlace seguro para crear una nueva contraseña.
            </CardDescription>
          </div>
        </CardHeader>

        <form onSubmit={handleResetPassword}>
          <CardContent className="space-y-8">
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-6">Tu correo electrónico</label>
              <div className="relative group">
                <Mail className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-primary transition-colors" />
                <Input
                  type="email"
                  placeholder="ejemplo@shareway.com"
                  className="h-12 pl-14 pr-6 rounded-2xl bg-slate-50 border-none shadow-inner font-bold text-slate-900 focus:ring-4 focus:ring-primary/5 transition-all outline-none text-base placeholder:text-slate-200"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col space-y-6 pt-10 pb-10">
            <Button
              type="submit"
              className="w-full h-12 rounded-2xl bg-navy hover:bg-navy-600 text-white font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-slate-200 hover:scale-[1.02] active:scale-95 transition-all group"
              disabled={isLoading || !email}
            >
              {isLoading ? <Loader2 className="animate-spin h-6 w-6" /> : (
                <>Enviar enlace <Send className="ml-3 h-4 w-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" /></>
              )}
            </Button>

            <button
              type="button"
              className="w-full flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-primary transition-all group"
              onClick={() => navigate('/login')}
              disabled={isLoading}
            >
              <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
              Volver Atrás
            </button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default ForgotPassword;
