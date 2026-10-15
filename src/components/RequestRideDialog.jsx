import React, { useState, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarIcon, Clock, Send, MapPin, Users, Euro, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import AddressAutocomplete from './AddressAutocomplete.jsx';
import { createSingleRequest } from '../services/requestService.js';
import { calculateSuggestedPrice, validateRidePrice, PRICING_CONSTANTS } from '../utils/pricingRules.js';

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const coordinates = [lat1, lon1, lat2, lon2].map(Number);
  if (coordinates.some((value) => !Number.isFinite(value))) return 0;

  const [safeLat1, safeLon1, safeLat2, safeLon2] = coordinates;
  if (safeLat1 < -90 || safeLat1 > 90 || safeLat2 < -90 || safeLat2 > 90
    || safeLon1 < -180 || safeLon1 > 180 || safeLon2 < -180 || safeLon2 > 180) return 0;

  const R = 6371;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(safeLat2 - safeLat1);
  const dLon = toRad(safeLon2 - safeLon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(safeLat1)) * Math.cos(toRad(safeLat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const RequestRideDialog = ({ open, onOpenChange, userLocation }) => {
  const { profile } = useOutletContext();
  const navigate = useNavigate();
  const [requestType, setRequestType] = useState('now');
  const [destination, setDestination] = useState(null);
  const [scheduledDate, setScheduledDate] = useState(new Date());
  const [scheduledTime, setScheduledTime] = useState('');
  const [notes, setNotes] = useState('');
  const [seats, setSeats] = useState(1);
  const [price, setPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [distanceKm, setDistanceKm] = useState(0);
  const [isPriceManual, setIsPriceManual] = useState(false);

  const updateDerived = useCallback(() => {
    if (userLocation && destination?.coordinates) {
      const km = haversineKm(
        userLocation.lat,
        userLocation.lng,
        destination.coordinates.lat,
        destination.coordinates.lng
      );
      setDistanceKm(km);
      if (!isPriceManual && km > 0) setPrice(calculateSuggestedPrice(km));
    } else {
      setDistanceKm(0);
      if (!isPriceManual) setPrice('');
    }
  }, [userLocation, destination, isPriceManual]);

  React.useEffect(() => {
    updateDerived();
  }, [updateDerived]);

  const handleRequestSubmit = async () => {
    if (isSubmitting) return;
    if (!profile || !userLocation || !destination) {
      toast.error('Error', { description: 'Por favor, selecciona un destino.' });
      return;
    }

    let departureTime = new Date(Date.now() + 21 * 60 * 1000);
    if (requestType === 'later') {
      if (!scheduledDate || !scheduledTime) {
        toast.error('Error', { description: 'Elige fecha y hora.' });
        return;
      }
      const [hours, minutes] = scheduledTime.split(':').map(Number);
      departureTime = new Date(scheduledDate);
      departureTime.setHours(hours, minutes, 0, 0);
    }

    if (departureTime.getTime() <= Date.now() + 20 * 60 * 1000) {
      toast.error('Error', { description: 'La hora del viaje debe ser al menos 20 minutos a futuro.' });
      return;
    }

    const suggestedPrice = Number.parseFloat(String(price).replace(',', '.'));
    const priceValidation = validateRidePrice(suggestedPrice, distanceKm);
    if (!priceValidation.valid) {
      toast.error('Error', { description: priceValidation.details || priceValidation.error });
      return;
    }

    setIsSubmitting(true);
    try {
      const requestData = {
        origin: {
          name: 'Mi ubicación',
          address: 'Ubicación actual',
          coordinates: { lat: userLocation.lat, lng: userLocation.lng }
        },
        destination: destination,
        dateTime: departureTime,
        seats: Math.max(PRICING_CONSTANTS.MIN_SEATS, Math.min(PRICING_CONSTANTS.MAX_SEATS, Number(seats))),
        suggestedPrice,
        distance: distanceKm,
        details: notes.trim(),
      };

      await createSingleRequest(requestData);
      toast.success('¡Solicitud enviada!');
      onOpenChange(false);
      navigate('/my-requests');
    } catch (error) {
      console.error("Error al publicar la solicitud:", error);
      toast.error('Error al publicar', { description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px] rounded-3xl p-0 overflow-hidden border-none shadow-2xl glass">
        <DialogHeader className="p-8 bg-primary/5">
          <DialogTitle className="text-2xl font-black text-primary flex items-center gap-2">
            <MapPin className="h-6 w-6" /> ¿A dónde quieres ir?
          </DialogTitle>
          <DialogDescription className="font-medium">
            Tu ubicación actual se usará como punto de partida.
          </DialogDescription>
        </DialogHeader>

        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Destino</Label>
            <AddressAutocomplete
              label="Ej: Aeropuerto, Plaza Mayor..."
              onSelect={setDestination}
            />
          </div>

          <RadioGroup defaultValue="now" onValueChange={setRequestType} className="grid grid-cols-2 gap-4">
            <div className={cn(
              "flex items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all cursor-pointer",
              requestType === 'now' ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-muted hover:border-muted-foreground"
            )} onClick={() => setRequestType('now')}>
              <RadioGroupItem value="now" id="r-now" className="sr-only" />
              <Clock className={cn("h-5 w-5", requestType === 'now' ? "text-primary" : "text-muted-foreground")} />
              <Label htmlFor="r-now" className="font-bold cursor-pointer">Ahora</Label>
            </div>
            <div className={cn(
              "flex items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all cursor-pointer",
              requestType === 'later' ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-muted hover:border-muted-foreground"
            )} onClick={() => setRequestType('later')}>
              <RadioGroupItem value="later" id="r-later" className="sr-only" />
              <CalendarIcon className={cn("h-5 w-5", requestType === 'later' ? "text-primary" : "text-muted-foreground")} />
              <Label htmlFor="r-later" className="font-bold cursor-pointer">Más tarde</Label>
            </div>
          </RadioGroup>

          {requestType === 'later' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Fecha</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full h-12 rounded-xl justify-start font-bold border-2">
                        {format(scheduledDate, "d MMM", { locale: es })}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 rounded-2xl overflow-hidden border-none shadow-2xl">
                      <Calendar mode="single" selected={scheduledDate} onSelect={setScheduledDate} fromDate={new Date()} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Hora</Label>
                  <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className="h-12 rounded-xl border-2 font-bold" />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Pasajeros</Label>
              <div className="flex items-center gap-2 h-12 rounded-xl border-2 px-2 bg-white/50">
                <Users className="h-5 w-5 text-muted-foreground ml-1" />
                <div className="flex-1 flex items-center justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 rounded-full hover:bg-slate-100"
                    onClick={() => setSeats(Math.max(1, seats - 1))}
                    disabled={seats <= 1}
                  >
                    -
                  </Button>
                  <span className="font-black text-lg text-primary">{seats}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 rounded-full hover:bg-slate-100"
                    onClick={() => setSeats(Math.min(PRICING_CONSTANTS.MAX_SEATS, Number(seats) + 1))}
                    disabled={seats >= PRICING_CONSTANTS.MAX_SEATS}
                  >
                    +
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Oferta por plaza (€)</Label>
              <div className="relative">
                <Euro className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
                <Input
                  type="number"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setIsPriceManual(true);
                  }}
                  placeholder="Ej: 5.00"
                  className="pl-10 h-12 rounded-xl border-2 font-bold bg-white/50"
                  min={PRICING_CONSTANTS.MIN_PRICE}
                  step="0.01"
                />
              </div>
              {distanceKm > 0 && (
                <p className="text-[10px] font-bold mt-1 ml-1 text-slate-500">
                  Trayecto: {distanceKm.toFixed(1)} km · Máx. recomendado: {calculateSuggestedPrice(distanceKm)}€/plaza
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Notas (opcional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Llevo una maleta pequeña"
              className="h-12 rounded-xl border-2 font-semibold"
            />
          </div>

          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">
            Límite de asientos: {PRICING_CONSTANTS.MAX_SEATS} • La oferta es por plaza y la comisión ya está incluida
          </p>
        </div>

        <DialogFooter className="p-8 pt-0">
          <Button
            onClick={handleRequestSubmit}
            disabled={isSubmitting || !destination}
            className="w-full h-14 rounded-2xl text-lg font-black tracking-tight shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
          >
            {isSubmitting ? <Loader2 className="animate-spin h-6 w-6" /> : <><Send className="mr-2 h-5 w-5" /> Publicar Solicitud</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RequestRideDialog;
