import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Search, UserCircle, ShieldCheck, ShieldAlert, ShieldBan, MoreHorizontal, UserX, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { searchUsers, adminToggleUserSuspension, adminUpdateUserStatus } from '@/lib/supabaseRPC';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';

const getInitials = (name) => name ? name.split(' ').map(w => w[0]).join('').toUpperCase() : '?';

const UserManagementTab = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSearching, setIsSearching] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [processingId, setProcessingId] = useState(null);
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

    const handleToggleSuspension = async (userId, isCurrentlySuspended) => {
        setProcessingId(userId);
        try {
            const { success, error } = await adminToggleUserSuspension(userId, !isCurrentlySuspended);
            if (success) {
                toast.success(isCurrentlySuspended ? "Usuario reactivado" : "Usuario suspendido");
                fetchUsers(debouncedSearchTerm);
            } else throw new Error(error);
        } catch (error) {
            toast.error("Error al actualizar estado");
        } finally {
            setProcessingId(null);
        }
    };

    const handleUpdateVerification = async (userId, newStatus) => {
        setProcessingId(userId);
        try {
            const { success, error } = await adminUpdateUserStatus(userId, newStatus);
            if (success) {
                toast.success(`Estado cambiado a ${newStatus}`);
                fetchUsers(debouncedSearchTerm);
            } else throw new Error(error);
        } catch (error) {
            toast.error("Error al cambiar verificación");
        } finally {
            setProcessingId(null);
        }
    };

    const getVerificationBadge = (status) => {
        const variants = {
            verified: { color: "bg-emerald-50 text-emerald-600", label: "Verificado" },
            pending: { color: "bg-amber-50 text-amber-600", label: "Pendiente" },
            rejected: { color: "bg-red-50 text-red-600", label: "Rechazado" }
        };
        const config = variants[status] || { color: "bg-gray-50 text-gray-500", label: "Sin Verf." };

        return (
            <Badge variant="outline" className={cn("rounded-full px-3 border-none font-bold text-[10px] uppercase", config.color)}>
                {config.label}
            </Badge>
        );
    }

    return (
        <div className="space-y-6 text-left">
            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                    placeholder="Buscar usuarios por nombre o correo..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-12 h-14 rounded-2xl border-gray-100 shadow-sm focus:ring-primary/20 text-sm font-medium"
                />
            </div>

            {loading ? (
                <div className="text-center py-20 px-12"><Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" /></div>
            ) : (
                <div className={cn("relative divide-y divide-gray-50 bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden transition-opacity", isSearching && "opacity-50")}>
                    {isSearching && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    )}
                    {users.length === 0 ? (
                        <div className="p-16 text-center text-slate-400 font-bold uppercase tracking-widest text-[10px]">No se encontraron usuarios</div>
                    ) : (
                        users.map(user => (
                            <div key={user.id} className={cn("group flex items-center justify-between p-6 transition-all", user.is_suspended ? "bg-red-50/30" : "hover:bg-slate-50/50")}>
                                <div className="flex items-center gap-5">
                                    <div className="relative">
                                        <Avatar className="h-14 w-14 border-2 border-white shadow-sm ring-1 ring-slate-100">
                                            <AvatarImage src={user.photo_url} />
                                            <AvatarFallback className="bg-slate-50 text-slate-400 font-black">
                                                {getInitials(user.display_name)}
                                            </AvatarFallback>
                                        </Avatar>
                                        {user.is_suspended && (
                                            <div className="absolute -top-1 -right-1 bg-red-500 rounded-full p-1 border-2 border-white">
                                                <ShieldBan className="size-3 text-white" />
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <p className="font-black text-slate-900 tracking-tight">{user.display_name}</p>
                                            <Badge variant="outline" className="text-[8px] font-black uppercase tracking-tighter bg-slate-100 border-none">{user.role}</Badge>
                                        </div>
                                        <p className="text-xs text-slate-400 font-medium">{user.email || 'Sin correo asociado'}</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    {getVerificationBadge(user.verification?.status)}

                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="rounded-xl h-10 border-slate-100 text-slate-600 font-bold text-[10px] uppercase hover:bg-slate-900 hover:text-white transition-all shadow-sm"
                                            onClick={() => navigate(`/admin/profile/${user.id}`)}
                                        >
                                            Expediente
                                        </Button>

                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button size="icon" variant="ghost" className="h-10 w-10 rounded-xl hover:bg-slate-100" disabled={processingId === user.id}>
                                                    {processingId === user.id ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="rounded-2xl border-slate-100 p-2 min-w-48 shadow-xl">
                                                <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-3 py-2">Acciones Rápidas</DropdownMenuLabel>
                                                <DropdownMenuSeparator className="bg-slate-50" />

                                                {!user.is_suspended ? (
                                                    <DropdownMenuItem className="rounded-xl focus:bg-red-50 focus:text-red-600 text-red-500 font-bold text-xs p-3 cursor-pointer" onClick={() => handleToggleSuspension(user.id, false)}>
                                                        <UserX className="mr-2 h-4 w-4" /> Suspender Usuario
                                                    </DropdownMenuItem>
                                                ) : (
                                                    <DropdownMenuItem className="rounded-xl focus:bg-emerald-50 focus:text-emerald-600 text-emerald-600 font-bold text-xs p-3 cursor-pointer" onClick={() => handleToggleSuspension(user.id, true)}>
                                                        <UserCheck className="mr-2 h-4 w-4" /> Levantar Suspensión
                                                    </DropdownMenuItem>
                                                )}

                                                <DropdownMenuSeparator className="bg-slate-50" />

                                                {user.verification?.status !== 'verified' && (
                                                    <DropdownMenuItem className="rounded-xl focus:bg-emerald-50 focus:text-emerald-600 text-slate-700 font-bold text-xs p-3 cursor-pointer" onClick={() => handleUpdateVerification(user.id, 'verified')}>
                                                        <ShieldCheck className="mr-2 h-4 w-4" /> Marcar Verificado
                                                    </DropdownMenuItem>
                                                )}

                                                {user.verification?.status !== 'rejected' && (
                                                    <DropdownMenuItem className="rounded-xl focus:bg-red-50 focus:text-red-600 text-slate-700 font-bold text-xs p-3 cursor-pointer" onClick={() => handleUpdateVerification(user.id, 'rejected')}>
                                                        <ShieldAlert className="mr-2 h-4 w-4" /> Rechazar KYC
                                                    </DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
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
