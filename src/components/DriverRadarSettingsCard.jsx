import { useEffect, useState } from 'react';
import { Radar, MapPin, Loader2, ShieldCheck, Route } from 'lucide-react';
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

export default function DriverRadarSettingsCard() {
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
        () => supabase.rpc('get_my_driver_radar_preferences'),
        'get_my_driver_radar_preferences',
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
        () => supabase.rpc('update_driver_radar_presence', {
          p_enabled: enabled,
          p_radius_km: radius,
          p_latitude: position?.latitude ?? null,
          p_longitude: position?.longitude ?? null,
        }),
        'update_driver_radar_presence',
      );

      if (!success) throw new Error(error || 'No se pudo actualizar el radar.');

      setSettings((current) => ({
        ...current,
        ...data,
        enabled,
        radius_km: radius,
        has_location: enabled ? true : current.has_location,
      }));

      toast.success(enabled ? 'Radar de viajes activado' : 'Radar de viajes desactivado', {
        description: enabled
          ? `Recibirás solicitudes cercanas dentro de ${radius} km.`
          : 'Ya no recibirás nuevas alertas del radar.',
      });
    } catch (error) {
      toast.error('No se pudo actualizar el radar', { description: error.message });
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
        () => supabase.rpc('set_driver_radar_route_filter', {
          p_enabled: enabled,
          p_destination_radius_km: destinationRadius,
        }),
        'set_driver_radar_route_filter',
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
          ? 'Solo recibirás solicitudes compatibles con una ruta favorita.'
          : 'Volverás a recibir solicitudes según proximidad al origen.',
      });
    } catch (error) {
      toast.error('No se pudo actualizar el filtro', { description: error.message });
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
    <Card className="border-none rounded-[2.5rem] bg-slate-950 text-white shadow-2xl overflow-hidden">
      <CardContent className="p-6 space-y-6 relative">
        <div className="absolute -right-10 -top-10 size-40 rounded-full bg-primary/15 blur-3xl" />

        <div className="relative flex items-start justify-between gap-5">
          <div className="flex items-start gap-4 min-w-0">
            <div className="size-14 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
              <Radar className="size-7 text-primary" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-primary">Radar de viajes</p>
              <h3 className="mt-1 text-xl font-black uppercase italic tracking-tighter">Pasajeros cerca de ti</h3>
              <p className="mt-2 text-xs font-bold text-white/50 leading-relaxed">
                Te avisaremos cuando alguien publique una solicitud de viaje cerca de tu zona.
              </p>
            </div>
          </div>

          <Switch
            checked={Boolean(settings.enabled)}
            onCheckedChange={(enabled) => save({ enabled })}
            disabled={isSaving}
            className="data-[state=checked]:bg-primary shrink-0"
          />
        </div>

        <div className="relative rounded-3xl bg-white/10 border border-white/10 p-4 flex items-center gap-3">
          <MapPin className="size-5 text-emerald-300 shrink-0" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-white/35">Privacidad</p>
            <p className="text-[11px] font-bold text-white/70 leading-relaxed">
              Guardamos una zona aproximada para buscar coincidencias. El pasajero no ve tu ubicación.
            </p>
          </div>
        </div>

        <div className="relative space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-white/40">Radio de avisos</p>
            <span className="text-sm font-black text-primary">{settings.radius_km} km</span>
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
                  ? 'h-12 rounded-2xl border-primary bg-primary text-white hover:bg-primary/90 font-black'
                  : 'h-12 rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10 font-black'}
              >
                {radius}
              </Button>
            ))}
          </div>
        </div>

        <div className="relative rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Route className="size-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest">Usar mis rutas favoritas</p>
                <p className="mt-1 text-[11px] font-bold text-white/55 leading-relaxed">
                  Exige que el origen y el destino de la solicitud encajen con una ruta guardada.
                </p>
                <p className="mt-2 text-[9px] font-black uppercase tracking-widest text-white/30">
                  {settings.favorite_routes_count || 0} ruta(s) disponible(s)
                </p>
              </div>
            </div>
            <Switch
              checked={Boolean(settings.match_favorite_routes)}
              onCheckedChange={(enabled) => saveRouteFilter({ enabled })}
              disabled={isSaving}
              className="data-[state=checked]:bg-primary shrink-0"
            />
          </div>

          {settings.match_favorite_routes && (
            <div className="space-y-3 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-black uppercase tracking-[0.25em] text-white/40">Margen del destino</p>
                <span className="text-sm font-black text-primary">{settings.destination_radius_km} km</span>
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
                      ? 'h-11 rounded-2xl border-primary bg-primary text-white hover:bg-primary/90 font-black'
                      : 'h-11 rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10 font-black'}
                  >
                    {radius}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="relative flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-emerald-300">
          <ShieldCheck className="size-4" />
          Una alerta por solicitud, sin duplicados
        </div>
      </CardContent>
    </Card>
  );
}
