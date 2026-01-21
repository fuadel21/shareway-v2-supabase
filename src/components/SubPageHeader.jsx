import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

const SubPageHeader = ({ title, actions }) => {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 pt-6 pb-20 px-4 md:px-0">
      {/* Fondo con degradado sutil para integración */}
      <div className="absolute inset-0 bg-transparent pointer-events-none -z-10" />

      <div className="max-w-xl md:max-w-5xl mx-auto flex items-center justify-between relative px-2">
        {/* Botón de Volver Premium */}
        <button
          onClick={() => navigate(-1)}
          className="group h-14 w-14 rounded-3xl bg-white shadow-2xl shadow-slate-200/50 flex items-center justify-center border border-white hover:scale-110 active:scale-90 transition-all duration-300 z-10"
          aria-label="Volver"
        >
          <ChevronLeft size={28} className="text-slate-900 group-hover:-translate-x-1 transition-transform" />
        </button>

        {/* Título - Centrado en Desktop y Mobile */}
        <div className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none">
          <h1 className="text-2xl font-black text-slate-950 tracking-tighter whitespace-nowrap uppercase italic leading-none">
            {title}
          </h1>
          <div className="flex items-center justify-center gap-1 mt-1.5">
            <div className="h-0.5 w-6 bg-primary rounded-full" />
            <Sparkles className="size-2 text-primary animate-pulse" />
            <div className="h-0.5 w-6 bg-primary rounded-full" />
          </div>
        </div>

        {/* Acciones */}
        <div className="h-14 w-14 flex items-center justify-end z-10">
          {actions || (
            <div className="h-14 w-14 rounded-3xl bg-white/20 border border-white/40 backdrop-blur-md shadow-sm flex items-center justify-center opacity-0 pointer-events-none" />
          )}
        </div>
      </div>
    </header>
  );
};

export default SubPageHeader;
