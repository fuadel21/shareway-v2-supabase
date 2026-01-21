import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useOutletContext, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  MessageSquare, Car, Wallet, Settings as SettingsIcon,
  LogOut, Bell, Sparkles, Star, CheckCircle2, LayoutDashboard
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button.jsx';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

// FASE 17: Audio Singleton para evitar NS_BINDING_ABORTED
const AUDIO_ASSETS = {
    booking: 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3',
    welcome: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
    review: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3',
    arrival: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3'
};

const NavItem = ({ to, icon: Icon, label, badge, isDesktop, activeColor }) => {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <NavLink to={to} className={cn(
      "flex flex-col items-center justify-center transition-all duration-500 relative group",
      isDesktop ? "min-w-[84px]" : "px-4",
      isActive ? activeColor : 'text-slate-400 hover:text-slate-600',
    )}>
      <div className={cn(
        "relative p-3 rounded-2xl transition-all duration-500 shadow-sm",
        isActive 
          ? "bg-slate-900 border-b-2 border-primary shadow-xl shadow-primary/20 scale-110 -translate-y-2" 
          : "bg-white border border-slate-100 hover:bg-slate-50"
      )}>
        <Icon className={cn(
          "h-5 w-5 transition-transform duration-500", 
          isActive ? "text-white" : "text-slate-400 group-hover:scale-110"
        )} />
        {badge > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-white text-[8px] font-black flex items-center justify-center rounded-full border-2 border-white shadow-lg">
            {badge}
          </span>
        )}
      </div>
      <span className={cn(
        "text-[8px] font-black tracking-[0.1em] uppercase mt-2 text-center w-full",
        isActive ? activeColor : "text-slate-500"
      )}>
        {label}
      </span>
    </NavLink>
  );
};

const MainLayout = (props) => {
  const outletContext = useOutletContext();
  const context = (props && props.user) ? props : outletContext;
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  
  // FASE 17: Inicialización segura de audio
  const playSound = (type) => {
      try {
          const audio = new Audio(AUDIO_ASSETS[type]);
          audio.volume = 0.4;
          audio.play().catch(e => console.warn("Audio play blocked by browser policy"));
      } catch (e) { console.error("Audio init error", e); }
  };

  useEffect(() => {
    if (!context?.user?.id) return;

    const fetchUnread = async () => {
        const { count } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', context.user.id)
            .eq('read', false);
        setUnreadCount(count || 0);
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
            const notif = payload.new.payload || payload.new;
            setUnreadCount(prev => prev + 1);

            if (notif.type === 'booking') {
                playSound('booking');
                toast.success(notif.title, {
                    description: notif.content,
                    action: { label: 'Ver Viaje', onClick: () => navigate(`/ride/${notif.data?.ride_id}`) }
                });
            } else if (notif.type === 'review_prompt') {
                playSound('review');
                toast(notif.title, {
                    description: notif.content,
                    icon: <Star className="text-amber-500 fill-amber-500 animate-bounce" />,
                    action: { label: 'Valorar', onClick: () => navigate(`/leave-review/${notif.data?.ride_id}/${notif.data?.driver_id}`) }
                });
            } else {
                toast(notif.title || 'Nueva notificación', { description: notif.content || notif.message });
            }
        })
        .subscribe();

    return () => {
        supabase.removeChannel(notificationChannel);
    };
  }, [context?.user?.id, navigate]);

  if (!context || (context.isLoading && !context.profile)) return null;

  const { profile, handleSignOut } = context;

  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Explorar', color: 'text-primary' },
    { to: '/my-rides', icon: Car, label: 'Viajes', color: 'text-emerald-600' },
    { to: '/chats', icon: MessageSquare, label: 'Chat', badge: context.totalUnreadChats, color: 'text-blue-600' },
    { to: '/wallet', icon: Wallet, label: 'Cartera', color: 'text-amber-500' },
    { to: '/settings', icon: SettingsIcon, label: 'Ajustes', color: 'text-indigo-600' },
  ];

  const isDashboard = location.pathname === '/dashboard' || location.pathname === '/';

  return (
    <div className="h-screen w-screen bg-slate-50 flex flex-col overflow-hidden relative font-sans text-left">
      <header className="fixed top-0 left-0 right-0 h-16 bg-white/80 backdrop-blur-xl border-b border-slate-100 z-[100] px-6 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => navigate('/dashboard')}>
              <div className="size-9 bg-slate-900 rounded-lg flex items-center justify-center shadow-lg group-hover:rotate-6 transition-transform">
                  <Sparkles className="text-primary h-4 w-4" />
              </div>
              <h1 className="text-lg font-black tracking-tighter text-slate-900 italic uppercase">SHAREWAY</h1>
          </div>

          <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="rounded-full relative size-9">
                  <Bell size={18} className="text-slate-600" />
                  {unreadCount > 0 && <span className="absolute top-2 right-2 size-2 bg-primary rounded-full border-2 border-white animate-pulse" />}
              </Button>
              <Avatar className="h-9 w-9 border-2 border-white shadow-md cursor-pointer" onClick={() => navigate('/settings')}>
                  <AvatarImage src={profile?.photo_url || profile?.avatar_url} />
                  <AvatarFallback className="bg-slate-100 text-slate-400 font-bold">{profile?.display_name?.[0]}</AvatarFallback>
              </Avatar>
          </div>
      </header>

      <main className={cn("flex-1 relative pt-16", isDashboard ? "overflow-hidden" : "overflow-y-auto")}>
          <Outlet context={{ ...context, unreadNotifications: unreadCount }} />
      </main>

      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1000] animate-in slide-in-from-bottom-10 duration-700 w-full max-w-fit px-4">
          <div className="bg-white/95 backdrop-blur-3xl px-6 py-3 rounded-[2.5rem] border border-slate-100 shadow-[0_25px_60px_rgba(0,0,0,0.18)] flex items-end gap-1 relative">
              <div className="absolute inset-x-12 -top-px h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-30" />
              {navItems.map(item => <NavItem key={item.to} {...item} isDesktop={true} activeColor={item.color} />)}
              <div className="w-px h-8 bg-slate-100 mx-3 mb-5" />
              <button onClick={handleSignOut} className="flex flex-col items-center justify-center px-4 mb-3 group transition-all">
                  <div className="p-2.5 rounded-xl bg-white border border-slate-100 group-hover:bg-red-50 text-slate-400 group-hover:text-red-500 shadow-sm"><LogOut size={20} /></div>
                  <span className="text-[7px] font-black uppercase tracking-widest mt-2 text-slate-400 group-hover:text-red-600">Salir</span>
              </button>
          </div>
      </nav>
    </div>
  );
};

export default MainLayout;
