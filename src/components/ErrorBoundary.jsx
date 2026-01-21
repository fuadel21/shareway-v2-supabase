import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCcw, Home, ShieldAlert } from 'lucide-react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        // En producción, aquí enviaríamos el error a un servicio de logging (ej: Sentry o Supabase logs)
        console.error("🛡️ Critical UI Crash captured by ErrorBoundary:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            // UI de Fallback Personalizada según el nivel
            if (this.props.level === 'root') {
                return (
                    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center space-y-6">
                        <div className="size-24 bg-red-50 rounded-[2.5rem] flex items-center justify-center border-4 border-white shadow-2xl animate-bounce">
                            <ShieldAlert className="text-red-600 size-12" />
                        </div>
                        <div className="space-y-2 max-w-md">
                            <h1 className="text-3xl font-black italic uppercase tracking-tighter text-slate-900">Protocolo de Seguridad Activo</h1>
                            <p className="text-sm font-medium text-slate-500 leading-relaxed">
                                Hemos detectado una anomalía en el renderizado. Por seguridad, hemos congelado la interfaz para proteger tus datos.
                            </p>
                        </div>
                        <Button 
                            onClick={() => window.location.reload()} 
                            className="h-16 px-10 rounded-2xl bg-slate-900 text-white font-black uppercase italic tracking-widest shadow-xl active:scale-95 transition-all"
                        >
                            <RefreshCcw className="mr-2 h-5 w-5" /> Reiniciar Sistema
                        </Button>
                    </div>
                );
            }

            return (
                <div className="p-8 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-200 text-center space-y-4 my-4 animate-in fade-in">
                    <div className="size-12 bg-amber-50 rounded-xl flex items-center justify-center mx-auto">
                        <AlertCircle className="text-amber-500 size-6" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black uppercase italic text-slate-800">Módulo en Mantenimiento</h3>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Este componente ha fallado temporalmente.</p>
                    </div>
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => this.setState({ hasError: false })}
                        className="rounded-xl font-black text-[9px] uppercase h-10 border-slate-100"
                    >
                        <RefreshCcw className="mr-1.5 h-3.5 w-3.5" /> Reintentar Carga
                    </Button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
