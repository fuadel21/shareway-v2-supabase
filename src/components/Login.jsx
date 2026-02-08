import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Sparkles, ArrowRight, Loader2, Mail, Lock, Languages } from 'lucide-react';
import '../App.css';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

function Login() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'es' ? 'en' : 'es';
    i18n.changeLanguage(newLang);
    toast.success(newLang === 'es' ? 'Idioma cambiado a Español' : 'Language changed to English');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError(t('login.errors.fields_required'));
      return;
    }
    setIsSubmitting(true);
    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) throw loginError;
      navigate('/');
    } catch (err) {
      console.error("Login error:", err);
      let friendlyError = t('login.errors.generic');
      if (err.message === 'Invalid login credentials') {
        friendlyError = t('login.errors.invalid_credentials');
      } else if (err.message.includes('Email not confirmed')) {
        friendlyError = t('login.errors.email_not_confirmed');
      }
      setError(friendlyError);
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
        }
      });
      if (error) throw error;
    } catch (err) {
      setError(t('login.errors.google_error'));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4">
      
      {/* Botón Flotante de Idioma */}
      <div className="absolute top-6 right-6 z-50">
        <Button 
          variant="outline" 
          size="icon" 
          onClick={toggleLanguage}
          className="rounded-full h-12 w-12 bg-white/80 backdrop-blur-md border-slate-100 shadow-lg hover:text-primary transition-all"
        >
          <Languages size={20} />
        </Button>
      </div>

      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-accent/20 rounded-full blur-[120px] animate-pulse delay-700" />
      </div>

      <Card className="w-full max-w-md bg-white/70 backdrop-blur-3xl border-none shadow-[0_40px_100px_rgba(0,0,0,0.12)] rounded-[3rem] p-4 relative z-10 animate-in fade-in zoom-in-95 duration-700">
        <CardHeader className="space-y-6 text-center pb-10">
          <div className="flex justify-center">
            <div className="bg-primary h-28 w-28 rounded-[2.5rem] flex items-center justify-center shadow-2xl shadow-primary/30 relative group overflow-hidden animate-bounce-subtle">
              <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
              <Sparkles className="h-12 w-12 text-white relative z-10" />
            </div>
          </div>
          <div className="space-y-2">
            <CardTitle className="text-5xl font-black text-slate-900 tracking-tighter uppercase leading-none">
              ShareWay
            </CardTitle>
            <CardDescription className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[10px]">
              {t('login.tagline')}
            </CardDescription>
          </div>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6 text-left">
            {error && (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-100 text-red-500 text-xs font-black uppercase text-center animate-in shake duration-500">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-5">{t('login.email_label')}</Label>
                <div className="relative group">
                  <Mail className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-primary transition-colors" />
                  <Input
                    type="email"
                    placeholder="hola@shareway.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-16 pl-14 pr-6 rounded-2xl bg-white border-2 border-orange-50 font-bold text-slate-900 focus:ring-4 focus:ring-primary/10 transition-all text-base placeholder:text-slate-300"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-5">{t('login.password_label')}</Label>
                <div className="relative group">
                  <Lock className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-primary transition-colors" />
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-16 pl-14 pr-6 rounded-2xl bg-white border-2 border-orange-50 font-bold text-slate-900 focus:ring-4 focus:ring-primary/10 transition-all text-base placeholder:text-slate-300"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <Link to="/forgot-password"
                className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-primary transition-colors"
              >
                {t('login.forgot_password')}
              </Link>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col space-y-6 pt-6 pb-10">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-16 rounded-[2rem] bg-primary hover:bg-primary/90 text-white font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all border-none"
            >
              {isSubmitting ? <Loader2 className="animate-spin h-6 w-6" /> : (
                <>{t('login.login_button')} <ArrowRight className="ml-3 h-4 w-4" /></>
              )}
            </Button>

            <div className="relative w-full py-2">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-100" />
              </div>
              <div className="relative flex justify-center text-[9px] uppercase tracking-widest font-black">
                <span className="bg-white px-4 text-slate-300">
                  {t('login.or_separator')}
                </span>
              </div>
            </div>

            <Button
              variant="outline"
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSubmitting}
              className="w-full h-16 rounded-2xl border-2 border-slate-50 font-black text-xs uppercase tracking-[0.1em] hover:bg-slate-50 transition-all flex items-center justify-center gap-3"
            >
              <img src="https://www.google.com/favicon.ico" className="w-4 h-4 grayscale transition-all group-hover:grayscale-0" alt="Google" />
              {t('login.google_button')}
            </Button>

            <div className="text-[11px] font-bold text-center text-slate-400">
              {t('login.no_account')}{' '}
              <Link to="/register" className="text-primary hover:underline transition-all ml-1">
                {t('login.register_link')}
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

export default Login;
