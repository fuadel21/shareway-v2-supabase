import { useEffect, useState } from 'react';
import { Radar, MapPin, Loader2, ShieldCheck, CarFront, Route } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Switch } from '@/components/ui/switch.jsx';

const RADII = [10, 25, 50, 100];
const DESTINATION_RADII = [10, 25, 50];

const getCurrentPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) {
    reject(new Error('Tu dispositivo no permite compartir ubicación.'));
    return;
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
    () => reject(new Error('Activa el permiso de ubicación para usar el radar.')),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 5 * 60 * 1000 },
  );
});

export default function PassengerRadarSettingsCard() {
  const [settings, setSettings] = useState({
    enabled: false,
    radius_km: 25,
    has_location: false,
    match_favorite_routes: false,
    destination_radius_km: 25,
    favorite_routes_count: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data, success } = await safeCall(
        () => supabase.rpc('get_my_passenger_radar_preferences'),
        'get_my_passenger_radar_preferences',
      );

      if (active && success && data) setSettings((current) => ({ ...current, ...data }));
      if (active) setIsLoading(false);
    };

    load();
    return () => { active = false; };
  }, []);

  const save = async ({ enabled = settings.enabled, radius = settings.radius_km } = {}) => {
    setIsSaving(true);
    try {
      let position = null;
      if (enabled) position = await getCurrentPosition();

      const { data, success, error } = await safeCall(
        () => supabase.rpc('update_passenger_radar_presence', {
          p_enabled: enabled,
          p_radius_km: radius,
          p_latitude: position?.latitude ?? null,
          p_longitude: position?.longitude ?? null,
        }),
        'update_passenger_radar_presence',
      );

      if (!success) throw new Error(error || 'No se pudo actualizar el radar.');

      setSettings((current) => ({
        ...current,
        ...data,
        enabled,
        radius_km: radius,
        has_location: enabled ? true : current.has_location,
      }));

      toast.success(enabled ? 'Radar de plazas activado' : 'Radar de plazas desactivado', {
        description: enabled
          ? `Te avisaremos cuando se publique un viaje con origen dentro de ${radius} km.`
          : 'Ya no recibirás alertas de nuevos viajes cercanos.',
      });
    } catch (error) {
      toast.error('No se pudo actualizar el radar de plazas', { description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const saveRouteFilter = async ({
    enabled = settings.match_favorite_routes,
    destinationRadius = settings.destination_radius_km,
  } = {}) => {
    setIsSaving(true);
    try {
      const { data, success, error } = await safeCall(
        () => supabase.rpc('set_passenger_radar_route_filter', {
          p_enabled: enabled,
          p_destination_radius_km: destinationRadius,
        }),
        'set_passenger_radar_route_filter',
      );

      if (!success) throw new Error(error || 'No se pudo actualizar el filtro de rutas.');

      setSettings((current) => ({
        ...current,
        ...data,
        match_favorite_routes: enabled,
        destination_radius_km: destinationRadius,
      }));

      toast.success(enabled ? 'Coincidencia inteligente activada' : 'Coincidencia inteligente desactivada', {
        description: enabled
          ? 'Solo recibirás viajes compatibles con tus rutas favoritas.'
          : 'El radar volverá a avisarte de cualquier salida cercana.',
      });
    } catch (error) {
      toast.error('No se pudo actualizar la coincidencia', { description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-none rounded-[2.5rem] bg-white shadow-sm">
        <CardContent className="p-8 flex items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-none rounded-[2.5rem] bg-white text-slate-950 shadow-2xl overflow-hidden border border-slate-100">
      <CardContent className="p-6 space-y-6 relative">
        <div className="absolute -right-10 -top-10 size-40 rounded-full bg-emerald-400/15 blur-3xl" />

        <div className="relative flex items-start justify-between gap-5">
          <div className="flex items-start gap-4 min-w-0">
            <div className="size-14 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0">
              <CarFront className="size-7 text-emerald-600" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-emerald-600">Radar de plazas</p>
              <h3 className="mt-1 text-xl font-black uppercase italic tracking-tighter">Viajes cerca de tu origen</h3>
              <p className="mt-2 text-xs font-bold text-slate-500 leading-relaxed">
                Te avisaremos cuando un conductor publique plazas cerca de tu zona. Podrás abrir el viaje y reservar directamente.
              </p>
            </div>
          </div>

          <Switch
            checked={Boolean(settings.enabled)}
            onCheckedChange={(enabled) => save({ enabled })}
            disabled={isSaving}
            className="data-[state=checked]:bg-emerald-600 shrink-0"
          />
        </div>

        <div className="relative rounded-3xl bg-slate-50 border border-slate-100 p-4 flex items-center gap-3">
          <MapPin className="size-5 text-emerald-600 shrink-0" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Privacidad</p>
            <p className="text-[11px] font-bold text-slate-600 leading-relaxed">
              Usamos una zona aproximada para encontrar salidas cercanas. Los conductores no ven tu ubicación.
            </p>
          </div>
        </div>

        <div className="relative space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Radio del origen</p>
            <span className="text-sm font-black text-emerald-600">{settings.radius_km} km</span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {RADII.map((radius) => (
              <Button
                key={radius}
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => save({ radius })}
                className={settings.radius_km === radius
                  ? 'h-12 rounded-2xl border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 font-black'
                  : 'h-12 rounded-2xl border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 font-black'}
              >
                {radius}
              </Button>
            ))}
          </div>
        </div>

        <div className="relative rounded-[2rem] border border-indigo-100 bg-indigo-50/60 p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="size-11 rounded-2xl bg-white flex items-center justify-center text-indigo-600 shadow-sm">
                <Route className="size-5" />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.25em] text-indigo-600">Coincidencia inteligente</p>
                <p className="mt-1 text-xs font-black text-slate-800">Usar mis rutas favoritas</p>
                <p className="mt-1 text-[10px] font-bold text-slate-500 leading-relaxed">
                  El origen y el destino del viaje deberán coincidir con alguna de tus rutas guardadas.
                </p>
              </div>
            </div>
            <Switch
              checked={Boolean(settings.match_favorite_routes)}
              onCheckedChange={(enabled) => saveRouteFilter({ enabled })}
              disabled={isSaving || (!settings.favorite_routes_count && !settings.match_favorite_routes)}
              className="data-[state=checked]:bg-indigo-600 shrink-0"
            />
          </div>

          <div className="flex items-center justify-between rounded-2xl bg-white/80 px-4 py-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Rutas guardadas</span>
            <span className="text-sm font-black text-indigo-600">{settings.favorite_routes_count || 0}</span>
          </div>

          {settings.match_favorite_routes && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Margen del destino</p>
                <span className="text-sm font-black text-indigo-600">{settings.destination_radius_km} km</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {DESTINATION_RADII.map((radius) => (
                  <Button
                    key={radius}
                    type="button"
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => saveRouteFilter({ destinationRadius: radius })}
                    className={settings.destination_radius_km === radius
                      ? 'h-11 rounded-2xl border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 font-black'
                      : 'h-11 rounded-2xl border-indigo-100 bg-white text-indigo-700 hover:bg-indigo-100 font-black'}
                  >
                    {radius} km
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="relative flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-emerald-600">
          <ShieldCheck className="size-4" />
          Una alerta por viaje, con acceso directo para reservar
        </div>
      </CardContent>
    </Card>
  );
}
