import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Label } from '@/components/ui/label.jsx';
import {
  Baby,
  Camera,
  Car,
  ChevronLeft,
  Dog,
  Loader2,
  Luggage,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';

const defaultVehicle = {
  make: '',
  model: '',
  year: '',
  color: '',
  plate: '',
  seats: 3,
  luggage: 'medium',
  pets: false,
  kids: true,
  ac: true,
  smoking: false,
  notes: '',
  photoURL: '',
};

const luggageOptions = [
  { value: 'small', label: 'Bolso pequeño' },
  { value: 'medium', label: 'Maleta mediana' },
  { value: 'large', label: 'Maleta grande' },
];

const cleanPlate = (value) => String(value || '')
  .replace(/\s+/g, '')
  .replace(/[^a-zA-Z0-9*]/g, '')
  .toUpperCase()
  .slice(0, 8);

const getVehicleTitle = (vehicle) => {
  const title = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  return title || 'Mi vehículo';
};

const ToggleCard = ({ icon: Icon, label, description, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'rounded-3xl border-2 p-4 text-left transition-all active:scale-95',
      active ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10' : 'border-slate-100 bg-white hover:bg-slate-50'
    )}
  >
    <div className="flex items-start gap-3">
      <div className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
        active ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'
      )}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs font-black uppercase tracking-tight text-slate-900">{label}</p>
        <p className="mt-1 text-[10px] font-bold uppercase leading-4 tracking-widest text-slate-400">{description}</p>
      </div>
    </div>
  </button>
);

const ReadinessStep = ({ icon: Icon, title, description, completed }) => (
  <div className={cn(
    'rounded-3xl border p-4 text-left transition-all',
    completed ? 'border-emerald-100 bg-emerald-50/70' : 'border-slate-100 bg-white'
  )}>
    <div className="flex items-start gap-3">
      <div className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
        completed ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'
      )}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-black uppercase italic tracking-tight text-slate-900">{title}</p>
        <p className="mt-1 text-[10px] font-bold uppercase leading-4 tracking-widest text-slate-400">{description}</p>
      </div>
    </div>
  </div>
);

