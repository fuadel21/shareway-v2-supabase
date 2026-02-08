import React from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  Car, History, Map as MapIcon, Shield, Fingerprint,
  Key, ChevronRight, LogOut, User, Bell, Palette,
  CreditCard, ChevronLeft, ShieldCheck, Sparkles,
  Landmark, Wallet as WalletIcon, Share2, Radio,
  Smartphone, Eye
} from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const SettingItem = ({ icon: Icon, label, onClick, color, sublabel, badge }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center justify-between p-4 md:p-6 bg-white rounded-[2rem] md:rounded-[2.5rem] border border-slate-100 hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-500 group"
  >
    <div className="flex items-center gap-4 md:gap-6 text-left">
      <div className={cn("h-12 w-12 md:h-16 md:w-16 rounded-2xl md:rounded-[1.5rem] flex items-center justify-center shadow-lg transition-transform group-hover:rotate-6 duration-500 relative", color)}>
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

const SectionHeader = ({ title, icon: Icon, color }) => {
  return (
    <div className="px-4 flex justify-between items-center mb-6">
      <div className="flex items-center gap-3">
        {Icon && <Icon size={14} className={color} />}
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] italic">{title}</h3>
      </div>
      <div className="h-px flex-1 bg-slate-100 ml-4 opacity-50" />
    </div>
  );
};

const Settings = () => {
  const navigate = useNavigate();
  const { profile, handleSignOut } = useOutletContext();
  const { t } = useTranslation();

  return (
    <div className="bg-slate-50 min-h-screen pb-40 font-sans text-left">
      <header className="bg-white px-4 md:px-6 py-6 md:py-8 border-b border-slate-100 sticky top-0 z-20">
        <div className="max-w-xl mx-auto flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/account')} className="rounded-2xl bg-slate-50 size-10 md:size-12">
            <ChevronLeft className="h-5 w-5 md:h-6 md:w-6 text-slate-900" />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tighter italic uppercase leading-none">{t('settings.title')}</h1>
            <p className="text-[9px] md:text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1 italic">{t('settings.subtitle')}</p>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 md:py-8 space-y-8 md:space-y-12 text-left">
        {/* CUENTA Y PERFIL */}
        <section>
          <SectionHeader title={t('settings.account_section')} icon={User} color="text-slate-900" />
          <div className="grid grid-cols-1 gap-4">
            <SettingItem
              icon={User}
              label={profile?.display_name || 'Mi Perfil'}
              sublabel={t('settings.edit_profile')}
              color="bg-slate-900"
              onClick={() => navigate('/profile/edit')}
            />
          </div>
        </section>

        {/* FINANZAS Y PAGOS */}
        <section>
          <SectionHeader title={t('wallet.title')} icon={WalletIcon} color="text-amber-500" />
          <div className="grid grid-cols-1 gap-4">
            <SettingItem
              icon={Landmark}
              label={t('settings.driver_payouts')}
              sublabel={t('settings.payouts_sub')}
              color="bg-emerald-600"
              badge={!profile?.stripe_onboarding_complete}
              onClick={() => navigate('/settings/payout')}
            />
          </div>
        </section>

        {/* PREFERENCIAS DE VIAJE (Aquí movimos rutas) */}
        <section>
          <SectionHeader title={t('settings.travel_prefs')} icon={MapIcon} color="text-blue-500" />
          <div className="grid grid-cols-1 gap-4">
            <SettingItem
              icon={MapIcon}
              label={t('settings.routes')}
              sublabel={t('settings.routes_sub')}
              color="bg-blue-600"
              onClick={() => navigate('/settings/routes')}
            />
          </div>
        </section>

        {/* SEGURIDAD Y TRUST */}
        <section>
          <SectionHeader title={t('settings.security_trust')} icon={Shield} color="text-orange-500" />
          <div className="grid grid-cols-1 gap-4">
            <SettingItem
              icon={Shield}
              label={t('settings.security')}
              sublabel={t('settings.security_sub')}
              color="bg-orange-500"
              onClick={() => navigate('/settings/security')}
            />
            <SettingItem
              icon={Fingerprint}
              label={t('settings.identity')}
              sublabel={t('settings.identity_sub')}
              color="bg-slate-800"
              onClick={() => navigate('/settings/verification')}
            />
          </div>
        </section>

        {/* CONFIGURACIÓN DE APP */}
        <section>
          <SectionHeader title={t('settings.app_prefs')} icon={Smartphone} color="text-indigo-500" />
          <div className="grid grid-cols-1 gap-4">
            <SettingItem
              icon={Palette}
              label={t('settings.design_style')}
              sublabel={t('settings.design_sub')}
              color="bg-indigo-500"
              onClick={() => navigate('/settings/appearance')}
            />
            <SettingItem
              icon={Bell}
              label={t('settings.notifications')}
              sublabel={t('settings.notifications_sub')}
              color="bg-violet-600"
              onClick={() => navigate('/settings/notifications')}
            />
          </div>
        </section>

        <div className="pt-6 md:pt-10">
          <Button
            onClick={handleSignOut}
            variant="ghost"
            className="w-full h-16 md:h-20 rounded-2xl md:rounded-[2.5rem] bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 font-black text-base md:text-lg tracking-tighter shadow-sm border-none uppercase italic"
          >
            <LogOut className="mr-3 size-5 md:size-6" /> {t('nav.logout')}
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Settings;
