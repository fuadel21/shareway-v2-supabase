import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Sparkles, ArrowRight, Loader2, Mail, Lock, User, Phone, ShieldCheck, Languages } from 'lucide-react';
import '../App.css';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';

function Register() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleLanguage = () => {
    const currentLang = i18n.language?.startsWith('ar') ? 'ar' : i18n.language?.startsWith('en') ? 'en' : 'es';
    const nextLang = currentLang === 'es' ? 'en' : currentLang === 'en' ? 'ar' : 'es';
    i18n.changeLanguage(nextLang);
    const messages = {
      es: 'Idioma cambiado a Español',
      en: 'Language changed to English',
      ar: 'تم تغيير اللغة إلى العربية'
    };
    toast.success(messages[nextLang]);
  };

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) { setError(t('register.errors.mismatch')); return; }
    if (formData.password.length < 6) { setError(t('register.errors.too_short')); return; }

    setIsSubmitting(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: {
            display_name: formData.name,
            phone: formData.phone || '',
          }
        }
      });

      if (signUpError) throw signUpError;

      // Notificar al administrador (Esperamos el envío antes de navegar)
      try {
        await supabase.functions.invoke('notify-admin-new-user', {
          body: {
            record: {
              id: data.user?.id,
              email: formData.email,
              display_name: formData.name
            }
          }
        });
        console.log("[NOTIFY] Aviso enviado correctamente");
      } catch (funcErr) {
        console.warn("[NOTIFY] Error en notificación:", funcErr);
      }

      if (data.user && !data.session) {
        toast.success(t('register.success_title'), {
          description: t('register.success_desc'),
          onDismiss: () => navigate('/login'),
          duration: 5000
        });
      } else {
        toast.success(t('register.success_title'));
        navigate('/dashboard', { replace: true });
      }

    } catch (err) {
      console.error("[REGISTER] Error:", err);
      setError(err.message || t('register.errors.generic'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4 py-20">
      
      {/* Botón Flotante de Idioma */}
      <div className="absolute top-6 right-6 z-50">
        <Button 
          variant="outline" 
          size="icon" 
          onClick={toggleLanguage}
          className="rounded-full h-11 w-11 bg-white/80 backdrop-blur-md border-slate-100 shadow-lg hover:text-primary transition-all active:scale-90 touch-action-manipulation"
        >
          <Languages size={20} />
        </Button>
      </div>

      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-accent/20 rounded-full blur-[120px] animate-pulse delay-700" />
      </div>

      <Card className="w-full max-w-lg bg-white/70 backdrop-blur-3xl border-none shadow-[0_40px_100px_rgba(0,0,0,0.12)] rounded-[3rem] p-4 relative z-10 animate-in fade-in zoom-in-95 duration-700 text-left">
        <CardHeader className="space-y-6 text-center pb-10">
          <div className="flex justify-center">
            <div className="bg-primary h-24 w-24 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-primary/30 relative group overflow-hidden">
              <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
              <Sparkles className="h-10 w-10 text-white relative z-10" />
            </div>
          </div>
          <div className="space-y-2">
            <CardTitle className="text-4xl font-black text-slate-900 tracking-tighter uppercase leading-none">
              {t('register.title')}
            </CardTitle>
            <CardDescription className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[10px]">
              {t('register.subtitle')}
            </CardDescription>
          </div>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6 px-6">
            {error && (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-100 text-red-500 text-[10px] font-black uppercase text-center animate-in shake duration-500">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-6">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-5">{t('register.name_label')}</Label>
                <div className="relative group">
                  <User className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-primary transition-colors" />
                  <Input name="name" value={formData.name} onChange={handleChange} required className="h-16 pl-14 pr-6 rounded-2xl bg-white border-2 border-orange-50 font-bold text-slate-900 focus:ring-4 focus:ring-primary/10 transition-all text-base placeholder:text-slate-300" placeholder="Juan Pérez" />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-5">{t('register.email_label')}</Label>
                <div className="relative group">
                  <Mail className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-primary transition-colors" />
                  <Input name="email" type="email" value={formData.email} onChange={handleChange} required className="h-16 pl-14 pr-6 rounded-2xl bg-white border-2 border-orange-50 font-bold text-slate-900 focus:ring-4 focus:ring-primary/10 transition-all text-base placeholder:text-slate-300" placeholder="hola@ejemplo.com" />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-5">{t('register.phone_label')}</Label>
                <div className="relative group">
                  <Phone className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-primary transition-colors" />
                  <Input name="phone" type="tel" value={formData.phone} onChange={handleChange} className="h-16 pl-14 pr-6 rounded-2xl bg-white border-2 border-orange-50 font-bold text-slate-900 focus:ring-4 focus:ring-primary/10 transition-all text-base placeholder:text-slate-300" placeholder="+34 600 000 000" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-5">{t('register.password_label')}</Label>
                  <div className="relative group">
                    <Lock className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-primary transition-colors" />
                    <Input name="password" type="password" value={formData.password} onChange={handleChange} required className="h-16 pl-14 pr-6 rounded-2xl bg-white border-2 border-orange-50 font-bold text-slate-900 focus:ring-4 focus:ring-primary/10 transition-all text-base" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-5">{t('register.confirm_password_label')}</Label>
                  <div className="relative group">
                    <ShieldCheck className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within:text-primary transition-colors" />
                    <Input name="confirmPassword" type="password" value={formData.confirmPassword} onChange={handleChange} required className="h-16 pl-14 pr-6 rounded-2xl bg-white border-2 border-orange-50 font-bold text-slate-900 focus:ring-4 focus:ring-primary/10 transition-all text-base" />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col space-y-6 pt-10 pb-10">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-16 rounded-[2rem] bg-primary hover:bg-primary/90 text-white font-black text-sm uppercase tracking-wider shadow-2xl shadow-primary/20 active:scale-95 transition-all border-none"
            >
              {isSubmitting ? <Loader2 className="animate-spin h-6 w-6" /> : (
                <>{t('register.register_button')} <ArrowRight className="ml-3 h-4 w-4" /></>
              )}
            </Button>

            <div className="text-[11px] font-bold text-center text-slate-400">
              {t('register.already_have_account')}{' '}
              <Link to="/login" className="text-primary hover:underline transition-all ml-1">
                {t('register.login_link')}
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}

export default Register;
