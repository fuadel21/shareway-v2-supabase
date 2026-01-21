import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Loader2, Trash2, Globe, Plus, Building2,
    ShieldCheck, Sparkles, Search, ChevronRight,
    Users, Verified, ShieldAlert, Fingerprint
} from 'lucide-react';
import { cn } from '@/lib/utils';

const AdminCommunityManagement = () => {
    const [communities, setCommunities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const [newCommunity, setNewCommunity] = useState({ name: '', domain: '' });

    const fetchCommunities = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('communities')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;
            setCommunities(data || []);
        } catch (error) {
            console.error("Error fetching communities: ", error);
            toast.error("Error de sincronización", { description: "No pudimos conectar con la base de datos de comunidades." });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCommunities();

        const channel = supabase
            .channel('communities_changes')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'communities' },
                () => fetchCommunities()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchCommunities]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setNewCommunity(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!newCommunity.name || !newCommunity.domain) {
            toast.error("Datos incompletos", { description: "Nombre y dominio son obligatorios para el registro." });
            return;
        }
        setIsSubmitting(true);
        const toastId = toast.loading("Registrando comunidad oficial...");
        try {
            const { error } = await supabase
                .from('communities')
                .insert({
                    name: newCommunity.name,
                    allowed_domain: newCommunity.domain.toLowerCase(),
                });

            if (error) throw error;

            toast.success(`Entidad "${newCommunity.name}" activada`, { id: toastId });
            setNewCommunity({ name: '', domain: '' });
        } catch (error) {
            toast.error("Fallo en el registro", { id: toastId, description: error.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (communityId, communityName) => {
        // En una UI premium podríamos usar un modal personalizado, 
        // pero por ahora mantendremos la confirmación nativa o un toast con acción
        if (!confirm(`¿Eliminar definitivamente "${communityName}"? Los usuarios vinculados podrían perder acceso.`)) {
            return;
        }
        setDeletingId(communityId);
        const toastId = toast.loading("Eliminando registros...");
        try {
            const { error } = await supabase
                .from('communities')
                .delete()
                .eq('id', communityId);

            if (error) throw error;
            toast.success("Comunidad retirada del sistema", { id: toastId });
        } catch (error) {
            toast.error("Error al eliminar", { id: toastId, description: error.message });
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="space-y-12 pb-40 animate-in fade-in duration-700">
            {/* Cabecera de Administración */}
            <div className="relative p-12 bg-navy rounded-[3rem] overflow-hidden group">
                <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none group-hover:rotate-12 transition-transform duration-1000">
                    <Fingerprint className="size-48 text-white" />
                </div>
                <div className="relative z-10 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="size-3 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.4em]">Panel de Control Maestro</span>
                    </div>
                    <h1 className="text-5xl font-black tracking-tighter text-white uppercase italic">
                        Gestión de <span className="text-indigo-400">Comunidades</span>
                    </h1>
                    <p className="text-sm font-bold text-white/40 max-w-lg uppercase tracking-widest leading-relaxed">
                        Administra las organizaciones y dominios exclusivos que definen los clusters de confianza en ShareWay.
                    </p>
                </div>
            </div>

            {/* Formulario de Creación Premium */}
            <Card className="rounded-[3rem] border-none shadow-[0_40px_100px_rgba(0,0,0,0.08)] overflow-hidden bg-white/70 backdrop-blur-3xl">
                <CardHeader className="p-10 border-b border-slate-50">
                    <CardTitle className="text-2xl font-black text-slate-900 tracking-tighter uppercase italic flex items-center gap-3">
                        <Plus className="h-7 w-7 text-indigo-500" /> Nueva Entidad
                    </CardTitle>
                    <CardDescription className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Añade una organización certificada al ecosistema
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-10">
                    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-8 items-end">
                        <div className="md:col-span-5 space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-5">Nombre Oficial</Label>
                            <div className="relative group/input">
                                <Building2 className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within/input:text-primary transition-colors" />
                                <Input
                                    name="name"
                                    value={newCommunity.name}
                                    onChange={handleInputChange}
                                    placeholder="Universidad de Madrid"
                                    className="h-16 pl-14 pr-6 rounded-2xl bg-slate-50 border-none shadow-inner font-bold text-slate-900 focus:ring-4 focus:ring-primary/5 transition-all text-base"
                                />
                            </div>
                        </div>
                        <div className="md:col-span-4 space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-5">Dominio Permitido</Label>
                            <div className="relative group/input">
                                <Globe className="absolute left-6 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-300 group-focus-within/input:text-primary transition-colors" />
                                <Input
                                    name="domain"
                                    value={newCommunity.domain}
                                    onChange={handleInputChange}
                                    placeholder="ucm.es"
                                    className="h-16 pl-14 pr-6 rounded-2xl bg-slate-50 border-none shadow-inner font-bold text-slate-900 focus:ring-4 focus:ring-primary/5 transition-all text-base"
                                />
                            </div>
                        </div>
                        <div className="md:col-span-3">
                            <Button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full h-16 rounded-2xl bg-navy hover:bg-primary text-white font-black text-xs uppercase tracking-[0.2em] shadow-2xl transition-all hover:scale-[1.05] active:scale-95"
                            >
                                {isSubmitting ? <Loader2 className="h-6 w-6 animate-spin" /> : "ACTIVAR ENTIDAD"}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            {/* Listado de Comunidades con Alta Fidelidad */}
            <div className="space-y-6">
                <div className="flex items-center justify-between px-6">
                    <div className="flex items-center gap-3">
                        <Verified className="h-6 w-6 text-indigo-500" />
                        <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase italic">Comunidades Activas</h3>
                    </div>
                    <div className="px-4 py-1.5 bg-indigo-50 rounded-full text-[10px] font-black text-indigo-500 uppercase tracking-widest">
                        {communities.length} ORGANIZACIONES
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {loading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-40 bg-slate-100 rounded-[2.5rem] animate-pulse" />
                        ))
                    ) : communities.length > 0 ? communities.map((community, index) => (
                        <div
                            key={community.id}
                            className="group relative bg-white rounded-[2.5rem] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.04)] hover:shadow-[0_40px_100px_rgba(0,0,0,0.1)] transition-all duration-700 animate-in fade-in slide-in-from-bottom-8"
                            style={{ animationDelay: `${index * 100}ms` }}
                        >
                            <div className="flex items-start justify-between mb-6">
                                <div className="size-16 bg-slate-50 rounded-2xl flex items-center justify-center font-black text-2xl text-slate-800 shadow-inner group-hover:scale-110 group-hover:bg-primary group-hover:text-white transition-all duration-500">
                                    {community.name[0].toUpperCase()}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="rounded-xl text-slate-200 hover:text-red-500 hover:bg-red-50 transition-all"
                                    onClick={() => handleDelete(community.id, community.name)}
                                    disabled={deletingId === community.id}
                                >
                                    {deletingId === community.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                </Button>
                            </div>
                            <div className="space-y-1">
                                <p className="font-black text-xl text-slate-900 tracking-tighter uppercase italic truncate">{community.name}</p>
                                <div className="flex items-center gap-2">
                                    < Globe className="size-3 text-slate-300" />
                                    <p className="text-[11px] font-bold text-slate-400 tracking-widest uppercase">@{community.allowed_domain}</p>
                                </div>
                            </div>

                            <div className="mt-8 pt-6 border-t border-slate-50 flex items-center justify-between">
                                <div className="flex -space-x-2">
                                    {/* Mockup de usuarios vinculados */}
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} className="size-7 rounded-full bg-slate-100 border-2 border-white shadow-sm" />
                                    ))}
                                    <div className="size-7 rounded-full bg-indigo-50 border-2 border-white flex items-center justify-center text-[8px] font-black text-indigo-500">+12</div>
                                </div>
                                <div className="flex items-center gap-1 text-[9px] font-black text-emerald-500 uppercase tracking-widest">
                                    <ShieldCheck className="size-3" /> Protegido
                                </div>
                            </div>
                        </div>
                    )) : (
                        <Card className="col-span-full rounded-[3rem] border-dashed border-2 border-slate-200 bg-transparent p-20 flex flex-col items-center text-center space-y-6">
                            <div className="size-24 bg-slate-50 rounded-full flex items-center justify-center">
                                <Globe className="size-10 text-slate-200" />
                            </div>
                            <div className="space-y-2">
                                <p className="font-black text-2xl text-slate-800 tracking-tighter uppercase italic">Silencio Global</p>
                                <p className="text-sm font-bold text-slate-400 max-w-xs mx-auto uppercase tracking-widest leading-relaxed">
                                    No hay ninguna comunidad registrada en el sistema. Empieza activando una arriba.
                                </p>
                            </div>
                        </Card>
                    )}
                </div>
            </div>

            {/* Panel de Auditoría / Footer Info */}
            <div className="p-10 bg-indigo-600 rounded-[3.5rem] shadow-2xl shadow-indigo-200 flex flex-col md:flex-row items-center justify-between gap-8 relative overflow-hidden group">
                <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                <div className="flex items-center gap-8">
                    <div className="size-20 bg-white/10 rounded-[2rem] flex items-center justify-center backdrop-blur-xl border border-white/10">
                        <Sparkles className="size-10 text-white" />
                    </div>
                    <div>
                        <h4 className="text-2xl font-black text-white tracking-tighter italic uppercase">Seguridad en Red</h4>
                        <p className="text-sm font-bold text-white/50 uppercase tracking-widest leading-relaxed italic">
                            El sistema de clusters por dominio garantiza que los viajes compartidos <br /> ocurran entre personas vinculadas a una misma organización oficial.
                        </p>
                    </div>
                </div>
                <Button className="h-16 px-10 rounded-2xl bg-white text-indigo-600 font-black text-xs uppercase tracking-widest shadow-xl hover:scale-105 transition-all">
                    EXPERT VIEW
                </Button>
            </div>
        </div>
    );
};

export default AdminCommunityManagement;

