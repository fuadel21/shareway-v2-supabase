import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog.jsx";
import { UserPlus, Trash2, ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';

const AddContactDialog = ({ onAdd, isLoading }) => {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');

    const handleSubmit = () => {
        if (!name.trim() || !phone.trim()) {
            toast.error("Nombre y teléfono son requeridos.");
            return;
        }
        if (!/^(6|7|8|9)\d{8}$/.test(phone.replace(/\s/g, ''))) {
            toast.error("Formato de teléfono inválido.", { description: "Debe ser un número español de 9 dígitos." });
            return;
        }
        onAdd({ name, phone });
    };

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button><UserPlus className="mr-2 h-4 w-4" />Añadir Contacto</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Añadir Contacto de Emergencia</DialogTitle>
                    <DialogDescription>
                        Añade un nombre y teléfono para recibir alertas SOS en caso de emergencia.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <Input placeholder="Nombre" value={name} onChange={e => setName(e.target.value)} />
                    <Input type="tel" placeholder="Número de Teléfono (ej. 612345678)" value={phone} onChange={e => setPhone(e.target.value)} />
                </div>
                <DialogFooter>
                    <Button onClick={handleSubmit} disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

function EmergencyContacts() {
    const navigate = useNavigate();
    const { user } = useOutletContext();
    const [contacts, setContacts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!user?.id) return;

        const fetchContacts = async () => {
            setIsLoading(true);
            const { data, error } = await supabase
                .from('emergency_contacts')
                .select('*')
                .eq('user_id', user.id);

            if (error) toast.error("Error al cargar los contactos.");
            else setContacts(data);
            setIsLoading(false);
        };

        fetchContacts();
    }, [user?.id]);

    const handleAddContact = async (contact) => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('emergency_contacts')
                .insert({ ...contact, user_id: user.id })
                .select();

            if (error) throw error;

            setContacts(prev => [...prev, data[0]]);
            toast.success(`"${contact.name}" ha sido añadido a tus contactos.`);
        } catch (error) {
            toast.error("Error al añadir el contacto.", { description: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveContact = async (contactId) => {
        setIsLoading(true);
        try {
            const { error } = await supabase
                .from('emergency_contacts')
                .delete()
                .eq('id', contactId);

            if (error) throw error;

            setContacts(prev => prev.filter(c => c.id !== contactId));
            toast.success(`Contacto eliminado.`);
        } catch (error) {
            toast.error("Error al eliminar el contacto.", { description: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background">
            <main className="container mx-auto p-4 max-w-2xl">
                <div className="flex items-center gap-4 my-6">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft /></Button>
                    <h1 className="text-3xl font-bold">Contactos de Emergencia</h1>
                </div>
                <p className="text-muted-foreground mb-8">
                    Añade hasta 5 contactos de confianza. En caso de que actives el botón SOS durante un viaje, les enviaremos una alerta con los detalles de tu trayecto.
                </p>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle>Tu Lista de Contactos</CardTitle>
                            <CardDescription>Has añadido {contacts.length} de 5 contactos.</CardDescription>
                        </div>
                        {contacts.length < 5 &&
                            <AddContactDialog onAdd={handleAddContact} isLoading={isLoading} />
                        }
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {isLoading ? <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div> :
                                contacts.length > 0 ? (
                                    contacts.map((contact, index) => (
                                        <div key={index} className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                                            <div>
                                                <p className="font-semibold">{contact.name}</p>
                                                <p className="text-sm text-muted-foreground">{contact.phone}</p>
                                            </div>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" disabled={isLoading}>
                                                        <Trash2 className="h-5 w-5 text-destructive" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader><AlertDialogTitle>¿Eliminar a {contact.name}?</AlertDialogTitle><AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription></AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleRemoveContact(contact.id)}>Eliminar</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-center text-muted-foreground py-6">Aún no has añadido ningún contacto de emergencia.</p>
                                )}
                        </div>
                    </CardContent>
                </Card>
            </main>
        </div>
    );
}

export default EmergencyContacts;
