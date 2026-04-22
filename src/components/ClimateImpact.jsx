
import React, { useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Card } from './ui/card.jsx';
import { Button } from './ui/button.jsx';
import { 
    Leaf, Trees, Zap, TrendingUp, Award, Share2, Globe
} from 'lucide-react';
import SubPageHeader from './SubPageHeader.jsx';
import { getImpactEquivalency } from '../utils/climateImpact.js';
import { cn } from '../lib/utils.js';

const StatCard = ({ icon: Icon, label, value, unit, color }) => (
    <Card className="p-6 rounded-[2rem] border-none shadow-xl bg-white flex flex-col items-center text-center gap-2 overflow-hidden relative group">
        <div className={cn("size-12 rounded-2xl flex items-center justify-center mb-2 shadow-lg transition-transform group-hover:scale-110", color)}>
            <Icon size={24} className="text-white" />
        </div>
        <div className="space-y-0.5">
            <p className="text-3xl font-black text-slate-900 tracking-tighter italic leading-none">{value}</p>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label} ({unit})</p>
        </div>
    </Card>
);

const ClimateImpact = () => {
    const { profile } = useOutletContext();

    const co2Saved = parseFloat(profile?.total_co2_saved) || 0;
    const impact = useMemo(() => getImpactEquivalency(co2Saved), [co2Saved]);

    // Equivalencias divertidas
    const equivalencies = [
        { icon: Trees, label: 'Árboles salvados', value: (co2Saved / 22).toFixed(1), color: 'bg-emerald-500' },
        { icon: Zap, label: 'Cargas de móvil', value: (co2Saved * 122).toFixed(0), color: 'bg-amber-500' },
        { icon: Globe, label: 'Km no emitidos', value: (co2Saved / 0.12).toFixed(0), color: 'bg-blue-500' }
    ];

    return (
        <div className="min-h-screen bg-slate-50/50 pb-32">
            <SubPageHeader title="Mi Impacto" backPath="/settings" />

            <main className="max-w-xl mx-auto px-4 mt-6 space-y-8 animate-in fade-in duration-700">
                {/* Hero Section */}
                <section className="bg-slate-900 rounded-[3rem] p-10 text-white shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:rotate-12 transition-transform duration-1000">
                        <Leaf size={180} />
                    </div>
                    <div className="relative z-10 space-y-4">
                        <div className="size-12 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg animate-pulse">
                            <TrendingUp size={24} className="text-white" />
                        </div>
                        <div className="space-y-1">
                            <h2 className="text-5xl font-black italic tracking-tighter leading-none">
                                {co2Saved.toFixed(1)} <span className="text-emerald-400">KG</span>
                            </h2>
                            <p className="text-xs font-black uppercase tracking-[0.3em] text-white/50">CO₂ Ahorrado Total</p>
                        </div>
                        <p className="text-xs font-medium text-white/60 leading-relaxed italic pr-12">
                            "Cada kilómetro compartido es un suspiro de alivio para el planeta. Gracias por ser parte del cambio."
                        </p>
                    </div>
                </section>

                {/* Grid de Equivalencias */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {equivalencies.map((eq, i) => (
                        <StatCard key={i} {...eq} unit={eq.label.split(' ')[1]} />
                    ))}
                </div>

                {/* Mensaje de Logro */}
                <Card className="p-8 rounded-[2.5rem] border-none shadow-xl bg-white flex items-center gap-6">
                    <div className="size-16 rounded-3xl bg-primary/10 flex items-center justify-center shrink-0">
                        < Award size={32} className="text-primary" />
                    </div>
                    <div className="text-left">
                        <h4 className="font-black text-slate-900 uppercase italic tracking-tighter">Nivel Eco: {profile?.eco_tier || 'Semilla'}</h4>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-tight mt-1">
                            Estás en el top 15% de usuarios más sostenibles de tu zona.
                        </p>
                    </div>
                </Card>

                {/* Call to Action */}
                <Button 
                    className="w-full h-16 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase italic shadow-xl gap-3"
                    onClick={() => {
                        if (navigator.share) {
                            navigator.share({
                                title: 'Mi Impacto en ShareWay',
                                text: `¡He ahorrado ${co2Saved}kg de CO2 viajando con ShareWay! Únete a la movilidad sostenible.`,
                                url: window.location.origin
                            });
                        }
                    }}
                >
                    <Share2 size={20} /> Compartir mi Impacto
                </Button>

                <div className="text-center px-10">
                    <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">
                        Basado en el estándar europeo de 0.12kg de CO₂ ahorrado por cada km compartido por pasajero.
                    </p>
                </div>
            </main>
        </div>
    );
};

export default ClimateImpact;
