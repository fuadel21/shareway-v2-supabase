import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  History, Map as MapIcon, Shield, Fingerprint,
  ChevronRight, LogOut, User, Bell, Palette,
  Landmark, Wallet as WalletIcon,
  Smartphone, Leaf, Star, FlaskConical, Car,
  CheckCircle2, AlertTriangle, Radar, Loader2, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';
import ReferralCard from '@/components/referrals/ReferralCard.jsx';

const SettingItem = ({ icon: Icon, label, onClick, color, sublabel, badge }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center justify-between p-4 md:p-6 bg-white rounded-3xl md:rounded-3xl border border-slate-100 hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-500 group"
  >
    <div className="flex items-center gap-4 md:gap-6 text-left">
      <div className={cn("h-12 w-12 md:h-16 md:w-16 rounded-2xl md:rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:rotate-6 duration-500 relative", color)}>
        <Icon className="size-5 md:size-6 text-white" />
        {badge && <div className="absolute -top-1 -right-1 size-3 md:size-4 bg-primary rounded-full border-2 border-white animate-pulse" />}
      </div>
      <div>
        <p className="text-xs md:text-sm font-black text-slate-900 uppercase tracking-tighter italic">{label}</p>
        {sublabel && <p className="text-[8px] md:text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{sublabel}</p>}
      </div>
    </div>
    <ChevronRight className="size-4 md:size-5 text-slate-300 group-hover:translate-x-1 transition-transform" />
  </button>
);

const SectionHeader = ({ title, icon: Icon, color }) => (
  <div className="px-4 flex justify-between items-center mb-6">
    <div className="flex items-center gap-3">
      {Icon && <Icon size={14} className={color} />}
      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] italic">{title}</h3>
    </div>
    <div className="h-px flex-1 bg-slate-100 ml-4 opacity-50" />
  </div>
);

