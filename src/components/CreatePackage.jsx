import React, { useState, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Loader2, CalendarIcon, PackageCheck, Box, Package as PackageIcon, FileText, Send, MapPin, Euro, Info, Sparkles, Truck, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import { supabase } from '../lib/supabase';
import { cn } from '@/lib/utils';
import SubPageHeader from './SubPageHeader';

const CreatePackage = () => {
    const { profile: currentUserProfile } = useOutletContext();
    const navigate = useNavigate();

    const [isLoading, setIsLoading] = useState(false);
    const [origin, setOrigin] = useState(null);
    const [destination, setDestination] = useState(null);
    const [deliveryBy, setDeliveryBy] = useState(null);
    const [size, setSize] = useState('medium');
    const [price, setPrice] = useState('');
    const [description, setDescription] = useState('');

    const handleCreatePackage = async (e) => {
        e.preventDefault();
        if (!origin || !destination || !deliveryBy || !price || !description) {
            toast.error("Por favor, completa todos los campos.");
            return;
        }
        setIsLoading(true);

        try {
            const { error } = await supabase.from('packages').insert({
                sender_id: currentUserProfile.id || currentUserProfile.uid,

                // Store full object for UI
                origin: origin,
                destination: destination,

                // Standard Columns
                origin_address: origin.address,
                destination_address: destination.address,

                // PostGIS Types
                origin_location: { type: 'Point', coordinates: [origin.coordinates.lng, origin.coordinates.lat] },
                destination_location: { type: 'Point', coordinates: [destination.coordinates.lng, destination.coordinates.lat] },

                delivery_by: deliveryBy.toISOString(),
                size: size,
                price: Number(price),
                description: description.trim(),
                status: 'pending'
            });

            if (error) throw error;

            toast.success("¡Solicitud de envío publicada!", {
                description: "Te notificaremos cuando un conductor acepte tu paquete."
            });
            navigate('/my-packages');
        } catch (error) {
            console.error("Error creating package: ", error);
            toast.error("Error al publicar el envío.", { description: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    if (!currentUserProfile) return (
        <div className="h-screen flex items-center justify-center bg-slate-50">
            <Loader2 className="animate-spin text-primary h-12 w-12" />
        </div>
    );

    return (
        <div className="bg-slate-50 min-h-screen pb-40">
            <SubPageHeader title="Enviar Paquete" />

            <main className="max-w-xl mx-auto px-4 -mt-12 relative z-10 space-y-5">
                <form onSubmit={handleCreatePackage} className="space-y-10">

                    {/* SECCIÓN 1: RUTA DEL ENVÍO */}
                    <Card className="rounded-3xl border-none shadow-[0_20px_50px_rgba(0,0,0,0.08)] overflow-hidden bg-white/70 backdrop-blur-2xl animate-in fade-in slide-in-from-bottom-8 duration-700">
                        <CardHeader className="bg-navy p-10 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-40 h-40 bg-primary/10 rounded-full blur-3xl -mr-20 -mt-20" />
                            <div className="relative z-10 space-y-2">
                                <CardTitle className="text-2xl font-black text-white tracking-tighter flex items-center gap-3">
                                    <Truck className="h-6 w-6 text-primary" /> Logística de Envío
                                </CardTitle>
                                <CardDescription className="text-slate-400 font-bold uppercase text-[10px] tracking-widest pl-1">¿De dónde a dónde viaja tu paquete?</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="p-10 space-y-8">
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Punto de Recogida</label>
                                    <div className="relative group">
                                        <div className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-indigo-500 z-10 flex items-center justify-center">
                                            <div className="h-2.5 w-2.5 rounded-full bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,1)]" />
                                        </div>
                                        <AddressAutocomplete placeholder="Calle, ciudad o lugar..." onPlaceSelect={setOrigin} className="h-12 pl-14 rounded-2xl border-none bg-slate-50 shadow-inner font-bold text-slate-800 focus:ring-4 focus:ring-primary/5 transition-all" />
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Destino de Entrega</label>
                                    <div className="relative group">
                                        <div className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-primary z-10 flex items-center justify-center">
                                            <div className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_12px_rgba(249,115,22,1)]" />
                                        </div>
                                        <AddressAutocomplete placeholder="¿A quién le llega?" onPlaceSelect={setDestination} className="h-12 pl-14 rounded-2xl border-none bg-slate-50 shadow-inner font-bold text-slate-800 focus:ring-4 focus:ring-primary/5 transition-all" />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* SECCIÓN 2: DETALLES Y TAMAÑO */}
                    <Card className="rounded-3xl border-none shadow-[0_20px_50px_rgba(0,0,0,0.08)] overflow-hidden bg-white/70 backdrop-blur-2xl animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150">
                        <CardHeader className="bg-white p-10 border-b border-slate-50 flex flex-row items-center justify-between">
                            <div className="space-y-1">
                                <CardTitle className="text-2xl font-black text-slate-900 tracking-tighter flex items-center gap-3">
                                    <Box className="h-6 w-6 text-primary" /> El Paquete
                                </CardTitle>
                                <CardDescription className="text-slate-400 font-bold uppercase text-[10px] tracking-widest pl-1">Define el tamaño y la recompensa</CardDescription>
                            </div>
                            <div className="h-14 w-14 bg-slate-50 rounded-2xl flex items-center justify-center">
                                <PackageIcon className="h-7 w-7 text-slate-300" />
                            </div>
                        </CardHeader>
                        <CardContent className="p-10 space-y-10">

                            {/* SELECTOR DE TAMAÑO PREMIUM */}
                            <div className="space-y-4">
                                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Tamaño del Paquete</label>
                                <div className="grid grid-cols-3 gap-4">
                                    {[
                                        { id: 'small', label: 'PEQUEÑO', icon: FileText, desc: 'Llaves, cartas' },
                                        { id: 'medium', label: 'MEDIANO', icon: PackageIcon, desc: 'Caja, mochila' },
                                        { id: 'large', label: 'GRANDE', icon: Box, desc: 'Maleta, TV' }
                                    ].map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => setSize(item.id)}
                                            className={cn(
                                                "flex flex-col items-center justify-center p-6 rounded-3xl border-2 transition-all duration-500 gap-3 group/btn",
                                                size === item.id
                                                    ? "bg-navy border-navy text-white shadow-2xl scale-100"
                                                    : "bg-slate-50 border-transparent text-slate-400 hover:bg-white hover:border-slate-200 scale-95"
                                            )}
                                        >
                                            <item.icon className={cn("h-6 w-6 transition-colors", size === item.id ? "text-primary" : "text-slate-300 group-hover/btn:text-slate-400")} />
                                            <div className="text-center">
                                                <p className="text-[10px] font-black tracking-widest leading-none mb-1">{item.label}</p>
                                                <p className={cn("text-[8px] font-bold leading-none opacity-40", size === item.id ? "text-white" : "text-slate-400")}>{item.desc}</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-8">
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">¿Cuándo entregar?</label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className="w-full h-12 rounded-2xl justify-start font-black text-slate-800 border-none bg-slate-50 shadow-inner hover:bg-slate-100 transition-all">
                                                <CalendarIcon className="mr-3 h-5 w-5 text-primary" />
                                                {deliveryBy ? format(deliveryBy, "d 'de' MMM", { locale: es }) : "Fecha límite"}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0 rounded-3xl overflow-hidden border-none shadow-2xl z-[1100]" align="start">
                                            <Calendar mode="single" selected={deliveryBy} onSelect={setDeliveryBy} fromDate={new Date()} className="rounded-none border-none" />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-primary ml-1 font-bold">Aportación (€)</label>
                                    <div className="relative group">
                                        <Euro className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-primary" />
                                        <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="h-12 pl-14 pr-4 rounded-2xl border-none bg-primary/5 shadow-inner font-black text-primary text-xl" placeholder="0.00" />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">¿Qué enviamos?</label>
                                <div className="relative group">
                                    <Textarea
                                        placeholder="Describe el contenido, peso aproximado o instrucciones de cuidado..."
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        className="rounded-3xl border-none bg-slate-50 shadow-inner min-h-[140px] p-6 font-bold text-slate-700 placeholder:text-slate-300 placeholder:font-medium leading-relaxed resize-none focus:ring-4 focus:ring-primary/5 transition-all"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* BOTÓN FINAL ACCIÓN */}
                    <div className="sticky bottom-10 z-50">
                        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-slate-50 to-transparent -mb-10 pointer-events-none" />
                        <Button
                            type="submit"
                            disabled={isLoading || !origin || !destination}
                            className="w-full h-14 rounded-3xl text-2xl font-black tracking-tighter shadow-[0_20px_50px_rgba(249,115,22,0.4)] bg-primary hover:bg-navy transition-all hover:scale-[1.02] active:scale-95 group border-t border-white/20 relative z-10 text-white"
                        >
                            {isLoading ? (
                                <><Loader2 className="animate-spin h-8 w-8 mr-3 text-white" /> PUBLICANDO...</>
                            ) : (
                                <><Send className="mr-3 h-7 w-7 text-white group-hover:rotate-45 group-hover:translate-x-1 transition-transform" /> PUBLICAR ENVÍO</>
                            )}
                        </Button>
                    </div>
                </form>
            </main>
        </div>
    );
};

export default CreatePackage;
