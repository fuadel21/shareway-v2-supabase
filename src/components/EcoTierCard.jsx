import React from 'react';
import { Leaf, Sprout, Trees, Mountain, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

const TIERS = {
    'Seed': {
        label: 'Semilla',
        min: 0,
        max: 100,
        icon: Leaf,
        color: 'text-slate-500',
        bg: 'bg-slate-100',
        barColor: 'bg-slate-400',
        description: 'Iniciando el viaje sostenible'
    },
    'Sapling': {
        label: 'Brote',
        min: 100,
        max: 500,
        icon: Sprout,
        color: 'text-lime-600',
        bg: 'bg-lime-50',
        barColor: 'bg-lime-500',
        description: 'Compromiso creciente'
    },
    'Tree': {
        label: 'Árbol',
        min: 500,
        max: 1000,
        icon: Trees,
        color: 'text-green-600',
        bg: 'bg-green-50',
        barColor: 'bg-green-500',
        description: 'Impacto sólido'
    },
    'Forest': {
        label: 'Bosque',
        min: 1000,
        max: 10000, // Cap alto
        icon: Mountain,
        color: 'text-emerald-700',
        bg: 'bg-emerald-50',
        barColor: 'bg-emerald-600',
        description: 'Guardián del Planeta'
    }
};

const EcoTierCard = ({ tier = 'Seed', co2Saved = 0 }) => {
    const currentTier = TIERS[tier] || TIERS['Seed'];
    
    // Calcular progreso
    const range = currentTier.max - currentTier.min;
    const current = Math.min(Math.max(co2Saved - currentTier.min, 0), range);
    const percentage = tier === 'Forest' ? 100 : (current / range) * 100;
    
    const nextTierKey = Object.keys(TIERS).find(key => TIERS[key].min === currentTier.max);
    const nextTier = nextTierKey ? TIERS[nextTierKey] : null;

    const Icon = currentTier.icon;

    return (
        <div className={cn("rounded-3xl p-6 relative overflow-hidden transition-all hover:shadow-md border border-slate-100", currentTier.bg)}>
            {/* Background Pattern */}
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                <Icon size={120} className={currentTier.color} />
            </div>

            <div className="relative z-10">
                <div className="flex items-center gap-4 mb-4">
                    <div className={cn("p-3 rounded-2xl bg-white shadow-sm", currentTier.color)}>
                        <Icon className="h-8 w-8" />
                    </div>
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Nivel Actual</p>
                        <h3 className={cn("text-2xl font-black uppercase italic tracking-tighter leading-none", currentTier.color)}>
                            {currentTier.label}
                        </h3>
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between items-end text-xs font-medium">
                        <span className="text-slate-600">{parseFloat(co2Saved).toFixed(1)} kg ahorrados</span>
                        {nextTier && (
                            <span className="text-slate-400 text-[10px] uppercase tracking-wider">
                                Próximo: {nextTier.label} ({currentTier.max}kg)
                            </span>
                        )}
                    </div>
                    
                    <div className="h-3 w-full bg-white/60 rounded-full overflow-hidden border border-white/50 backdrop-blur-sm">
                        <div 
                            className={cn("h-full rounded-full transition-all duration-1000 ease-out", currentTier.barColor)} 
                            style={{ width: `${percentage}%` }}
                        />
                    </div>

                    <p className="text-[10px] text-slate-500 font-medium mt-2 italic flex items-center gap-1.5">
                        {tier === 'Forest' ? (
                            <span className="text-emerald-600 font-bold">¡Nivel Máximo Alcanzado!</span>
                        ) : (
                            <>
                                <Lock className="h-3 w-3" />
                                Falta {(currentTier.max - co2Saved).toFixed(1)} kg para subir de nivel
                            </>
                        )}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default EcoTierCard;
