import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Search, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { searchUsers } from '@/lib/supabaseRPC';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';

const getInitials = (name) => name ? name.split(' ').map(w => w[0]).join('').toUpperCase() : '?';

const UserManagementTab = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSearching, setIsSearching] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 500);
    const navigate = useNavigate();

    const fetchUsers = useCallback(async (term) => {
        if (term) {
            setIsSearching(true);
        } else {
            setLoading(true);
        }

        try {
            const data = await searchUsers(term);
            setUsers(data || []);
        } catch (error) {
            console.error("Error fetching users:", error);
            toast.error("Error al cargar usuarios.");
            setUsers([]);
        } finally {
            setLoading(false);
            setIsSearching(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers(debouncedSearchTerm);
    }, [debouncedSearchTerm, fetchUsers]);

    const getVerificationBadge = (status) => {
        const variants = { verified: "default", pending: "outline", rejected: "destructive" };
        const text = { verified: "Verificado", pending: "Pendiente", rejected: "Rechazado" };

        return (
            <Badge variant={variants[status] || 'secondary'} className="rounded-full px-3">
                {text[status] || 'No Verificado'}
            </Badge>
        );
    }

    return (
        <div className="space-y-6">
            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                    placeholder="Buscar usuarios por nombre o correo..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-12 h-12 rounded-2xl border-gray-100 shadow-sm focus:ring-primary/20"
                />
            </div>

            {loading ? (
                <div className="text-center py-20 px-12"><Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" /></div>
            ) : (
                <div className={cn("relative divide-y divide-gray-50 bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden transition-opacity", isSearching && "opacity-50")}>
                    {isSearching && (
                         <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    )}
                    {users.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground italic">No se encontraron usuarios para "{debouncedSearchTerm}".</div>
                    ) : (
                        users.map(user => (
                            <div key={user.id} className="group flex items-center justify-between p-5 hover:bg-gray-50/50 transition-colors">
                                <div className="flex items-center gap-4">
                                    <Avatar className="h-12 w-12 border-2 border-primary/5">
                                        <AvatarImage src={user.photo_url} />
                                        <AvatarFallback className="bg-primary/5 text-primary">
                                            {getInitials(user.display_name)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-bold text-gray-900">{user.display_name}</p>
                                            <p className="text-xs text-muted-foreground font-medium px-2 py-0.5 bg-gray-100 rounded-full">{user.role}</p>
                                        </div>
                                        <p className="text-sm text-muted-foreground">{user.email || 'Sin correo asociado'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    {getVerificationBadge(user.verification?.status)}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="rounded-xl text-primary font-semibold hover:bg-primary/10"
                                        onClick={() => navigate(`/admin/profile/${user.id}`)}
                                    >
                                        Ver Perfil
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default UserManagementTab;
