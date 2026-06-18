import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, Loader2, Lock, ShieldCheck } from 'lucide-react';

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (isMounted && data?.session) setIsReady(true);
    };

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || session) && isMounted) {
        setIsReady(true);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setIsLoading(true);
    const toastId = toast.loading('Actualizando contraseña...');

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      await supabase.auth.signOut();

      toast.success('Contraseña actualizada', {
        id: toastId,
        description: 'Ya puedes iniciar sesión con tu nueva contraseña.'
      });

      navigate('/login', { replace: true });
    } catch (err) {
      console.error('[RESET_PASSWORD] Error:', err);
      setError(err.message || 'No se pudo actualizar la contraseña. Solicita un nuevo enlace.');
      toast.error('No se pudo actualizar la contraseña', {
        id: toastId,
        description: 'Solicita un nuevo enlace si el actual ha caducado.'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden px-4">
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[10%] w-[30%] h-[30%] bg-primary/10 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[10%] w-[30%] h-[30%] bg-orange-400/10 rounded-full blur-[100px] animate-pulse delay-700" />
      </div>

      <Card className="w-full max-w-md bg-white/80 backdrop-blur-3xl border-none shadow-[0_40px_100px_rgba(0,0,0,0.1)] rounded-[3rem] p-4 relative z-10 animate-in fade-in zoom-in-95 duration-700">
        <CardHeader className="space-y-6 text-center pb-10">
          <div className="flex justify-center">
            <div className="bg-primary h-24 w-24 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-primary/20 relative group overflow-hidden">
              <ShieldCheck className="h-10 w-10 text-white relative z-10" />
            </div>
          </div>
          <div className="space-y-3">
            <CardTitle className="text-3xl font-black text-slate-900 tracking-tighter uppercase">
              Nueva contraseña
            </CardTitle>
            <CardDescription className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[9px] max-w-[260px] mx-auto">
              Crea una contraseña segura para volver a entrar en ShareWay.
            </CardDescription>
          </div>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            {!isReady && (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 text-amber-700 text-[10px] font-black uppercase text-center">
                Validando enlace de recuperación...
              </div>
            )}

            {error && (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-100 text-red-500 text-[10px] font-black uppercase text-center">
                {error}
              </div>
            )}

            <div className="space-y-3 text-left">
              <label className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-6">Nueva contraseña</label>
              <div className="relative group">
                <Lock className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-primary transition-colors" />
                <Input
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  className="h-16 pl-14 pr-6 rounded-2xl bg-slate-50 border-none shadow-inner font-bold text-slate-900 focus:ring-4 focus:ring-primary/5 transition-all outline-none text-base placeholder:text-slate-300"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            <div className="space-y-3 text-left">
              <label className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-6">Confirmar contraseña</label>
              <div className="relative group">
                <CheckCircle2 className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-primary transition-colors" />
                <Input
                  type="password"
                  placeholder="Repite la contraseña"
                  className="h-16 pl-14 pr-6 rounded-2xl bg-slate-50 border-none shadow-inner font-bold text-slate-900 focus:ring-4 focus:ring-primary/5 transition-all outline-none text-base placeholder:text-slate-300"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col space-y-6 pt-10 pb-10">
            <Button
              type="submit"
              className="w-full h-16 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
              disabled={isLoading || !password || !confirmPassword}
            >
              {isLoading ? <Loader2 className="animate-spin h-6 w-6" /> : 'Guardar contraseña'}
            </Button>

            <button
              type="button"
              className="w-full flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-primary transition-all group"
              onClick={() => navigate('/login')}
              disabled={isLoading}
            >
              <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
              Volver al login
            </button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default ResetPassword;
