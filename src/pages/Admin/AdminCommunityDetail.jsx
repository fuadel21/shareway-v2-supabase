import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
    ChevronLeft, Building2, Users, MapPin, Globe,
    Shield, ShieldAlert, Loader2, Trash2,
    ExternalLink, Search, UserMinus
} from 'lucide-react';

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger
} from '@/components/ui/alert-dialog';

const getText = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const getInitials = (name, email) => {
    const source = name || email || '?';
    return String(source).split(/[\s@.]+/).filter(Boolean).map(word => word[0]).join('').toUpperCase().slice(0, 2) || '?';
};

const AdminCommunityDetail = () => {
    const { communityId } = useParams();
    const navigate = useNavigate();

    const [community, setCommunity] = useState(null);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isRemovingMember, setIsRemovingMember] = useState(null);
    const [memberSearch, setMemberSearch] = useState('');

    const fetchCommunityData = useCallback(async () => {
        if (!communityId) {
            navigate('/admin/communities');
            return;
        }

        setLoading(true);
        try {
            const { data: commData, error: commError } = await supabase
                .from('communities')
                .select('*')
                .eq('id', communityId)
                .single();

            if (commError) throw commError;
            if (!commData) throw new Error('Comunidad no encontrada');
            setCommunity(commData);

            const { data: memData, error: memError } = await supabase
                .from('profiles')
                .select('id, display_name, full_name, email, avatar_url, photo_url, is_verified, verification, created_at')
                .eq('community_id', communityId);

            if (memError) throw memError;
            setMembers(Array.isArray(memData) ? memData : []);
        } catch (error) {
            console.error('Error fetching community detail:', error);
            toast.error('Error al cargar detalles de la comunidad', { description: error.message });
            navigate('/admin/communities');
        } finally {
            setLoading(false);
        }
    }, [communityId, navigate]);

    useEffect(() => {
        fetchCommunityData();
    }, [fetchCommunityData]);

    const handleUpdateCommunity = async (e) => {
        e?.preventDefault?.();
        if (!community) return;

        const cleanName = getText(community.name);
        if (!cleanName) return toast.error('El nombre de la comunidad es obligatorio');

        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('communities')
                .update({
                    name: cleanName,
                    description: getText(community.description),
                    location: getText(community.location),
                    allowed_domain: getText(community.allowed_domain).replace(/^@/, '').toLowerCase(),
                    is_private: Boolean(community.is_private)
                })
                .eq('id', communityId);

            if (error) throw error;
            toast.success('Comunidad actualizada correctamente');
            await fetchCommunityData();
        } catch (error) {
            toast.error('Error al actualizar', { description: error.message });
        } finally {
            setIsSaving(false);
        }
    };

    const handleRemoveMember = async (userId) => {
        if (!userId) return;
        setIsRemovingMember(userId);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ community_id: null, community_name: null })
                .eq('id', userId);

            if (error) throw error;

            setMembers(prev => prev.filter(m => m.id !== userId));
            toast.success('Miembro removido de la comunidad');
        } catch (error) {
            toast.error('Error al remover miembro', { description: error.message });
        } finally {
            setIsRemovingMember(null);
        }
    };

    const handleDeleteCommunity = async () => {
        try {
            const { error: unlinkError } = await supabase
                .from('profiles')
                .update({ community_id: null, community_name: null })
                .eq('community_id', communityId);

            if (unlinkError) throw unlinkError;

            const { error } = await supabase
                .from('communities')
                .delete()
                .eq('id', communityId);

            if (error) throw error;

            toast.success('Comunidad eliminada permanentemente');
            navigate('/admin/communities');
        } catch (error) {
            toast.error('Error al eliminar comunidad', { description: error.message });
        }
    };

    const handleDownloadAudit = () => {
        const payload = {
            community: {
                id: communityId,
                name: community?.name || null,
                location: community?.location || null,
                allowed_domain: community?.allowed_domain || null,
                is_private: Boolean(community?.is_private),
                members_count: members.length
            },
            members: members.map(member => ({
                id: member.id,
                name: member.display_name || member.full_name || null,
                email: member.email || null,
                is_verified: Boolean(member.is_verified || member.verification?.status === 'verified'),
                joined_at: member.created_at || null
            })),
            exported_at: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `shareway-community-${communityId}-audit.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const filteredMembers = members.filter(member => {
        const term = memberSearch.trim().toLowerCase();
        if (!term) return true;
        return [member.display_name, member.full_name, member.email]
            .map(value => String(value || '').toLowerCase())
            .some(value => value.includes(term));
    });

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Cargando Ecosistema...</p>
            </div>
        );
    }

    if (!community) return null;

    const communityName = getText(community.name, 'Comunidad sin nombre');
    const communityLocation = getText(community.location, 'Ubicación no definida');
    const allowedDomain = getText(community.allowed_domain);

    return (
        <div className="space-y-8 pb-20 animate-in fade-in duration-700 text-left">
            <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={() => navigate('/admin/communities')} className="group rounded-xl hover:bg-slate-100 px-4 h-12">
                    <ChevronLeft className="mr-2 h-5 w-5 transition-transform group-hover:-translate-x-1" />
                    <span className="font-black text-xs uppercase tracking-widest">Volver</span>
                </Button>

                <div className="flex items-center gap-2">
                    <Badge className={community.is_private ? 'bg-amber-100 text-amber-600 border-none' : 'bg-emerald-100 text-emerald-600 border-none'}>{community.is_private ? 'PRIVADA' : 'PÚBLICA'}</Badge>
                    <Badge variant="outline" className="font-bold border-slate-200 uppercase tracking-widest text-[9px]">ID: {String(communityId).substring(0, 8)}</Badge>
                </div>
            </div>

            <div className="relative p-10 bg-slate-900 rounded-[3rem] overflow-hidden group">
                <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none group-hover:rotate-12 transition-transform duration-1000"><Building2 className="size-48 text-white" /></div>
                <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
                    <div className="size-24 rounded-[2rem] bg-white/10 backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-2xl"><Building2 className="size-12 text-primary" /></div>
                    <div className="space-y-2 text-center md:text-left">
                        <h1 className="text-4xl font-black text-white tracking-tighter uppercase italic">{communityName}</h1>
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-white/50 text-[10px] font-black uppercase tracking-widest">
                            {allowedDomain && <span className="flex items-center gap-1.5"><Globe className="size-3.5" /> @{allowedDomain}</span>}
                            <span className="flex items-center gap-1.5"><MapPin className="size-3.5" /> {communityLocation}</span>
                            <span className="flex items-center gap-1.5"><Users className="size-3.5" /> {members.length} Miembros</span>
                        </div>
                    </div>
                </div>
            </div>

            <Tabs defaultValue="members" className="w-full">
                <TabsList className="bg-slate-100 p-1.5 rounded-2xl gap-1 h-14 mb-8">
                    <TabsTrigger value="members" className="rounded-xl px-8 h-full font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm">Miembros</TabsTrigger>
                    <TabsTrigger value="settings" className="rounded-xl px-8 h-full font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm">Configuración</TabsTrigger>
                </TabsList>

                <TabsContent value="members" className="space-y-6">
                    <div className="flex justify-between items-center gap-4">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                            <Input placeholder="Buscar por nombre o email..." value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} className="pl-11 rounded-xl border-slate-100 h-12 text-sm font-bold" />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{filteredMembers.length} Miembros encontrados</p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {filteredMembers.map(member => {
                            const memberName = getText(member.display_name || member.full_name, 'Usuario sin nombre');
                            const memberEmail = getText(member.email, 'Sin correo');
                            const isVerified = Boolean(member.is_verified || member.verification?.status === 'verified');
                            return (
                                <Card key={member.id} className="border-none shadow-sm rounded-3xl overflow-hidden group hover:shadow-md transition-all">
                                    <CardContent className="p-6">
                                        <div className="flex items-center gap-4">
                                            <Avatar className="size-12 rounded-2xl border-2 border-slate-50">
                                                <AvatarImage src={member.photo_url || member.avatar_url || undefined} />
                                                <AvatarFallback className="bg-slate-100 font-black text-slate-400">{getInitials(memberName, memberEmail)}</AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-black text-slate-900 uppercase italic tracking-tighter truncate">{memberName}</p>
                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate">{memberEmail}</p>
                                            </div>
                                            <Button variant="ghost" size="icon" disabled={isRemovingMember === member.id} className="rounded-xl hover:bg-red-50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveMember(member.id)}>
                                                {isRemovingMember === member.id ? <Loader2 className="size-4 animate-spin" /> : <UserMinus className="size-4" />}
                                            </Button>
                                        </div>
                                    </CardContent>
                                    <CardFooter className="bg-slate-50/50 p-4 flex justify-between">
                                        <Button variant="ghost" className="h-8 px-3 rounded-lg text-[8px] font-black uppercase tracking-widest" onClick={() => navigate(`/admin/review/${member.id}`)} disabled={!member.id}>
                                            <ExternalLink className="size-3 mr-1.5" /> Ver Perfil
                                        </Button>
                                        {isVerified && <div className="flex items-center gap-1 text-[8px] font-black text-emerald-500 uppercase tracking-widest"><Shield className="size-3" /> Verificado</div>}
                                    </CardFooter>
                                </Card>
                            );
                        })}

                        {filteredMembers.length === 0 && (
                            <div className="col-span-full py-20 text-center space-y-4">
                                <div className="size-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto"><Users className="size-8 text-slate-200" /></div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No se encontraron miembros</p>
                            </div>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="settings">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <Card className="lg:col-span-2 border-none shadow-sm rounded-[2.5rem] overflow-hidden">
                            <CardHeader className="p-8 border-b border-slate-50">
                                <CardTitle className="text-xl font-black uppercase italic tracking-tighter">Información General</CardTitle>
                                <CardDescription className="text-[10px] font-bold uppercase tracking-widest">Edita los detalles de la organización</CardDescription>
                            </CardHeader>
                            <CardContent className="p-8 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest ml-1">Nombre de Comunidad</Label>
                                        <Input value={community.name || ''} onChange={e => setCommunity({ ...community, name: e.target.value })} className="h-12 rounded-xl border-slate-100 font-bold" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest ml-1">Dominio Permitido</Label>
                                        <Input value={community.allowed_domain || ''} onChange={e => setCommunity({ ...community, allowed_domain: e.target.value })} className="h-12 rounded-xl border-slate-100 font-bold" placeholder="ej: ucm.es" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest ml-1">Ubicación Física</Label>
                                        <Input value={community.location || ''} onChange={e => setCommunity({ ...community, location: e.target.value })} className="h-12 rounded-xl border-slate-100 font-bold" />
                                    </div>
                                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl self-end">
                                        <div className="flex items-center gap-3">
                                            <Shield className="size-5 text-primary" />
                                            <div><p className="text-[10px] font-black uppercase italic">Estado Privado</p><p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Solo acceso verificado</p></div>
                                        </div>
                                        <Switch checked={Boolean(community.is_private)} onCheckedChange={checked => setCommunity({ ...community, is_private: checked })} />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest ml-1">Descripción / Bio</Label>
                                    <textarea value={community.description || ''} onChange={e => setCommunity({ ...community, description: e.target.value })} rows={4} className="w-full rounded-xl border-slate-100 border p-4 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary/5 transition-all resize-none" placeholder="Describe la comunidad..." />
                                </div>
                            </CardContent>
                            <CardFooter className="p-8 bg-slate-50/50 flex justify-end">
                                <Button onClick={handleUpdateCommunity} disabled={isSaving} className="h-14 px-10 rounded-2xl bg-primary font-black uppercase italic text-xs tracking-widest shadow-xl shadow-primary/20">
                                    {isSaving ? <Loader2 className="size-5 animate-spin" /> : 'Guardar Cambios'}
                                </Button>
                            </CardFooter>
                        </Card>

                        <div className="space-y-6">
                            <Card className="border-none shadow-sm rounded-[2.5rem] bg-red-50/30 overflow-hidden">
                                <CardHeader className="p-8">
                                    <CardTitle className="text-xl font-black uppercase italic tracking-tighter text-red-600">Zona de Peligro</CardTitle>
                                    <CardDescription className="text-[9px] font-bold uppercase tracking-widest text-red-400 leading-relaxed">Eliminar una comunidad es una acción irreversible. Los usuarios perderán su vinculación.</CardDescription>
                                </CardHeader>
                                <CardContent className="p-8 pt-0">
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="destructive" className="w-full h-14 rounded-2xl font-black uppercase italic tracking-widest text-xs shadow-xl shadow-red-500/10"><Trash2 className="size-5 mr-3" /> Eliminar Comunidad</Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent className="rounded-[2.5rem] border-none">
                                            <AlertDialogHeader>
                                                <AlertDialogTitle className="text-2xl font-black uppercase italic tracking-tighter">¿Estás absolutamente seguro?</AlertDialogTitle>
                                                <AlertDialogDescription className="text-slate-500 font-bold text-xs uppercase tracking-widest leading-relaxed pt-2">Esta acción no se puede deshacer. Se eliminarán permanentemente todos los datos de la comunidad &quot;{communityName}&quot; y se desvinculará a sus {members.length} miembros.</AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter className="gap-2">
                                                <AlertDialogCancel className="rounded-xl font-black uppercase text-[10px] tracking-widest border-none bg-slate-100">Cancelar</AlertDialogCancel>
                                                <AlertDialogAction onClick={handleDeleteCommunity} className="rounded-xl font-black uppercase text-[10px] tracking-widest bg-red-600 text-white">Eliminar Definitivamente</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </CardContent>
                            </Card>

                            <Card className="border-none shadow-sm rounded-[2.5rem] bg-indigo-600 text-white overflow-hidden">
                                <CardContent className="p-8 space-y-6">
                                    <div className="size-14 bg-white/10 rounded-2xl flex items-center justify-center"><ShieldAlert className="size-7" /></div>
                                    <div className="space-y-2">
                                        <h4 className="text-lg font-black uppercase italic tracking-tighter">Administrador Certificado</h4>
                                        <p className="text-[9px] font-bold text-indigo-100/60 uppercase tracking-widest leading-relaxed">Como administrador, puedes auditar cualquier actividad dentro de esta comunidad para garantizar la seguridad de los trayectos compartidos.</p>
                                    </div>
                                    <Button onClick={handleDownloadAudit} className="w-full h-12 rounded-xl bg-white text-indigo-600 font-black text-[10px] uppercase tracking-widest">DESCARGAR AUDITORÍA</Button>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default AdminCommunityDetail;
