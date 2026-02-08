import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Button } from '@/components/ui/button.jsx';

const getInitials = (name) => name ? name.split(' ').map(w => w[0]).join('').toUpperCase() : '?';

const PendingVerificationsTab = () => {
    const [pendingUsers, setPendingUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    const fetchPendingUsers = async () => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .filter('verification->>status', 'eq', 'pending')
                .order('id', { ascending: false }); // Usar ID como fallback de orden mientras se crea created_at

            if (error) throw error;
            setPendingUsers(data || []);
        } catch (error) {
            console.error("Error fetching pending:", error);
            toast.error("Error al cargar usuarios pendientes.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPendingUsers();

        // Suscripción a cambios en perfiles
        const channel = supabase
            .channel('pending_verifications')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'profiles' },
                () => {
                    fetchPendingUsers();
                }
            )
            .subscribe();

        return () => channel.unsubscribe();
    }, []);

    if (loading) return <div className="text-center py-24"><Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" /></div>;

    return (
        <div className="space-y-6">
            {pendingUsers.length === 0 ? (
                <div className="text-center py-20 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-100">
                    <ShieldAlert className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 font-medium text-lg">No hay verificaciones pendientes</p>
                    <p className="text-gray-400 text-sm">Todas las solicitudes han sido procesadas.</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {pendingUsers.map(user => (
                        <div key={user.id} className="group flex items-center justify-between p-5 bg-white border border-gray-100 rounded-2xl hover:shadow-md transition-all duration-300">
                            <div className="flex items-center gap-4">
                                <Avatar className="h-12 w-12 border-2 border-primary/10 transition-transform group-hover:scale-105">
                                    <AvatarImage src={user.photo_url} />
                                    <AvatarFallback className="bg-primary/5 text-primary font-bold">
                                        {getInitials(user.display_name)}
                                    </AvatarFallback>
                                </Avatar>
                                <div>
                                    <p className="font-bold text-gray-900 group-hover:text-primary transition-colors">{user.display_name}</p>
                                    <p className="text-sm text-muted-foreground">{user.email || 'Sin correo'}</p>
                                </div>
                            </div>
                            <Button
                                variant="secondary"
                                className="rounded-xl font-semibold px-6 hover:bg-primary hover:text-white transition-all"
                                onClick={() => navigate(`/admin/review/${user.id}`)}
                            >
                                Revisar Perfil
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default PendingVerificationsTab;

