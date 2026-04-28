import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Sparkles, Home, LogOut } from 'lucide-react';

const AdminLayout = ({ handleSignOut, profile }) => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen w-full flex flex-col bg-slate-50 font-sans">
            {/* TOP BAR MINIMALISTA (LOGO & VOLVER) */}
            <header className="sticky top-0 z-[100] h-20 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 lg:px-12 flex items-center justify-between">
                <div className="flex items-center gap-6">
                    {/* Botón Volver */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full hover:bg-slate-100 hidden lg:flex"
                        onClick={() => navigate('/dashboard')}
                    >
                        <ChevronLeft className="h-6 w-6 text-slate-400" />
                    </Button>

                    {/* Logo ShareWay Elite */}
                    <div className="flex items-center gap-3 group cursor-pointer" onClick={() => navigate('/admin/verifications')}>
                        <div className="size-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-500">
                            <Sparkles className="text-primary h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 italic tracking-tighter leading-none">SHAREWAY</h2>
                            <p className="text-[10px] font-black text-primary uppercase tracking-[0.3em] leading-none mt-1">Panel Control</p>
                        </div>
                    </div>
                </div>

                {/* Info de Admin & Acciones Rápidas */}
                <div className="flex items-center gap-4">
                    <div className="hidden md:flex flex-col items-end mr-2">
                        <span className="text-xs font-black text-slate-900 uppercase italic tracking-tighter">{profile?.display_name || 'Administrador'}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Acceso Root</span>
                    </div>

                    <div className="size-10 rounded-full bg-slate-100 border-2 border-white shadow-sm flex items-center justify-center font-black text-slate-400 overflow-hidden">
                        {profile?.photo_url ? (
                            <img src={profile.photo_url} alt="Admin" className="w-full h-full object-cover" />
                        ) : (
                            profile?.display_name?.[0] || 'A'
                        )}
                    </div>

                    <div className="h-8 w-px bg-slate-100 mx-2 hidden sm:block" />

                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-[10px] font-black uppercase text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all gap-2"
                        onClick={handleSignOut}
                    >
                        <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Cerrar Sesión</span>
                    </Button>
                </div>
            </header>

            {/* MAIN CONTENT (FULL WIDTH) */}
            <main className="flex-1 w-full flex justify-center overflow-y-auto overflow-x-hidden">
                <div className="w-full max-w-[1600px] p-6 lg:p-12 animate-in fade-in duration-1000">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
