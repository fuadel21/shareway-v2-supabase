import React from 'react';
import { ShieldAlert, RefreshCw, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';

export default function MaintenanceMode() {
    return (
        <div className="h-screen flex flex-col items-center justify-center bg-white p-6 text-center animate-in fade-in duration-700">
            <div className="relative mb-8">
                <div className="size-24 rounded-[2.5rem] bg-red-50 flex items-center justify-center shadow-2xl shadow-red-100 animate-pulse">
                    <ShieldAlert className="h-10 w-10 text-red-500" />
                </div>
                <div className="absolute -top-2 -right-2 size-8 bg-white rounded-2xl shadow-lg flex items-center justify-center border border-slate-100">
                    <RefreshCw className="h-4 w-4 text-slate-400 animate-spin" />
                </div>
            </div>

            <h1 className="text-2xl font-black text-slate-900 uppercase italic tracking-tighter mb-2">
                ShareWay en Mantenimiento
            </h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mb-8 leading-relaxed max-w-xs mx-auto">
                Estamos optimizando el motor de la plataforma para ofrecerte una experiencia Elite.
            </p>

            <div className="w-full max-w-sm space-y-4">
                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 text-left">
                    <p className="text-[10px] font-black text-slate-900 uppercase italic mb-2 tracking-widest">Estado del Sistema</p>
                    <div className="flex items-center gap-3">
                        <div className="size-2 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Base de datos: Operativa</span>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                        <div className="size-2 bg-amber-500 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Interfaz: En actualización</span>
                    </div>
                </div>

                <Button
                    variant="outline"
                    className="w-full h-14 rounded-2xl font-black uppercase italic tracking-widest text-[10px] gap-2"
                    onClick={() => window.location.reload()}
                >
                    <RefreshCw className="h-4 w-4" /> REINTENTAR CONEXIÓN
                </Button>

                <p className="text-[9px] font-medium text-slate-400 uppercase tracking-widest italic pt-4">
                    Volveremos en unos minutos. Gracias por tu paciencia.
                </p>
            </div>
        </div>
    );
}
