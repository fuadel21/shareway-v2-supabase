import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Sparkles, LogOut } from 'lucide-react';
import './admin-mobile-command-center.css';

const AdminLayout = ({ handleSignOut, profile }) => {
    const navigate = useNavigate();

    return (
        <div className="admin-shell min-h-screen w-full flex flex-col bg-slate-50 font-sans">
            <header className="admin-shell__header sticky top-0 z-[100] h-14 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 lg:px-12 flex items-center justify-between">
                <div className="flex items-center gap-3 lg:gap-6 min-w-0">
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Volver al panel principal"
                        className="admin-shell__back rounded-full hover:bg-slate-100 hidden lg:flex"
                        onClick={() => navigate('/dashboard')}
                    >
                        <ChevronLeft className="h-6 w-6 text-slate-400" />
                    </Button>

                    <div
                        className="admin-shell__brand flex items-center gap-3 group cursor-pointer min-w-0"
                        onClick={() => navigate('/admin/verifications')}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') navigate('/admin/verifications');
                        }}
                    >
                        <div className="admin-shell__brand-mark size-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-500 shrink-0">
                            <Sparkles className="text-primary h-5 w-5" />
                        </div>
                        <div className="admin-shell__brand-copy min-w-0">
                            <h2 className="text-xl font-black text-slate-900 italic tracking-tighter leading-none truncate">SHAREWAY</h2>
                            <p className="text-[10px] font-black text-primary uppercase tracking-[0.3em] leading-none mt-1 truncate">Panel Control</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                    <div className="hidden md:flex flex-col items-end mr-2">
                        <span className="text-xs font-black text-slate-900 uppercase italic tracking-tighter">{profile?.display_name || 'Administrador'}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Acceso Root</span>
                    </div>

                    <div className="admin-shell__profile size-10 rounded-full bg-slate-100 border-2 border-white shadow-sm flex items-center justify-center font-black text-slate-400 overflow-hidden">
                        {profile?.photo_url ? (
                            <img src={profile.photo_url} alt="Administrador" className="w-full h-full object-cover" />
                        ) : (
                            profile?.display_name?.[0] || 'A'
                        )}
                    </div>

                    <div className="h-8 w-px bg-slate-100 mx-2 hidden sm:block" />

                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Cerrar sesión"
                        className="text-[10px] font-black uppercase text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all gap-2 px-2 sm:px-3"
                        onClick={handleSignOut}
                    >
                        <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Cerrar Sesión</span>
                    </Button>
                </div>
            </header>

            <main className="admin-shell__main flex-1 w-full flex justify-center overflow-x-hidden lg:overflow-y-auto">
                <div className="admin-shell__content w-full max-w-[1600px] p-6 lg:p-12 animate-in fade-in duration-1000">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