const AccountStatusPill = ({ done, label }) => (
  <div className={cn(
    'flex items-center gap-2 rounded-2xl px-3 py-2 border text-left',
    done ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-amber-50 border-amber-100 text-amber-700'
  )}>
    {done ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
    <span className="text-[9px] font-black uppercase tracking-widest leading-tight">{label}</span>
  </div>
);

const RadarStatusPill = ({ state, label }) => {
  const isActive = state === 'active';
  const isUnknown = state === 'unknown';
  const statusLabel = isActive ? 'Activo' : isUnknown ? 'No disponible' : 'Inactivo';

  return (
    <div className={cn(
      'rounded-2xl border px-4 py-3 flex items-center justify-between gap-3',
      isActive
        ? 'bg-emerald-500/15 border-emerald-400/20'
        : isUnknown
          ? 'bg-amber-400/10 border-amber-300/20'
          : 'bg-white/5 border-white/10'
    )}>
      <span className="text-[9px] font-black uppercase tracking-widest text-white/70">{label}</span>
      <span className={cn(
        'text-[8px] font-black uppercase tracking-widest rounded-full px-2 py-1',
        isActive
          ? 'bg-emerald-400 text-slate-950'
          : isUnknown
            ? 'bg-amber-300 text-slate-950'
            : 'bg-white/10 text-white/45'
      )}>
        {statusLabel}
      </span>
    </div>
  );
};

const getRadarState = (result) => {
  if (!result?.success) return 'unknown';
  return result.data?.enabled ? 'active' : 'inactive';
};

const Settings = () => {
  const navigate = useNavigate();
  const { profile, user, isAdmin, handleSignOut } = useOutletContext();
  const { t } = useTranslation();
  const vehicle = profile?.vehicle || {};
  const hasVehicle = Boolean(vehicle.make && vehicle.model);
  const hasProfileName = Boolean(profile?.display_name || profile?.full_name || profile?.name);
  const hasPayouts = Boolean(profile?.stripe_onboarding_complete);
  const trustScore = [hasProfileName, hasVehicle, hasPayouts].filter(Boolean).length;
  const [radarStatus, setRadarStatus] = useState({ passenger: 'unknown', driver: 'unknown', loading: true });

  const loadRadarStatus = useCallback(async () => {
    if (!user?.id) return;

    setRadarStatus((current) => ({ ...current, loading: true }));
    const [passengerResult, driverResult] = await Promise.all([
      safeCall(
        () => supabase.rpc('get_my_passenger_radar_preferences'),
        'get_my_passenger_radar_preferences'
      ),
      safeCall(
        () => supabase.rpc('get_my_driver_radar_preferences'),
        'get_my_driver_radar_preferences'
      ),
    ]);

    setRadarStatus({
      passenger: getRadarState(passengerResult),
      driver: getRadarState(driverResult),
      loading: false,
    });
  }, [user?.id]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!user?.id) return;
      setRadarStatus((current) => ({ ...current, loading: true }));
      const [passengerResult, driverResult] = await Promise.all([
        safeCall(
          () => supabase.rpc('get_my_passenger_radar_preferences'),
          'get_my_passenger_radar_preferences'
        ),
        safeCall(
          () => supabase.rpc('get_my_driver_radar_preferences'),
          'get_my_driver_radar_preferences'
        ),
      ]);

      if (!active) return;
      setRadarStatus({
        passenger: getRadarState(passengerResult),
        driver: getRadarState(driverResult),
        loading: false,
      });
    };

    load();
    return () => { active = false; };
  }, [user?.id]);

  const knownRadarStates = [radarStatus.passenger, radarStatus.driver].filter((state) => state !== 'unknown');
  const activeRadars = knownRadarStates.filter((state) => state === 'active').length;
  const hasUnknownRadar = knownRadarStates.length < 2;

  return (
    <div className="bg-slate-50 min-h-screen pb-40 font-sans text-left">
      <header className="bg-white px-4 md:px-6 py-6 md:py-8 border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-xl mx-auto flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/account')} className="rounded-2xl bg-slate-50 size-10 md:size-12">
            <ChevronRight className="h-5 w-5 md:h-6 md:w-6 text-slate-900 rotate-180" />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">{t('settings.title')}</h1>
            <p className="text-[9px] md:text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1 italic">{t('settings.subtitle')}</p>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 md:py-8 space-y-5 md:space-y-6 text-left">
        <section className="rounded-3xl bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] text-white p-5 shadow-xl overflow-hidden relative">
          <div className="absolute -right-12 -top-12 size-40 rounded-full bg-white/15 blur-2xl" />
          <div className="relative space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/80">ShareWay</p>
                <h2 className="mt-1 text-xl font-black italic uppercase tracking-tighter leading-none">Centro de cuenta</h2>
                <p className="mt-1.5 text-[11px] font-bold text-white/75 leading-relaxed">Completa perfil, vehículo y cobros para dar más confianza antes de viajar.</p>
              </div>
              <div className="h-11 w-11 rounded-2xl bg-white/20 border border-white/20 flex items-center justify-center shrink-0">
                <Shield className="size-5 text-white" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-white/10 p-3 text-left">
                <p className="text-[8px] font-black uppercase tracking-widest text-white/35">Estado</p>
                <p className="mt-1 text-lg font-black italic">{trustScore}/3</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3 text-left">
                <p className="text-[8px] font-black uppercase tracking-widest text-white/35">Vehículo</p>
                <p className="mt-1 text-[10px] font-black uppercase truncate">{hasVehicle ? `${vehicle.make} ${vehicle.model}` : 'Pendiente'}</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3 text-left">
                <p className="text-[8px] font-black uppercase tracking-widest text-white/35">Cobros</p>
                <p className="mt-1 text-[10px] font-black uppercase">{hasPayouts ? 'Listos' : 'Revisar'}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <AccountStatusPill done={hasProfileName} label="Perfil visible" />
              <AccountStatusPill done={hasVehicle} label="Vehículo configurado" />
              <AccountStatusPill done={hasPayouts} label="Cobros del conductor" />
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <Button type="button" onClick={() => navigate('/profile/edit')} className="h-12 rounded-2xl bg-white text-slate-900 hover:bg-white/90 text-[9px] font-black uppercase tracking-normal">Perfil</Button>
              <Button type="button" onClick={() => navigate('/settings/vehicle')} className="h-12 rounded-2xl bg-white/10 text-white hover:bg-white/20 border border-white/10 text-[9px] font-black uppercase tracking-normal">Vehículo</Button>
              <Button type="button" onClick={() => navigate('/settings/security')} className="h-12 rounded-2xl bg-white/10 text-white hover:bg-white/20 border border-white/10 text-[9px] font-black uppercase tracking-normal">Seguridad</Button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-gradient-to-br from-[#0FC6A6] via-[#1267FF] to-[#0B2A86] text-white p-5 shadow-xl overflow-hidden relative">
          <div className="absolute -left-12 -bottom-12 size-40 rounded-full bg-white/15 blur-2xl" />
          <div className="relative space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-300">Radar ShareWay</p>
                <h2 className="mt-1 text-xl font-black italic uppercase tracking-tighter leading-none">Viajes compatibles</h2>
                <p className="mt-1.5 text-[11px] font-bold text-white/75 leading-relaxed">Recibe avisos cuando aparezca una plaza o una solicitud cerca de ti.</p>
              </div>
              <div className="h-11 w-11 rounded-2xl bg-white/20 border border-white/20 flex items-center justify-center shrink-0">
                {radarStatus.loading ? <Loader2 className="size-6 text-emerald-300 animate-spin" /> : <Radar className="size-6 text-emerald-300" />}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-white/10 p-3 col-span-1">
                <p className="text-[8px] font-black uppercase tracking-widest text-white/35">Activos</p>
                <p className="mt-1 text-lg font-black italic">{radarStatus.loading || hasUnknownRadar ? '—' : `${activeRadars}/2`}</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3 col-span-2">
                <p className="text-[8px] font-black uppercase tracking-widest text-white/35">Cobertura</p>
                <p className="mt-1 text-[10px] font-black uppercase">Pasajero y conductor</p>
              </div>
            </div>

            <div className="space-y-2">
              <RadarStatusPill state={radarStatus.passenger} label="Radar de plazas" />
              <RadarStatusPill state={radarStatus.driver} label="Radar de solicitudes" />
            </div>

            {hasUnknownRadar && !radarStatus.loading && (
              <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-[9px] font-bold leading-relaxed text-amber-100">No hemos podido comprobar uno o más radares. Tu configuración no se ha cambiado.</p>
                <Button type="button" variant="ghost" size="icon" onClick={loadRadarStatus} className="shrink-0 rounded-xl text-amber-100 hover:bg-amber-300/10" aria-label="Reintentar estado del radar">
                  <RefreshCw className="size-4" />
                </Button>
              </div>
            )}

            <Button
              type="button"
              onClick={() => navigate('/settings/notifications')}
              className="w-full h-14 rounded-2xl bg-emerald-400 text-slate-950 hover:bg-emerald-300 text-[10px] font-black uppercase tracking-[0.18em]"
            >
              <Radar className="mr-2 size-5" /> Configurar radar
            </Button>
          </div>
        </section>

        <section>
          <SectionHeader title={t('settings.account_section')} icon={User} color="text-slate-900" />
          <div className="grid grid-cols-1 gap-4">
            <SettingItem icon={User} label={profile?.display_name || t('settings.my_profile')} sublabel={t('settings.edit_profile')} color="bg-gradient-to-br from-[#1267FF] to-[#0FC6A6]" onClick={() => navigate('/profile/edit')} />
            <ReferralCard profile={profile} user={user} />
            <SettingItem icon={Leaf} label={t('settings.environmental_impact')} sublabel={t('settings.environmental_impact_sub')} color="bg-emerald-600" onClick={() => navigate('/settings/impact')} />
            <SettingItem icon={Star} label={t('settings.my_reviews')} sublabel={t('settings.my_reviews_sub')} color="bg-amber-500" onClick={() => navigate(`/profile/${profile?.id}`)} />
          </div>
        </section>

        <section>
          <SectionHeader title={t('wallet.title')} icon={WalletIcon} color="text-amber-500" />
          <div className="grid grid-cols-1 gap-4">
            <SettingItem icon={Landmark} label={t('settings.driver_payouts')} sublabel={t('settings.payouts_sub')} color="bg-emerald-600" badge={!profile?.stripe_onboarding_complete} onClick={() => navigate('/settings/payout')} />
          </div>
        </section>

        <section>
          <SectionHeader title={t('settings.travel_prefs')} icon={MapIcon} color="text-blue-500" />
          <div className="grid grid-cols-1 gap-4">
            <SettingItem icon={Car} label={hasVehicle ? `${vehicle.make} ${vehicle.model}` : 'Mi vehículo'} sublabel={hasVehicle ? 'Editar coche, plazas y normas' : 'Añade coche, plazas, equipaje y normas'} color="bg-gradient-to-br from-[#1267FF] to-[#0FC6A6]" badge={!hasVehicle} onClick={() => navigate('/settings/vehicle')} />
            <SettingItem icon={MapIcon} label={t('settings.routes')} sublabel={t('settings.routes_sub')} color="bg-blue-600" onClick={() => navigate('/settings/routes')} />
          </div>
        </section>

        <section>
          <SectionHeader title={t('settings.security_trust')} icon={Shield} color="text-orange-500" />
          <div className="grid grid-cols-1 gap-4">
            <SettingItem icon={Shield} label={t('settings.security')} sublabel={t('settings.security_sub')} color="bg-orange-500" onClick={() => navigate('/settings/security')} />
            <SettingItem icon={Fingerprint} label={t('settings.identity')} sublabel={t('settings.identity_sub')} color="bg-slate-800" onClick={() => navigate('/settings/verification')} />
          </div>
        </section>

        <section>
          <SectionHeader title={t('settings.app_prefs')} icon={Smartphone} color="text-indigo-500" />
          <div className="grid grid-cols-1 gap-4">
            <SettingItem icon={Palette} label={t('settings.design_style')} sublabel={t('settings.design_sub')} color="bg-indigo-500" onClick={() => navigate('/settings/appearance')} />
            <SettingItem icon={Bell} label={t('settings.notifications')} sublabel={t('settings.notifications_sub')} color="bg-violet-600" onClick={() => navigate('/settings/notifications')} />
            <SettingItem icon={History} label={t('settings.activity_history')} sublabel={t('settings.activity_history_sub')} color="bg-gradient-to-br from-[#1267FF] to-[#0FC6A6]" onClick={() => navigate('/settings/activity')} />
          </div>
        </section>

        {isAdmin && (
          <section>
            <SectionHeader title="Herramientas internas" icon={FlaskConical} color="text-cyan-500" />
            <div className="grid grid-cols-1 gap-4">
              <SettingItem icon={FlaskConical} label="Test de notificaciones" sublabel="Validar RLS, Realtime y contador" color="bg-cyan-600" onClick={() => navigate('/settings/notification-test')} />
            </div>
          </section>
        )}

        <div className="pt-6 md:pt-10">
          <Button onClick={handleSignOut} variant="ghost" className="w-full h-12 md:h-14 rounded-2xl md:rounded-3xl bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 font-black text-base md:text-lg tracking-tighter shadow-sm border-none uppercase italic">
            <LogOut className="mr-3 size-5 md:size-6" /> {t('nav.logout')}
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Settings;
