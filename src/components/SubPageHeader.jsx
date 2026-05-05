import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

const SubPageHeader = ({ title, actions, backTo }) => {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 pt-4 pb-16 px-4 md:px-0">
      <div className="max-w-xl md:max-w-5xl mx-auto flex items-center justify-between relative px-2">
        {/* Botón de Volver Elite */}
        <button
          onClick={() => backTo ? navigate(backTo) : navigate(-1)}
          className="group h-11 w-11 rounded-2xl bg-white/80 backdrop-blur-xl shadow-elite-hover flex items-center justify-center border border-white/40 active:scale-95 transition-all duration-300 z-10"
          aria-label="Volver"
        >
          <ChevronLeft size={22} className="text-slate-900 group-hover:-translate-x-1 transition-transform" />
        </button>

        {/* Título - Centrado Elite */}
        <div className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none">
          <h1 className="text-xl font-black text-slate-900 tracking-tighter whitespace-nowrap uppercase italic leading-none drop-shadow-sm">
            {title}
          </h1>
          <div className="flex items-center justify-center gap-1 mt-1 opacity-100">
            <div className="h-0.5 w-4 bg-primary rounded-full" />
            <div className="h-0.5 w-4 bg-primary rounded-full" />
          </div>
        </div>

        {/* Acciones */}
        <div className="h-11 w-11 flex items-center justify-end z-10">
          {actions || (
            <div className="h-11 w-11 rounded-2xl bg-white/20 border border-white/40 backdrop-blur-md opacity-0 pointer-events-none" />
          )}
        </div>
      </div>
    </header>
  );
};

export default SubPageHeader;
