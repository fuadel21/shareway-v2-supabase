import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Loader2, Search, UserPlus, Filter, MoreVertical, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const getInitials = (name) => name ? name.split(' ').map(w => w[0]).join('').toUpperCase() : '?';

const UserManagementPage = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const navigate = useNavigate();

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('profiles')
                .select('*')
                .order('display_name', { ascending: true });

            if (searchTerm) {
                query = query.or(`display_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
            }

            const { data, error } = await query.limit(100);

            if (error) throw error;
            setUsers(data || []);
        } catch (error) {
            console.error("Error fetching users:", error);
            toast.error("Error al cargar la lista de usuarios.");
        } finally {
            setLoading(false);
        }
    }, [searchTerm]);

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchUsers();
        }, 500); // Debounce
        return () => clearTimeout(timer);
    }, [fetchUsers]);

    const getVerificationBadge = (status) => {
        const variants = { verified: "default", pending: "outline", rejected: "destructive" };
        const text = { verified: "Verificado", pending: "Pendiente", rejected: "Rechazado" };
        return (
            <Badge variant={variants[status] || 'secondary'} className="rounded-full px-3 text-[10px]">
                {text[status] || 'No Verificado'}
            </Badge>
        );
    }

    return (
        <div className="space-y-8 pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Gestión de Usuarios</h1>
                    <p className="text-gray-500 mt-2">Visualiza y administra todos los perfiles registrados en la plataforma.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" className="rounded-2xl border-gray-200">
                        <Filter className="h-4 w-4 mr-2" /> Filtrar
                    </Button>
                    <Button className="rounded-2xl bg-primary shadow-lg shadow-primary/20">
                        <UserPlus className="h-4 w-4 mr-2" /> Nuevo Usuario
                    </Button>
                </div>
            </div>

            <Card className="rounded-[2.5rem] border-none shadow-xl shadow-blue-500/5 overflow-hidden">
                <CardHeader className="bg-gradient-to-br from-white to-gray-50/20 p-8 border-b border-gray-50">
                    <div className="relative max-w-md">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <Input
                            placeholder="Buscar por nombre o email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="rounded-2xl h-12 pl-12 border-gray-100 bg-white shadow-sm focus:ring-primary/20"
                        />
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {loading && users.length === 0 ? (
                        <div className="p-20 text-center"><Loader2 className="h-10 w-10 animate-spin mx-auto text-primary/30" /></div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {users.length === 0 ? (
                                <div className="p-20 text-center text-gray-400 font-medium italic">No se encontraron usuarios que coincidan con la búsqueda.</div>
                            ) : (
                                users.map(user => (
                                    <div key={user.id} className="group p-6 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                                        <div className="flex items-center gap-5">
                                            <div className="relative">
                                                <Avatar className="h-14 w-14 border-2 border-white shadow-sm">
                                                    <AvatarImage src={user.photo_url} />
                                                    <AvatarFallback className="bg-primary/5 text-primary font-bold">{getInitials(user.display_name)}</AvatarFallback>
                                                </Avatar>
                                                {user.verification?.status === 'verified' && (
                                                    <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                                                        <ShieldCheck className="h-5 w-5 text-green-500 fill-green-50 border-none" />
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="font-bold text-gray-900 leading-tight">{user.display_name || 'Sin nombre'}</p>
                                                    {getVerificationBadge(user.verification?.status)}
                                                </div>
                                                <p className="text-sm font-medium text-gray-400">{user.email}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <div className="hidden md:flex flex-col items-end mr-4">
                                                <p className="text-xs font-bold text-gray-400 uppercase">Rol</p>
                                                <p className="text-xs font-bold text-gray-600">{user.role}</p>
                                            </div>
                                            <Button
                                                variant="secondary"
                                                className="rounded-xl font-bold bg-white border border-gray-100 shadow-sm hover:bg-primary hover:text-white transition-all"
                                                onClick={() => navigate(`/admin/profile/${user.id}`)}
                                            >
                                                Ver Expediente
                                            </Button>
                                            <Button variant="ghost" size="icon" className="rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
                                                <MoreVertical className="h-5 w-5 text-gray-400" />
                                            </Button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default UserManagementPage;