const VehicleSettings = () => {
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useOutletContext();
  const [vehicle, setVehicle] = useState(defaultVehicle);
  const [vehicleImageFile, setVehicleImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const existingVehicle = profile?.vehicle || {};
    const nextVehicle = {
      ...defaultVehicle,
      ...existingVehicle,
      plate: cleanPlate(existingVehicle.plate || existingVehicle.plate_partial || ''),
      seats: Number(existingVehicle.seats || existingVehicle.total_seats || defaultVehicle.seats),
      photoURL: existingVehicle.photoURL || existingVehicle.photo_url || '',
    };
    setVehicle(nextVehicle);
    setPreviewUrl(nextVehicle.photoURL || '');
  }, [profile]);

  useEffect(() => () => {
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const completion = useMemo(() => {
    const checks = [vehicle.make, vehicle.model, vehicle.color, vehicle.plate, vehicle.seats, vehicle.luggage];
    const completed = checks.filter(Boolean).length;
    return Math.round((completed / checks.length) * 100);
  }, [vehicle]);

  const readiness = useMemo(() => {
    const basicsReady = Boolean(vehicle.make && vehicle.model && vehicle.color && vehicle.plate);
    const capacityReady = Boolean(Number(vehicle.seats) > 0 && vehicle.luggage);
    const rulesReady = Boolean(vehicle.kids || vehicle.ac || vehicle.pets || vehicle.smoking === false || vehicle.notes);
    const completed = [basicsReady, capacityReady, rulesReady].filter(Boolean).length;

    return {
      completed,
      total: 3,
      basicsReady,
      capacityReady,
      rulesReady,
      isReady: basicsReady && capacityReady,
    };
  }, [vehicle]);

  const updateVehicle = (patch) => {
    setVehicle((current) => ({ ...current, ...patch }));
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setVehicleImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const uploadVehicleImage = async () => {
    if (!vehicleImageFile || !user?.id) return vehicle.photoURL || '';

    const path = `${user.id}/vehicle_${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('profile-photos')
      .upload(path, vehicleImageFile, { upsert: true });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(path);
    return publicUrl;
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!user?.id || isSaving) return;

    if (!vehicle.make?.trim() || !vehicle.model?.trim()) {
      toast.error('Faltan datos del vehículo', {
        description: 'Indica al menos marca y modelo para que los pasajeros sepan con quién viajan.',
      });
      return;
    }

    setIsSaving(true);
    const toastId = toast.loading('Guardando vehículo...');

    try {
      const photoURL = await uploadVehicleImage();
      const cleanedVehicle = {
        ...vehicle,
        make: vehicle.make.trim(),
        model: vehicle.model.trim(),
        year: String(vehicle.year || '').trim(),
        color: String(vehicle.color || '').trim(),
        plate: cleanPlate(vehicle.plate),
        seats: Math.max(1, Math.min(8, Number(vehicle.seats || 1))),
        luggage: vehicle.luggage || 'medium',
        pets: Boolean(vehicle.pets),
        kids: Boolean(vehicle.kids),
        ac: Boolean(vehicle.ac),
        smoking: Boolean(vehicle.smoking),
        notes: String(vehicle.notes || '').trim().slice(0, 280),
        photoURL,
        updatedAt: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('profiles')
        .update({ vehicle: cleanedVehicle })
        .eq('id', user.id);

      if (error) throw error;

      await refreshProfile?.();
      setVehicle(cleanedVehicle);
      setPreviewUrl(photoURL || '');
      setVehicleImageFile(null);
      toast.success('Vehículo guardado', {
        id: toastId,
        description: 'Tus datos de coche se usarán para generar más confianza en las reservas.',
      });
    } catch (error) {
      toast.error('No se pudo guardar el vehículo', {
        id: toastId,
        description: error.message || 'Revisa la conexión y vuelve a intentarlo.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-40 font-sans text-left">
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white px-4 py-6 md:px-6 md:py-8">
        <div className="mx-auto flex max-w-xl items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className="size-10 rounded-2xl bg-slate-50 md:size-12">
            <ChevronLeft className="h-5 w-5 text-slate-900 md:h-6 md:w-6" />
          </Button>
          <div>
            <h1 className="text-2xl font-black uppercase italic leading-none tracking-tighter text-slate-900 md:text-3xl">Mi vehículo</h1>
            <p className="mt-1 text-[9px] font-black uppercase tracking-[0.2em] text-primary md:text-[10px]">Confianza antes de reservar</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-6 px-4 py-6 md:py-8">
        <section className="rounded-[2.5rem] border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Listo para publicar</p>
              <h2 className="mt-2 text-2xl font-black uppercase italic leading-none tracking-tighter text-slate-900">
                {readiness.isReady ? 'Vehículo preparado' : 'Completa tu coche'}
              </h2>
              <p className="mt-2 text-xs font-bold uppercase leading-5 tracking-widest text-slate-400">
                {readiness.isReady ? 'Ya puedes publicar viajes con más confianza.' : 'Completa datos básicos y plazas para que el pasajero reserve tranquilo.'}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-950 px-4 py-3 text-right text-white">
              <p className="text-[8px] font-black uppercase tracking-widest text-white/40">Guía</p>
              <p className="text-xl font-black text-primary">{readiness.completed}/{readiness.total}</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3">
            <ReadinessStep icon={Car} title="Datos básicos" description="Marca, modelo, color y matrícula parcial" completed={readiness.basicsReady} />
            <ReadinessStep icon={Users} title="Plazas y equipaje" description="Asientos disponibles y tamaño de maleta" completed={readiness.capacityReady} />
            <ReadinessStep icon={ShieldCheck} title="Normas claras" description="Mascotas, niños, aire y notas para pasajeros" completed={readiness.rulesReady} />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button type="button" onClick={() => navigate('/publish')} className="h-12 rounded-2xl bg-slate-950 text-[10px] font-black uppercase tracking-widest text-white">
              Publicar viaje
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/my-rides?tab=active')} className="h-12 rounded-2xl border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-700">
              Mis viajes
            </Button>
          </div>
        </section>

        <section className="overflow-hidden rounded-[2.5rem] bg-slate-950 text-white shadow-2xl">
          <div className="relative aspect-[16/9] bg-slate-900">
            {previewUrl ? (
              <img src={previewUrl} alt="Vehículo" className="h-full w-full object-cover opacity-90" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-white/20">
                <Car className="h-16 w-16" />
                <p className="text-[10px] font-black uppercase tracking-[0.4em]">Foto del coche</p>
              </div>
            )}
            <Label htmlFor="vehicle-photo" className="absolute bottom-4 right-4 flex h-14 w-14 cursor-pointer items-center justify-center rounded-2xl border-4 border-white bg-primary text-white shadow-2xl active:scale-95">
              <Camera className="h-5 w-5" />
            </Label>
            <Input id="vehicle-photo" type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
          </div>
          <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Vehículo principal</p>
                <h2 className="mt-2 text-3xl font-black italic leading-none tracking-tighter">{getVehicleTitle(vehicle)}</h2>
                <p className="mt-2 text-xs font-bold uppercase tracking-widest text-white/40">{vehicle.color || 'Color pendiente'} · {vehicle.seats || 1} plazas</p>
              </div>
              <div className="rounded-2xl bg-white/10 px-4 py-3 text-right">
                <p className="text-[8px] font-black uppercase tracking-widest text-white/40">Perfil</p>
                <p className="text-xl font-black text-primary">{completion}%</p>
              </div>
            </div>
          </div>
        </section>

        <form onSubmit={handleSave} className="space-y-6">
          <section className="rounded-[2.5rem] bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-primary">
                <Car className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase italic tracking-tight text-slate-900">Datos básicos</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Lo que verá el pasajero antes de reservar</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="ml-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Marca</Label>
                <Input value={vehicle.make} onChange={(e) => updateVehicle({ make: e.target.value })} placeholder="Toyota" className="h-14 rounded-2xl border-none bg-slate-50 px-5 font-black uppercase shadow-inner" />
              </div>
              <div className="space-y-2">
                <Label className="ml-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Modelo</Label>
                <Input value={vehicle.model} onChange={(e) => updateVehicle({ model: e.target.value })} placeholder="Corolla" className="h-14 rounded-2xl border-none bg-slate-50 px-5 font-black uppercase shadow-inner" />
              </div>
              <div className="space-y-2">
                <Label className="ml-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Color</Label>
                <Input value={vehicle.color} onChange={(e) => updateVehicle({ color: e.target.value })} placeholder="Gris" className="h-14 rounded-2xl border-none bg-slate-50 px-5 font-black uppercase shadow-inner" />
              </div>
              <div className="space-y-2">
                <Label className="ml-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Año</Label>
                <Input inputMode="numeric" value={vehicle.year} onChange={(e) => updateVehicle({ year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2019" className="h-14 rounded-2xl border-none bg-slate-50 px-5 font-black uppercase shadow-inner" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label className="ml-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Matrícula parcial</Label>
                <Input value={vehicle.plate} onChange={(e) => updateVehicle({ plate: cleanPlate(e.target.value) })} placeholder="1234B**" className="h-16 rounded-2xl border-none bg-slate-950 px-5 text-center font-mono text-xl font-black uppercase tracking-[0.3em] text-primary shadow-2xl" />
                <p className="px-4 text-[10px] font-bold leading-5 text-slate-400">Puedes ocultar parte de la matrícula con asteriscos. Ejemplo: 1234B**.</p>
              </div>
            </div>
          </section>

          <section className="rounded-[2.5rem] bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Users className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase italic tracking-tight text-slate-900">Comodidad y normas</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Evita dudas antes del viaje</p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <Label className="ml-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Plazas disponibles normalmente</Label>
                <div className="mt-2 grid grid-cols-4 gap-2 rounded-3xl bg-slate-50 p-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((seat) => (
                    <button
                      key={seat}
                      type="button"
                      onClick={() => updateVehicle({ seats: seat })}
                      className={cn(
                        'h-11 rounded-2xl text-xs font-black transition-all active:scale-95',
                        Number(vehicle.seats) === seat ? 'bg-slate-950 text-white shadow-lg' : 'bg-white text-slate-400 hover:text-slate-900'
                      )}
                    >
                      {seat}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="ml-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Equipaje permitido</Label>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {luggageOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateVehicle({ luggage: option.value })}
                      className={cn(
                        'rounded-2xl border-2 p-4 text-xs font-black uppercase tracking-tight transition-all active:scale-95',
                        vehicle.luggage === option.value ? 'border-primary bg-primary/5 text-primary shadow-sm' : 'border-slate-100 bg-slate-50 text-slate-400'
                      )}
                    >
                      <Luggage className="mx-auto mb-2 h-5 w-5" />
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ToggleCard icon={Dog} label="Mascotas" description="Permitir animales" active={vehicle.pets} onClick={() => updateVehicle({ pets: !vehicle.pets })} />
                <ToggleCard icon={Baby} label="Niños" description="Viajes familiares" active={vehicle.kids} onClick={() => updateVehicle({ kids: !vehicle.kids })} />
                <ToggleCard icon={Snowflake} label="Aire acondicionado" description="Coche climatizado" active={vehicle.ac} onClick={() => updateVehicle({ ac: !vehicle.ac })} />
                <ToggleCard icon={X} label="Sin humo" description="No fumar dentro" active={!vehicle.smoking} onClick={() => updateVehicle({ smoking: !vehicle.smoking })} />
              </div>
            </div>
          </section>

          <section className="rounded-[2.5rem] bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase italic tracking-tight text-slate-900">Notas para pasajeros</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Opcional pero recomendable</p>
              </div>
            </div>
            <Textarea
              value={vehicle.notes}
              onChange={(e) => updateVehicle({ notes: e.target.value.slice(0, 280) })}
              placeholder="Ejemplo: maletero mediano, punto de recogida flexible, música tranquila..."
              className="min-h-[130px] resize-none rounded-3xl border-none bg-slate-50 p-5 text-sm font-bold shadow-inner"
            />
            <p className="mt-2 px-3 text-right text-[10px] font-bold text-slate-400">{String(vehicle.notes || '').length}/280</p>
          </section>

          <Button type="submit" disabled={isSaving} className="h-16 w-full rounded-[2rem] bg-slate-950 text-lg font-black uppercase italic tracking-tight text-white shadow-2xl active:scale-95 md:h-20 md:rounded-[2.5rem]">
            {isSaving ? <Loader2 className="h-6 w-6 animate-spin" /> : <>{completion < 100 ? 'Guardar vehículo' : 'Actualizar vehículo'} <Sparkles className="ml-3 h-5 w-5 text-primary" /></>}
          </Button>
        </form>
      </main>
    </div>
  );
};

export default VehicleSettings;
