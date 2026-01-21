import { useNavigate, useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { ArrowLeft, Bell, Moon, Sun, Shield, KeyRound, Trash2, Loader2, MessageSquare, Briefcase, Clock, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useState, useEffect } from 'react';

// Helper to get nested properties safely
const get = (obj, path, def) => path.split('.').reduce((a, b) => (a && a[b] !== undefined) ? a[b] : def, obj);

function SettingsV2() {
    const navigate = useNavigate();
    const { user } = useOutletContext(); // Obtener el usuario del contexto
    const [isDeleting, setIsDeleting] = useState(false);
    
    const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
    const [notifications, setNotifications] = useState(() => {
        const saved = localStorage.getItem('notification_settings');
        return saved ? JSON.parse(saved) : {
            messages: true,
            rideUpdates: true,
            reminders: true,
            promotions: false
        };
    });

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    useEffect(() => {
        localStorage.setItem('notification_settings', JSON.stringify(notifications));
    }, [notifications]);

    const handleThemeChange = (isDark) => setTheme(isDark ? 'dark' : 'light');
    const handleNotificationChange = (key) => {
        setNotifications(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handlePasswordReset = async () => {
        if (!user?.email) return toast.error("No se ha podido identificar tu correo.");
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
                redirectTo: `${window.location.origin}/settings/security?view=update-password`,
            });
            if (error) throw error;
            toast.success("Correo de reseteo enviado.", { description: "Revisa tu bandeja de entrada.", });
        } catch (error) {
            toast.error(error.message || "No se pudo enviar el correo.");
        }
    };

    const handleDeleteAccount = async () => {
        if (!user || !window.confirm("¿Estás ABSOLUTAMENTE seguro? Esta acción es irreversible.")) return;

        setIsDeleting(true);
        try {
            const { error } = await supabase.rpc('delete_user_account');
            if (error) throw error;

            await supabase.auth.signOut();
            toast.success("Tu cuenta ha sido eliminada permanentemente.");

        } catch (error) {
            toast.error(error.message || "No se pudo eliminar la cuenta.");
        } finally {
            setIsDeleting(false);
        }
    };
    
    const NOTIFICATION_OPTIONS = [
      { id: 'messages', icon: MessageSquare, title: 'Mensajes en el chat', description: 'Recibir alertas de nuevos mensajes en tus viajes.' },
      { id: 'rideUpdates', icon: Briefcase, title: 'Actualizaciones de viaje', description: 'Cambios importantes en tus viajes reservados.' },
      { id: 'reminders', icon: Clock, title: 'Recordatorios de viaje', description: 'Alertas antes de que tu viaje comience.' },
      { id: 'promotions', icon: Sparkles, title: 'Promociones y novedades', description: 'Ofertas especiales y noticias de la app.' },
    ];

    return (
        <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
            <header className="bg-card shadow-sm border-b">
                <div className="container mx-auto p-4 flex items-center justify-between">
                    <h1 className="text-2xl font-bold">Ajustes</h1>
                    <Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4 mr-2" /> Volver</Button>
                </div>
            </header>
            <main className="container mx-auto p-4 max-w-2xl space-y-8">
                <Card>
                    <CardHeader>
                        <CardTitle>General</CardTitle>
                        <CardDescription>Preferencias generales de la aplicación.</CardDescription>
                    </CardHeader>
                    <CardContent className="divide-y">
                        <div className="p-4">
                          <h3 className="font-semibold mb-2 text-lg flex items-center gap-2"><Bell className="h-5 w-5"/>Notificaciones</h3>
                          <div className="space-y-4 mt-4">
                            {NOTIFICATION_OPTIONS.map(({ id, icon: Icon, title, description }) => (
                              <div key={id} className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                  <Icon className="h-6 w-6 text-muted-foreground" />
                                  <div>
                                    <p className="font-medium">{title}</p>
                                    <p className="text-sm text-muted-foreground">{description}</p>
                                  </div>
                                </div>
                                <Switch checked={get(notifications, id, false)} onCheckedChange={() => handleNotificationChange(id)} />
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center justify-between p-4">
                            <div className="flex items-center gap-4">
                                {theme === 'light' ? <Sun className="h-6 w-6 text-yellow-500" /> : <Moon className="h-6 w-6 text-blue-400"/>}
                                <div>
                                    <h3 className="font-semibold">Modo Oscuro</h3>
                                    <p className="text-sm text-muted-foreground">Activa un tema más amigable para la vista.</p>
                                </div>
                            </div>
                            <Switch checked={theme === 'dark'} onCheckedChange={handleThemeChange} />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-destructive/50">
                    <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="text-destructive"/> Privacidad y Seguridad</CardTitle><CardDescription>Gestiona tus credenciales y los datos de tu cuenta.</CardDescription></CardHeader>
                    <CardContent className="space-y-4 p-4">
                        <div className="flex items-center justify-between p-4 border rounded-lg cursor-pointer hover:bg-accent" onClick={() => navigate('/settings/security')}>
                            <div className="flex items-center gap-4">
                                <Shield className="h-6 w-6 text-primary"/>
                                <div>
                                    <h3 className="font-semibold">Centro de Seguridad</h3>
                                    <p className="text-sm text-muted-foreground">Gestiona tus contactos de emergencia, compartir viaje y más.</p>
                                </div>
                            </div>
                            <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                        </div>
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                            <div className="flex items-center gap-4">
                                <KeyRound className="h-6 w-6 text-muted-foreground"/>
                                <div>
                                    <h3 className="font-semibold">Contraseña</h3>
                                    <p className="text-sm text-muted-foreground">Recibe un enlace por correo para cambiar tu contraseña.</p>
                                </div>
                            </div>
                            <Button variant="secondary" onClick={handlePasswordReset}>Enviar Correo</Button>
                        </div>
                    </CardContent>
                    <CardFooter className="bg-destructive/10 p-4 border-t border-destructive/20 flex justify-between items-center rounded-b-lg"><div><h3 className="font-semibold text-destructive">Eliminar cuenta</h3><p className="text-sm text-destructive/80">Esta acción es permanente y no se puede deshacer.</p></div><Button variant="destructive" onClick={handleDeleteAccount} disabled={isDeleting}>{isDeleting ? <><Loader2 className="animate-spin mr-2"/>Eliminando...</> : <><Trash2 className="h-4 w-4 mr-2"/>Eliminar</>}</Button></CardFooter>
                </Card>
            </main>
        </div>
    );
}

export default SettingsV2;
