import React, { useState, useEffect } from 'react';
import { Outlet, useOutletContext, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  MessageSquare, Car, Wallet, Settings as SettingsIcon,
  Bell, Sparkles, Star, CheckCircle2, LayoutDashboard,
  Plus, Megaphone, ShieldCheck, CalendarDays
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button.jsx';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { useTranslation } from 'react-i18next';
import NotificationCenterPanel from './notifications/NotificationCenterPanel.jsx';
import LanguageSwitcher from './LanguageSwitcher';

const AUDIO_ASSETS = {
  booking: 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3',
  welcome: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  review: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3',
  arrival: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
  chat: 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3',
  sos: 'https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3'
};

const hasAdminAccess = (profile) => {
  const role = String(profile?.role || '').toLowerCase();
  return profile?.is_admin === true || role === 'admin' || role === 'super_admin';
};

const isPathActive = (pathname, activePaths = []) => activePaths.some((path) => (
  pathname === path || pathname.startsWith(`${path}/`)
));

const NavItem = ({ to, activePaths, icon: Icon, label, badge, isDesktop, activeColor, isSpecial }) => {
  const location = useLocation();
  const isActive = isPathActive(location.pathname, activePaths || [String(to).split('?')[0]]);

  return (
    <NavLink to={to} className={cn(
      "flex flex-col items-center justify-center min-w-[44px] min-h-[44px]",
      "transition-all duration-300 relative group",
      isDesktop ? "px-2 lg:min-w-[76px]" : "px-1.5",
      isActive ? activeColor : 'text-slate-400 hover:text-slate-600',
    )}>
      <div className={cn(
        "relative p-2.5 lg:p-3 rounded-xl lg:rounded-2xl transition-all duration-300 shadow-sm",
        isActive
          ? "bg-slate-900 border-b-2 border-primary shadow-xl shadow-primary/20 scale-105 -translate-y-1 lg:-translate-y-2"
          : (isSpecial && badge > 0)
            ? "bg-emerald-500 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)]"
            : "bg-white border border-slate-100 hover:bg-slate-50"
      )}>
        <Icon className={cn(
          "h-4 w-4 lg:h-5 lg:w-5 transition-transform duration-300",
          isActive || (isSpecial && badge > 0) ? "text-white" : "text-slate-400 group-hover:scale-110"
        )} />
        {badge > 0 && (
          <span className={cn(
            "absolute -top-1 -right-1 w-3.5 h-3.5 lg:w-4 lg:h-4 text-white text-[7px] lg:text-[8px] font-black flex items-center justify-center rounded-full border-2 border-white shadow-lg",
            isSpecial ? "bg-red-500" : "bg-primary"
          )}>
            {badge}
          </span>
        )}
      </div>
      <span className={cn(
        "text-[7px] lg:text-[8px] font-black tracking-[0.08em] uppercase mt-1.5 lg:mt-2 text-center w-full truncate",
        isActive ? activeColor : (isSpecial && badge > 0) ? "text-emerald-600" : "text-slate-500"
      )}>
        {label}
      </span>
    </NavLink>
  );
};

const MainLayout = (props) => {
  const isDirectlyCalled = props && (props.user || props.profile);
  const outletContextFromHook = isDirectlyCalled ? null : useOutletContext();
  const context = isDirectlyCalled ? props : outletContextFromHook;

  if (!context) {
    return null;
  }

  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const { t } = useTranslation();

  const playSound = (type) => {
    try {
      const audio = new Audio(AUDIO_ASSETS[type]);
      audio.volume = 0.4;
      audio.play().catch(() => console.warn("Audio play blocked by browser policy"));

      if (type === 'sos') {
        Haptics.vibrate({ duration: 1000 });
      } else {
        Haptics.impact({ style: ImpactStyle.Medium });
      }
    } catch (e) { console.error("Audio/Haptic init error", e); }
  };

  useEffect(() => {
    if (!context?.user?.id) return;

    const fetchUnread = async () => {
      const { count: nCounter } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', context.user.id)
        .eq('is_read', false);
      setUnreadCount(nCounter || 0);

      const { count: cCounter } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .neq('sender_id', context.user.id)
        .eq('read', false);

      setUnreadChats(cCounter || 0);
    };
    fetchUnread();

    const notificationChannel = supabase
      .channel(`global_notifications:${context.user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${context.user.id}`
      }, (payload) => {
        const notif = payload.new?.payload || payload.new;
        setUnreadCount(prev => prev + 1);

        if (notif.type === 'booking' || notif.type === 'ride_request') playSound('booking');
        else if (notif.type === 'payment') playSound('arrival');
        else if (notif.type === 'emergency_alert') playSound('sos');
        else playSound('welcome');

        toast(notif.title, { description: notif.message || notif.content || notif.body });
      })
      .subscribe();

    const chatChannel = supabase
      .channel(`global_chats:${context.user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages'
      }, (payload) => {
        if (payload.new.sender_id !== context.user.id) {
          if (!location.pathname.includes(payload.new.chat_id)) {
            setUnreadChats(prev => prev + 1);
            playSound('chat');
          }
        }
      })
      .subscribe();

    return () => {
      if (notificationChannel) supabase.removeChannel(notificationChannel);
      if (chatChannel) supabase.removeChannel(chatChannel);
    };
  }, [context?.user?.id, location.pathname, navigate]);

  useEffect(() => {
    if (location.pathname === '/chats' || location.pathname.includes('/chat/')) {
      setUnreadChats(0);
    }
  }, [location.pathname]);

  if (!context || (context.isLoading && !context.profile)) return null;

  const { profile } = context;
  const isAdmin = context.isAdmin || hasAdminAccess(profile);

  const navItems = [
    { to: '/dashboard', activePaths: ['/dashboard', '/'], icon: LayoutDashboard, label: t('nav.explore'), color: 'text-primary' },
    { to: '/my-rides?tab=active', activePaths: ['/my-rides', '/ride', '/leave-review'], icon: Car, label: t('nav.my_rides'), color: 'text-emerald-600' },
    { to: '/calendar', activePaths: ['/calendar'], icon: CalendarDays, label: 'Agenda', color: 'text-blue-600' },
    { to: '/my-requests?tab=active', activePaths: ['/my-requests', '/request'], icon: CheckCircle2, label: t('dashboard.filter_requests'), color: 'text-orange-600' },
    {
      to: '/chats',
      activePaths: ['/chats', '/chat', '/rides'],
      icon: MessageSquare,
      label: t('nav.chat'),
      badge: unreadChats,
      color: 'text-emerald-500',
      isSpecial: true
    },
    { to: '/wallet', activePaths: ['/wallet'], icon: Wallet, label: t('nav.wallet'), color: 'text-amber-500' },
    { to: '/settings', activePaths: ['/settings', '/profile/edit', '/verification-center', '/achievements', '/disputes'], icon: SettingsIcon, label: t('nav.settings'), color: 'text-indigo-600' },
  ];

  const isDashboard = location.pathname === '/dashboard' || location.pathname === '/';

  return (
    <div className="h-screen w-screen bg-slate-50 flex flex-col overflow-hidden relative font-sans text-left">
      <header className="fixed top-0 left-0 right-0 h-14 lg:h-16 bg-white/80 backdrop-blur-xl border-b border-slate-100 z-[100] px-4 lg:px-6 flex items-center justify-between">
        <div className="flex items-center gap-2 lg:gap-3 cursor-pointer group" onClick={() => navigate('/dashboard')}>
          <div className="size-8 lg:size-9 bg-slate-900 rounded-lg flex items-center justify-center shadow-lg group-hover:rotate-6 transition-transform">
            <Sparkles className="text-primary h-3.5 w-3.5 lg:h-4 lg:w-4" />
          </div>
          <h1 className="text-base lg:text-lg font-black tracking-tighter text-slate-900 italic uppercase">SHAREWAY</h1>
        </div>

        <div className="hidden lg:flex items-center gap-2">
          {isAdmin && <Button onClick={() => navigate('/admin/verifications')} className="h-10 rounded-2xl bg-indigo-600 px-4 text-[10px] font-black uppercase tracking-widest text-white gap-2"><ShieldCheck size={14} />Admin</Button>}
          <Button onClick={() => navigate('/calendar')} variant="outline" className="h-10 rounded-2xl px-4 text-[10px] font-black uppercase tracking-widest gap-2"><CalendarDays size={14} />Agenda</Button>
          <Button onClick={() => navigate('/publish')} className="h-10 rounded-2xl bg-slate-900 px-4 text-[10px] font-black uppercase tracking-widest text-white gap-2"><Plus size={14} className="text-primary" />{t('create_ride.title')}</Button>
          <Button onClick={() => navigate('/request')} className="h-10 rounded-2xl bg-orange-500 px-4 text-[10px] font-black uppercase tracking-widest text-white gap-2"><Megaphone size={14} />{t('create_request.title')}</Button>
          <Button onClick={() => navigate('/my-rides?tab=active')} variant="outline" className="h-10 rounded-2xl px-4 text-[10px] font-black uppercase tracking-widest gap-2"><Car size={14} />{t('nav.my_rides')}</Button>
          <Button onClick={() => navigate('/my-requests?tab=active')} variant="outline" className="h-10 rounded-2xl px-4 text-[10px] font-black uppercase tracking-widest gap-2"><CheckCircle2 size={14} />{t('dashboard.filter_requests')}</Button>
        </div>

        <div className="flex items-center gap-2 lg:gap-3">
          {isAdmin && <Button onClick={() => navigate('/admin/verifications')} size="icon" className="size-9 lg:size-11 rounded-xl lg:rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm" title="Panel admin"><ShieldCheck className="h-4 w-4 lg:h-5 lg:w-5" /></Button>}
          <NotificationCenterPanel user={context.user}>
            <div className="size-9 lg:size-11 bg-white border border-slate-100 rounded-xl lg:rounded-2xl shadow-sm flex items-center justify-center cursor-pointer hover:bg-slate-50 hover:scale-105 active:scale-95 transition-all group relative">
              <Bell className="h-4 w-4 lg:h-5 lg:w-5 text-slate-600 group-hover:text-primary transition-colors" />
            </div>
          </NotificationCenterPanel>

          <LanguageSwitcher />

          <div className="relative group cursor-pointer" onClick={() => navigate('/settings')}>
            <Avatar className="h-8 w-8 lg:h-9 lg:w-9 border-2 border-white shadow-md">
              <AvatarImage src={profile?.photo_url || profile?.avatar_url} />
              <AvatarFallback className="bg-slate-100 text-slate-400 font-bold text-xs">{profile?.display_name?.[0]}</AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1 bg-white border border-slate-100 rounded-full px-1 py-0.5 shadow-sm flex items-center gap-0.5 scale-90 lg:scale-100">
              <Star className="h-2 w-2 lg:h-2.5 lg:w-2.5 fill-amber-400 text-amber-400" />
              <span className="text-[7px] lg:text-[8px] font-black text-slate-900 leading-none">
                {profile?.rating ? parseFloat(profile.rating).toFixed(1) : '5.0'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className={cn(
        "flex-1 relative",
        isDashboard ? "overflow-hidden" : "pt-14 lg:pt-16 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-32 overflow-y-auto overflow-x-hidden custom-scrollbar"
      )}>
        <div className={cn("mx-auto h-full", !isDashboard && "max-w-7xl")}>
          <Outlet context={{ ...context, unreadNotifications: unreadCount }} />
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-[1000] w-full bg-white/95 backdrop-blur-3xl border-t border-slate-100 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-xl mx-auto px-3 py-2 flex items-center justify-between gap-0.5 relative h-20">
          <div className="absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-30" />

          {navItems.map(item => (
            <NavItem key={item.to} {...item} isDesktop={window.innerWidth >= 1024} activeColor={item.color} />
          ))}
        </div>
      </nav>
    </div>
  );
};

export default MainLayout;