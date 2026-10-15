import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Search, Settings2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const PATH_TITLES = {
    '/create-ride': 'Publicar Viaje',
    '/create-request': 'Solicitar Viaje',
    '/profile': 'Mi Perfil',
    '/account': 'Mi Cuenta',
    '/settings': 'Ajustes',
    '/wallet': 'Mi Wallet',
    '/my-rides': 'Mis Viajes',
    '/chats': 'Mensajes',
    '/dashboard': 'Explorar',
};

const getTitle = (pathname) => {
    if (PATH_TITLES[pathname]) return PATH_TITLES[pathname];
    if (pathname.startsWith('/ride/')) return 'Viaje';
    if (pathname.startsWith('/request-details/')) return 'Solicitud';
    if (pathname.startsWith('/chat/')) return 'Chat';
    if (pathname.startsWith('/profile/')) return 'Perfil';
    if (pathname === '/dashboard') return 'ShareWay';
    return '';
};

import NotificationCenter from './NotificationCenter';

const TopHeader = ({ user }) => {
    const location = useLocation();
    const navigate = useNavigate();


    const title = getTitle(location.pathname);
    const isDashboard = location.pathname === '/dashboard';
    const isSubPage = !['/dashboard', '/my-rides', '/chats', '/account'].includes(location.pathname);

    // No mostrar en subpáginas que ya tienen su propio SubPageHeader
    if (isSubPage && title !== 'Mi Cuenta') return null;

    return (
        <header className="fixed top-0 left-0 right-0 z-50 px-6 pt-6 pointer-events-none md:hidden">
            <div className="max-w-xl mx-auto flex items-center justify-between pointer-events-auto">
                <div className="flex items-center gap-4">
                    {isDashboard ? (
                        <div className="size-14 bg-navy rounded-2xl shadow-2xl flex items-center justify-center border border-white/10 relative overflow-hidden group">
                            <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <Sparkles className="h-7 w-7 text-primary relative z-10" />
                        </div>
                    ) : (
                        <button
                            onClick={() => navigate(-1)}
                            className="size-14 bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl flex items-center justify-center border border-white hover:scale-105 active:scale-95 transition-all"
                        >
                            <ArrowLeft className="h-6 w-6 text-slate-900" />
                        </button>
                    )}

                    <div className="bg-white/40 backdrop-blur-md px-6 h-14 rounded-2xl flex items-center border border-white/40 shadow-sm">
                        <h1 className="text-lg font-black tracking-tighter text-slate-900 uppercase italic">
                            {isDashboard ? 'ShareWay' : title}
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <NotificationCenter user={user}>
                        <div className="size-14 bg-white/90 backdrop-blur-xl rounded-[1.6rem] shadow-xl flex items-center justify-center border border-white hover:bg-white transition-all relative group pointer-events-auto">
                            <Bell className="h-6 w-6 text-slate-800 group-hover:text-primary transition-colors" />
                        </div>
                    </NotificationCenter>
                </div>
            </div>
        </header>
    );
};

export default TopHeader;
