import { useState, useEffect } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import SubPageHeader from './SubPageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.jsx";
import { Loader2, Save, MapPin, Heart, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import { saveFavoriteRoute } from '../services/rideService';
import { cn, calculateDistance } from '@/lib/utils';
import { calculateSuggestedPrice } from '@/utils/pricingRules';

const weekDays = [{ value: '1', label: 'L' }, { value: '2', label: 'M' }, { value: '3', label: 'X' }, { value: '4', label: 'J' }, { value: '5', label: 'V' }, { value: '6', label: 'S' }, { value: '0', label: 'D' }];

const EditFavoriteRoute = () => {
    const { id: routeId } = useParams();
    const navigate = useNavigate();
    const { profile } = useOutletContext();

    const isNew = routeId === 'new';
    const [name, setName] = useState('');
    const [origin, setOrigin] = useState(null);
    const [destination, setDestination] = useState(null);
    const [days, setDays] = useState([]);
    const [seats, setSeats] = useState(4);
    const [price, setPrice] = useState(0);
    const [departureTime, setDepartureTime] = useState('08:00');
    const [isSaving, setIsSaving] = useState(false);

    // Efecto para autocalcular el precio cuando cambian origen o destino
    useEffect(() => {
        const getCoords = (loc) => {
            if (!loc) return null;
            if (loc.coordinates) return loc.coordinates;
            if (typeof loc.lat === 'number' && typeof loc.lng === 'number') return { lat: loc.lat, lng: loc.lng };
            return null;
        };

        const originCoords = getCoords(origin);
        const destCoords = getCoords(destination);

        if (originCoords && destCoords) {
            const dist = calculateDistance(
                originCoords.lat,
                originCoords.lng,
                destCoords.lat,
                destCoords.lng
            );

            // Solo autocalculamos si el precio actual es 0 o no está definido
            if (dist > 0 && (parseFloat(price) === 0 || !price)) {
                const suggested = calculateSuggestedPrice(dist);
                setPrice(parseFloat(suggested));
            }
        }
    }, [origin, destination, price]);

    useEffect(() => {
        if (!isNew && profile) {
            const fetchRoute = async () => {
                const { data, error } = await supabase
                    .from('favorite_routes')
                    .select('*')
                    .eq('id', routeId)
                    .single();

                if (data) {
                    setName(data.name);
                    setOrigin(data.origin);
                    setDestination(data.destination);
                    setDays(data.days.map(String));
                    setSeats(data.seats || 4);
                    setPrice(data.price || 0);
                    setDepartureTime(data.departure_time?.slice(0, 5) || '08:00');
                }
            };
            fetchRoute();
        }
    }, [routeId, isNew, profile]);

    const handleSave = async () => {
        if (!name || !origin || !destination || days.length === 0 || !departureTime) {
            return toast.error("Por favor, completa todos los campos.");
        }
        setIsSaving(true);
        try {
            const routeData = {
                id: isNew ? undefined : routeId,
                user_id: profile.id,
                name,
                origin: {
                    address: origin.address,
                    coordinates: origin.coordinates
                },
                destination: {
                    address: destination.address,
                    coordinates: destination.coordinates
                },
                days: days.map(Number),
                seats: parseInt(seats),
                price: parseFloat(price),
                departure_time: departureTime
            };

            await saveFavoriteRoute(routeData);
            toast.success("¡Ruta guardada con éxito!");
            navigate('/favorite-routes');
        } catch (error) {
            toast.error("Error al guardar la ruta", { description: error.message });
        } finally {
            setIsSaving(false);
        }
    };

    if (!profile) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>;

    return (
        <div className="min-h-screen bg-muted/30 pb-32">
            <SubPageHeader title={isNew ? 'Nueva Ruta Habitual' : 'Editar Ruta Habitual'} />
            <main className="container mx-auto p-4 max-w-2xl">
                <Card className="rounded-[2.5rem] border-none shadow-xl glass overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <CardHeader className="bg-primary/5 pb-8">
                        <CardTitle className="flex items-center gap-2 text-2xl font-black text-primary">
                            <Heart className="h-6 w-6 fill-primary" />
                            {isNew ? 'Nueva Ruta' : 'Editar Ruta'}
                        </CardTitle>
                        <CardDescription className="font-medium text-muted-foreground">Recibirás avisos cuando haya viajes en este trayecto.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 space-y-8">
                        <div className="space-y-2">
                            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Nombre de la ruta</Label>
                            <Input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Ej: Trabajo, Universidad..."
                                className="h-12 rounded-xl border-2 font-bold focus:border-primary transition-all"
                            />
                        </div>

                        <div className="space-y-4">
                            <div className="relative">
                                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1 mb-2 block">Origen</Label>
                                <AddressAutocomplete
                                    label="Punto de partida"
                                    onSelect={setOrigin}
                                    initialValue={origin?.address || ''}
                                />
                            </div>
                            <div className="relative">
                                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1 mb-2 block">Destino</Label>
                                <AddressAutocomplete
                                    label="Punto de llegada"
                                    onSelect={setDestination}
                                    initialValue={destination?.address || ''}
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Días activos</Label>
                            <ToggleGroup type="multiple" value={days} onValueChange={setDays} variant="outline" className="flex justify-between gap-1">
                                {weekDays.map(day => (
                                    <ToggleGroupItem
                                        key={day.value}
                                        value={day.value}
                                        className="flex-1 h-12 rounded-xl font-black data-[state=on]:bg-primary data-[state=on]:text-white data-[state=on]:border-primary transition-all"
                                    >
                                        {day.label}
                                    </ToggleGroupItem>
                                ))}
                            </ToggleGroup>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Hora Salida</Label>
                                <Input
                                    type="time"
                                    value={departureTime}
                                    onChange={e => setDepartureTime(e.target.value)}
                                    className="h-12 rounded-xl border-2 font-bold focus:border-primary transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Plazas</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    max="8"
                                    value={seats}
                                    onChange={e => setSeats(e.target.value)}
                                    className="h-12 rounded-xl border-2 font-bold focus:border-primary transition-all"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Precio (€)</Label>
                                <div className="relative">
                                    <Input
                                        type="number"
                                        step="0.10"
                                        min="0.50"
                                        value={price}
                                        onChange={e => setPrice(e.target.value)}
                                        className="h-12 rounded-xl border-2 font-bold focus:border-primary transition-all pr-10"
                                    />
                                    {origin && destination && (
                                        <button
                                            onClick={() => {
                                                const dist = calculateDistance(
                                                    origin.coordinates?.lat || origin.lat,
                                                    origin.coordinates?.lng || origin.lng,
                                                    destination.coordinates?.lat || destination.lat,
                                                    destination.coordinates?.lng || destination.lng
                                                );
                                                setPrice(parseFloat(calculateSuggestedPrice(dist)));
                                                toast.info("Precio sugerido aplicado");
                                            }}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-primary hover:text-primary/70 transition-colors"
                                            title="Calcular precio sugerido"
                                        >
                                            <Sparkles className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <Button
                            onClick={handleSave}
                            disabled={isSaving || !origin || !destination}
                            className="w-full h-14 rounded-2xl text-lg font-black tracking-tight shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all mt-4"
                        >
                            {isSaving ? <Loader2 className="animate-spin h-6 w-6" /> : <><Save className="mr-2 h-5 w-5" /> Guardar Ruta</>}
                        </Button>
                    </CardContent>
                </Card>
            </main>
        </div>
    );
};

export default EditFavoriteRoute;
