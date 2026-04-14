import React from 'react';
import { Button } from '@/components/ui/button.jsx';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ELITE ERROR LOG:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
          <div className="max-w-md w-full space-y-8 animate-elite-in">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
              <div className="relative size-24 bg-white rounded-3xl shadow-diamond flex items-center justify-center mx-auto border border-primary/10">
                <AlertTriangle size={48} className="text-primary animate-pulse" />
              </div>
            </div>
            
            <div className="space-y-3">
              <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">Pit Stop Inesperado</h1>
              <p className="text-sm font-bold text-slate-500 leading-relaxed uppercase tracking-tight">
                Algo ha derrapado en la pista, pero nuestro equipo de boxes ya está trabajando en ello.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Button 
                onClick={() => window.location.reload()} 
                variant="outline"
                className="rounded-2xl h-14 font-black uppercase tracking-widest border-2"
              >
                <RefreshCcw className="mr-2 size-4" /> REINTENTAR
              </Button>
              <Button 
                onClick={() => window.location.href = '/'} 
                className="rounded-2xl h-14 font-black uppercase tracking-widest bg-slate-900 shadow-lg"
              >
                <Home className="mr-2 size-4" /> INICIO
              </Button>
            </div>
            
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 opacity-50">SHARWAY V2 - PRODUCTION GRADE RECOVERY</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
