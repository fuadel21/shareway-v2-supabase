import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown } from 'lucide-react';

/**
 * Componente reutilizable para un panel inferior deslizable custom.
 * Reemplaza a react-spring-bottom-sheet por su inestabilidad con react-spring v9 en este entorno.
 * 
 * @param {Object} props - Las propiedades del componente.
 * @param {React.ReactNode} props.children - El contenido que se mostrará dentro del panel.
 */
export function DraggableSheet({ children }) {
    const [snap, setSnap] = useState(0); // 0: Mínimo, 1: Medio, 2: Full
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return null;

    // Alturas basadas en el estado snap (0: Mínimo/Handle, 1: Medio, 2: Full)
    const heights = ['h-[70px]', 'h-[50vh]', 'h-[90vh]'];

    return (
        <div className={cn(
            "fixed inset-x-0 bottom-0 z-[1000] bg-white rounded-t-[2.5rem] shadow-[0_-20px_50px_-12px_rgba(0,0,0,0.15)] transition-all duration-500 ease-out flex flex-col border-t border-slate-100 lg:hidden",
            heights[snap]
        )}>
            {/* DRAG HANDLE / HEADER - Tap to change snap state */}
            <div 
                className="w-full h-12 flex flex-col items-center justify-center cursor-pointer active:bg-slate-50 rounded-t-[2.5rem] transition-colors shrink-0"
                onClick={() => setSnap((prev) => (prev + 1) % 3)}
            >
                <div className="w-12 h-1.5 bg-slate-200 rounded-full mb-1" />
                {snap === 0 && <ChevronUp size={14} className="text-slate-300 animate-bounce mt-1" />}
                {snap === 2 && <ChevronDown size={14} className="text-slate-300 mb-1" />}
            </div>

            {/* CONTENT AREA */}
            <div className="flex-1 overflow-y-auto px-1 pb-16 custom-scrollbar">
                {children}
            </div>
            
            {/* AESTHETIC GRADIENT TOP BLUR */}
            {snap > 0 && (
                <div className="absolute top-12 left-0 right-0 h-4 bg-gradient-to-b from-white to-transparent pointer-events-none z-10" />
            )}
        </div>
    );
}

export default DraggableSheet;
