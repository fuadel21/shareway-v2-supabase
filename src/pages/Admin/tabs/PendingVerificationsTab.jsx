import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPendingVerifications } from '@/lib/supabaseRPC';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const getInitials = (name, email) => {
    const source = name || email || '?';
    if (typeof source !== 'string') return '?';
    return source
        .split(/[\s@.]+/)
        .filter(Boolean)
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || '?';
};

const getDisplayName = (user) => user?.display_name || user?.full_name || user?.email?.split('@')[0] || 'Usuario sin nombre';

const PendingVerificationsTab = () => {
    const [pendingUsers, setPendingUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    const fetchPendingUsers = async () => {
        try {
            const { data, success, error } = await getPendingVerifications();
            if (!success) throw new Error(error || 'No se pudieron cargar verificaciones pendientes');
            setPendingUsers(data || []);
        } catch (error) {
            console.error('Error fetching pending:', error);
            toast.error('Error al cargar usuarios pendientes.', { description: error.message });
            setPendingUsers([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPendingUsers();

        const channel = supabase
            .channel('pending_verifications')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'profiles' },
                () => fetchPendingUsers()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    if (loading) return <div className="text-center py-24"><Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" /></div>;

    return (
        <div className="space-y-6">
            {pendingUsers.length === 0 ? (
                <div className="text-center py-20 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-100">
                    <ShieldCheck className="h-12 w-12 text-emerald-300 mx-auto mb-4" />
                    <p className="text-gray-500 font-medium text-lg">No hay verificaciones pendientes</p>
                    <p className="text-gray-400 text-sm">Todas las solicitudes han sido procesadas.</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {pendingUsers.map(user => {
                        const displayName = getDisplayName(user);
                        return (
                            <div key={user.id} className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white border border-gray-100 rounded-2xl hover:shadow-md transition-all duration-300">
                                <div className="flex items-center gap-4 min-w-0">
                                    <Avatar className="h-12 w-12 border-2 border-primary/10 transition-transform group-hover:scale-105 shrink-0">
                                        <AvatarImage src={user.photo_url || undefined} />
                                        <AvatarFallback className="bg-primary/5 text-primary font-bold">
                                            {getInitials(displayName, user.email)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="text-left min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-bold text-gray-900 group-hover:text-primary transition-colors truncate">{displayName}</p>
                                            <Badge className="bg-amber-50 text-amber-600 border-none text-[8px] font-black uppercase tracking-widest">KYC pendiente</Badge>
                                        </div>
                                        <p className="text-sm text-muted-foreground truncate">{user.email || 'Sin correo'}</p>
                                    </div>
                                </div>
                                <Button
                                    variant="secondary"
                                    className="rounded-xl font-semibold px-6 hover:bg-primary hover:text-white transition-all"
                                    onClick={() => navigate(`/admin/review/${user.id}`)}
                                    disabled={!user.id}
                                >
                                    <ShieldAlert className="h-4 w-4 mr-2" /> Revisar KYC
                                </Button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default PendingVerificationsTab;
