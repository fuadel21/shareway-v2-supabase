import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Trash2, Building2, Globe, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

export default function CommunitiesTab() {
    const [communities, setCommunities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [name, setName] = useState('');
    const [domain, setDomain] = useState('');
    const [isAdding, setIsAdding] = useState(false);

    const fetchCommunities = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('communities')
                .select('*')
                .order('name');

            if (error) throw error;
            setCommunities(data || []);
        } catch (err) {
            toast.error("Error al cargar comunidades");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCommunities();
    }, []);

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!name || !domain) return toast.error("Completa todos los campos");

        setIsAdding(true);
        try {
            const { error } = await supabase
                .from('communities')
                .insert([{ name, allowed_domain: domain }]);

            if (error) throw error;

            toast.success("Comunidad añadida");
            setName('');
            setDomain('');
            fetchCommunities();
        } catch (err) {
            toast.error("Error: " + err.message);
        } finally {
            setIsAdding(false);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("¿Seguro que quieres borrar esta comunidad?")) return;

        try {
            const { error } = await supabase
                .from('communities')
                .delete()
                .eq('id', id);

            if (error) throw error;
            toast.success("Comunidad eliminada");
            fetchCommunities();
        } catch (err) {
            toast.error("Error al eliminar");
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 text-left">
            <div className="grid gap-6 md:grid-cols-3">
                <Card className="md:col-span-1 border-none shadow-sm rounded-3xl bg-slate-50/50">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-slate-900 uppercase italic font-black text-sm">
                            <Plus className="h-5 w-5 text-primary" /> Nueva Comunidad
                        </CardTitle>
                        <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Restringe el acceso por dominio.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleAdd} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-1">Nombre</label>
                                <Input
                                    placeholder="Ej: Universidad de Sevilla"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    className="h-12 rounded-2xl bg-white border-slate-100 shadow-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-1">Dominio Permitido</label>
                                <Input
                                    placeholder="Ej: us.es"
                                    value={domain}
                                    onChange={e => setDomain(e.target.value)}
                                    className="h-12 rounded-2xl bg-white border-slate-100 shadow-sm"
                                />
                            </div>
                            <Button
                                type="submit"
                                className="w-full h-12 rounded-2xl font-black uppercase italic tracking-widest text-[10px]"
                                disabled={isAdding}
                            >
                                {isAdding ? <Loader2 className="animate-spin" /> : "Crear Comunidad"}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <Card className="md:col-span-2 border-none shadow-sm rounded-3xl bg-white overflow-hidden">
                    <CardHeader className="bg-white border-b border-slate-50 pb-6">
                        <CardTitle className="flex items-center gap-2 text-slate-900 uppercase italic font-black text-sm">
                            <Building2 className="h-5 w-5 text-primary" /> Comunidades Activas
                        </CardTitle>
                        <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total: {communities.length}</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        {loading ? (
                            <div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div>
                        ) : communities.length === 0 ? (
                            <div className="p-12 text-center text-slate-400 font-bold uppercase text-[10px]">No hay comunidades creadas</div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent border-slate-50">
                                        <TableHead className="px-6 py-4 text-[10px] font-black uppercase text-slate-400">Comunidad</TableHead>
                                        <TableHead className="px-6 py-4 text-[10px] font-black uppercase text-slate-400">Dominio</TableHead>
                                        <TableHead className="px-6 py-4 text-right"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {communities.map((c) => (
                                        <TableRow key={c.id} className="border-slate-50 hover:bg-slate-50/50 transition-colors">
                                            <TableCell className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="size-8 rounded-lg bg-primary/5 flex items-center justify-center">
                                                        <ShieldCheck className="size-4 text-primary" />
                                                    </div>
                                                    <span className="font-bold text-slate-900 text-sm">{c.name}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="px-6 py-4">
                                                <div className="flex items-center gap-2 text-slate-500 font-medium">
                                                    <Globe className="size-3" />
                                                    <span className="text-xs">@{c.allowed_domain}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="px-6 py-4 text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDelete(c.id)}
                                                    className="h-9 w-9 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 transition-all"
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
