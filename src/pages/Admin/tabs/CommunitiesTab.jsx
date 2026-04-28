import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, MapPin, Plus, ExternalLink, Search, Loader2, X, Globe, Lock, Save } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

/**
 * CommunitiesTab Component
 *
 * Part of the Admin Dashboard. Manages the "Elite" communities ecosystem.
 * Features a search interface, a modal for creating new communities,
 * and cards displaying existing communities with their basic stats and management links.
 */
const CommunitiesTab = () => {
    const navigate = useNavigate();
    const [communities, setCommunities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Formulario de nueva comunidad
    const [newCommunity, setNewCommunity] = useState({
        name: '',
        description: '',
        location: '',
        is_private: false
    });

    useEffect(() => {
        fetchCommunities();
    }, []);

    /**
     * Fetches all communities from the 'communities' table, ordered by name.
     */
    const fetchCommunities = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('communities')
                .select('*')
                .order('name');

            if (error) throw error;
            setCommunities(data || []);
        } catch (error) {
            toast.error("Error al cargar comunidades");
        } finally {
            setLoading(false);
        }
    };

    /**
     * Creates a new Elite community.
     * Captures current user as admin_id and resets the form on success.
     */
    const handleCreateCommunity = async () => {
        if (!newCommunity.name) return toast.error("El nombre es obligatorio");

        setIsSaving(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) throw new Error("No hay sesión activa");

            const { error } = await supabase
                .from('communities')
                .insert([{
                    name: newCommunity.name,
                    description: newCommunity.description,
                    location: newCommunity.location,
                    is_private: newCommunity.is_private,
                    admin_id: session.user.id
                }]);

            if (error) throw error;

            toast.success("Comunidad creada con éxito");
            setIsCreateModalOpen(false);
            setNewCommunity({ name: '', description: '', location: '', is_private: false });
            fetchCommunities();
        } catch (error) {
            console.error("Error al crear:", error);
            toast.error(error.message || "Error al crear la comunidad");
        } finally {
            setIsSaving(false);
        }
    };

    const filtered = communities.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) return <div className="flex justify-center p-20"><Loader2 className="animate-spin text-primary" /></div>;

    return (
        <div className="space-y-6 animate-in fade-in duration-500 text-left">
            <div className="flex flex-col md:flex-row justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                        placeholder="Buscar comunidad..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-11 rounded-2xl border-slate-100 bg-white h-12 font-bold"
                    />
                </div>
                <Button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="rounded-2xl bg-slate-900 h-12 px-6 font-black uppercase italic tracking-widest text-[10px]"
                >
                    <Plus className="mr-2 h-4 w-4" /> Crear Comunidad
                </Button>
            </div>

            {/* Modal de Creación */}
            <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
                <DialogContent className="rounded-[2.5rem] border-none max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black uppercase italic tracking-tighter">Nueva Comunidad</DialogTitle>
                        <DialogDescription className="font-bold text-slate-400 text-[10px] uppercase tracking-widest">Configura un nuevo espacio exclusivo</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest px-1">Nombre de la Comunidad</Label>
                            <Input
                                placeholder="Ej: Google Madrid"
                                className="rounded-xl border-slate-100 h-12 font-bold"
                                value={newCommunity.name}
                                onChange={e => setNewCommunity({...newCommunity, name: e.target.value})}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest px-1">Ubicación / Empresa</Label>
                            <Input
                                placeholder="Ej: Torre Picasso, Madrid"
                                className="rounded-xl border-slate-100 h-12 font-bold"
                                value={newCommunity.location}
                                onChange={e => setNewCommunity({...newCommunity, location: e.target.value})}
                            />
                        </div>

                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                            <div className="flex items-center gap-3">
                                {newCommunity.is_private ? <Lock className="h-5 w-5 text-amber-500" /> : <Globe className="h-5 w-5 text-emerald-500" />}
                                <div>
                                    <p className="text-xs font-black uppercase italic tracking-tight">Privacidad</p>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                                        {newCommunity.is_private ? 'Solo con invitación' : 'Cualquiera puede unirse'}
                                    </p>
                                </div>
                            </div>
                            <Switch
                                checked={newCommunity.is_private}
                                onCheckedChange={checked => setNewCommunity({...newCommunity, is_private: checked})}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            className="w-full rounded-2xl bg-primary h-14 font-black uppercase italic tracking-widest text-xs shadow-lg shadow-primary/20"
                            onClick={handleCreateCommunity}
                            disabled={isSaving}
                        >
                            {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />} Crear Comunidad Elite
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filtered.map((comm) => (
                    <Card key={comm.id} className="border-none shadow-sm rounded-[2rem] bg-white overflow-hidden group hover:shadow-xl transition-all duration-500">
                        <div className="h-24 bg-slate-50 relative overflow-hidden">
                            {comm.banner_url ? (
                                <img src={comm.banner_url} alt="" className="w-full h-full object-cover opacity-50" />
                            ) : (
                                <div className="absolute inset-0 bg-gradient-to-br from-slate-100 to-white" />
                            )}
                            <Badge className="absolute top-4 right-4 bg-white/80 backdrop-blur-md text-slate-900 border-none font-black text-[9px] tracking-widest uppercase">
                                {comm.is_private ? 'Privada' : 'Abierta'}
                            </Badge>
                        </div>
                        <CardContent className="p-6 -mt-10 relative">
                            <div className="size-16 rounded-2xl bg-white shadow-lg border border-slate-50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <Building2 className="h-8 w-8 text-primary" />
                            </div>
                            <h3 className="text-lg font-black text-slate-900 uppercase italic tracking-tighter mb-1">{comm.name}</h3>
                            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">
                                <MapPin className="h-3 w-3" /> {comm.location || 'Global'}
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-6">
                                <div className="p-3 bg-slate-50 rounded-xl">
                                    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Miembros</p>
                                    <p className="text-xl font-black text-slate-900 italic tracking-tighter">--</p>
                                </div>
                                <div className="p-3 bg-slate-50 rounded-xl">
                                    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Viajes Mes</p>
                                    <p className="text-xl font-black text-slate-900 italic tracking-tighter">--</p>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    className="flex-1 rounded-xl font-black text-[9px] uppercase tracking-widest border-slate-100 h-10"
                                    onClick={() => navigate(`/admin/communities/${comm.id}`)}
                                >
                                    Gestionar
                                </Button>
                                <Button size="icon" variant="ghost" className="rounded-xl h-10 w-10 text-primary hover:bg-primary/5">
                                    <ExternalLink className="h-4 w-4" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
};

export default CommunitiesTab;
