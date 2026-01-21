import { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { ArrowLeft, Plus, Trash2, Loader2, User, Phone, ShieldAlert, BadgeCheck, Heart } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import SubPageHeader from '../SubPageHeader';

function EmergencyContacts() {
    const navigate = useNavigate();
    const { profile: currentUser } = useOutletContext();
    const [contacts, setContacts] = useState([]);
    const [newContact, setNewContact] = useState({ name: '', phone: '' });
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!currentUser) return;

        const fetchContacts = async () => {
            const { data, error } = await supabase
                .from('emergency_contacts')
                .select('*')
                .eq('user_id', currentUser.id);

            if (error) {
                console.error("Error fetching contacts:", error);
                toast.error("Error al cargar contactos.");
            } else {
                setContacts(data || []);
            }
            setLoading(false);
        };

        fetchContacts();

        // Suscribirse a cambios en tiempo real
        const channel = supabase.channel(`emergency_contacts_${currentUser.id}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'emergency_contacts', filter: `user_id=eq.${currentUser.id}` },
                fetchContacts
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [currentUser]);

    const handleAddContact = async (e) => {
        e.preventDefault();
        if (!newContact.name.trim() || !newContact.phone.trim()) {
            return toast.error("El nombre y el teléfono son obligatorios.");
        }
        if (contacts.length >= 5) {
            return toast.error("Puedes añadir un máximo de 5 contactos.");
        }

        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('emergency_contacts')
                .insert({
                    user_id: currentUser.id,
                    name: newContact.name.trim(),
                    phone: newContact.phone.trim()
                });

            if (error) throw error;

            setNewContact({ name: '', phone: '' });
            toast.success("¡Contacto añadido con éxito!");
        } catch (error) {
            console.error("Error adding contact:", error);
            toast.error("No se pudo añadir el contacto.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteContact = async (contactId) => {
        try {
            const { error } = await supabase
                .from('emergency_contacts')
                .delete()
                .eq('id', contactId);

            if (error) throw error;
            toast.success("Contacto eliminado.");
        } catch (error) {
            console.error("Error deleting contact:", error);
            toast.error("No se pudo eliminar el contacto.");
        }
    };

    if (loading) {
        return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;
    }

    return (
        <div className="min-h-screen bg-slate-50 pb-32">
            <SubPageHeader title="Contactos de Emergencia" />

            <main className="container mx-auto p-4 max-w-2xl space-y-8 mt-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <Card className="rounded-[2.5rem] border-none shadow-xl glass overflow-hidden">
                    <CardHeader className="bg-red-500/5 pb-8 border-b border-red-500/10">
                        <CardTitle className="text-xl font-black text-red-600 flex items-center gap-3">
                            <ShieldAlert className="h-6 w-6" /> Añadir Persona de Confianza
                        </CardTitle>
                        <CardDescription className="font-medium text-red-600/70">
                            Podrás compartir tu ubicación en tiempo real con estas personas si alguna vez te sientes inseguro/a.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-8">
                        <form onSubmit={handleAddContact} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Nombre</Label>
                                    <div className="relative">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                        <Input
                                            value={newContact.name}
                                            onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                                            placeholder="Ej: Mamá"
                                            className="h-12 pl-11 rounded-xl border-2 font-bold focus:border-red-400 focus-visible:ring-red-400"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Teléfono</Label>
                                    <div className="relative">
                                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                        <Input
                                            type="tel"
                                            value={newContact.phone}
                                            onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                                            placeholder="+34 600 000 000"
                                            className="h-12 pl-11 rounded-xl border-2 font-bold focus:border-red-400 focus-visible:ring-red-400"
                                        />
                                    </div>
                                </div>
                            </div>
                            <Button
                                type="submit"
                                disabled={isSaving || contacts.length >= 5}
                                className="w-full h-14 rounded-2xl bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/20 font-black text-lg transition-all"
                            >
                                {isSaving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Plus className="mr-2 h-5 w-5" />}
                                Guardar Contacto
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <Card className="rounded-[2.5rem] border-none shadow-xl glass overflow-hidden">
                    <CardHeader className="bg-slate-50 border-b border-gray-100">
                        <CardTitle className="text-lg font-black text-slate-800 flex items-center gap-3">
                            <Heart className="h-5 w-5 text-red-500 fill-red-500" /> Tus Guardas de Seguridad ({contacts.length}/5)
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        {contacts.length > 0 ? (
                            <div className="divide-y divide-gray-100">
                                {contacts.map(contact => (
                                    <div key={contact.id} className="flex items-center justify-between p-6 hover:bg-gray-50/50 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="h-12 w-12 bg-red-50 rounded-2xl flex items-center justify-center border border-red-100">
                                                <User className="h-6 w-6 text-red-500" />
                                            </div>
                                            <div>
                                                <p className="font-black text-slate-800 leading-tight">{contact.name}</p>
                                                <p className="text-sm font-bold text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                                    <Phone className="h-3 w-3" /> {contact.phone}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                                                <BadgeCheck className="h-3 w-3" /> Verificado
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-10 w-10 rounded-xl hover:bg-red-50 hover:text-red-600 text-gray-300"
                                                onClick={() => handleDeleteContact(contact.id)}
                                            >
                                                <Trash2 className="h-5 w-5" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-12 text-center space-y-4">
                                <div className="h-20 w-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
                                    <ShieldAlert className="h-10 w-10 text-slate-300" />
                                </div>
                                <div>
                                    <p className="text-slate-800 font-black">No tienes contactos aún</p>
                                    <p className="text-sm font-medium text-muted-foreground max-w-xs mx-auto mt-1">
                                        Añade a alguien de confianza para que pueda estar pendiente de ti durante tus viajes.
                                    </p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </main>
        </div>
    );
}

export default EmergencyContacts;
