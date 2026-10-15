import React, { useState, useEffect } from 'react';
import {
    Shield,
    Clock,
    FileAudio,
    MapPin,
    AlertCircle,
    CheckCircle2,
    Lock,
    ExternalLink,
    Search,
    ChevronRight,
    Loader2
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const SafetyHistory = () => {
    const [evidences, setEvidences] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');

    useEffect(() => {
        fetchSafetyHistory();
    }, []);

    const fetchSafetyHistory = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase.rpc('get_my_safety_history');
            if (error) throw error;
            setEvidences(data || []);
        } catch (error) {
            console.error('Error fetching safety history:', error);
        } finally {
            setLoading(false);
        }
    };

    const getEvidenceIcon = (type) => {
        switch (type) {
            case 'audio_recording': return <FileAudio className="size-5 text-indigo-500" />;
            case 'sos_alert': return <AlertCircle className="size-5 text-red-500" />;
            default: return <Shield className="size-5 text-slate-500" />;
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'sealed':
                return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100 uppercase text-[9px] font-black">Sellado / Protegido</Badge>;
            case 'opened':
                return <Badge className="bg-amber-50 text-amber-700 border-amber-100 uppercase text-[9px] font-black">Bajo Revisión</Badge>;
            default:
                return <Badge className="bg-slate-50 text-slate-700 border-slate-100 uppercase text-[9px] font-black">{status}</Badge>;
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="size-8 text-indigo-600 animate-spin mb-4" />
                <p className="text-xs font-black uppercase tracking-tighter text-slate-400">Accediendo a la Bóveda...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-1">
                <h2 className="text-xl font-black uppercase italic tracking-tighter text-slate-900 flex items-center gap-2">
                    <Shield className="size-6 text-indigo-600" /> Historial de Seguridad
                </h2>
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Registros inmutables de tu Caja Negra</p>
            </div>

            <div className="grid gap-4">
                {evidences.length === 0 ? (
                    <Card className="p-10 border-2 border-dashed border-slate-100 flex flex-col items-center text-center bg-slate-50/30 rounded-3xl">
                        <Lock className="size-10 text-slate-200 mb-4" />
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                            No hay evidencias registradas en tu bóveda.<br/>Tus viajes están protegidos por el protocolo SOS.
                        </p>
                    </Card>
                ) : (
                    evidences.map((item) => (
                        <Card key={item.id} className="p-5 border-2 border-slate-50 hover:border-indigo-100 transition-all rounded-3xl bg-white group shadow-sm hover:shadow-md">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-indigo-50 transition-colors">
                                        {getEvidenceIcon(item.evidence_type)}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-[11px] font-black uppercase text-slate-900">
                                                {item.evidence_type === 'audio_recording' ? 'Grabación Preventiva' : 'Alerta SOS'}
                                            </span>
                                            {getStatusBadge(item.status)}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                            <Clock className="size-3" />
                                            {format(new Date(item.created_at), "d MMM, yyyy · HH:mm", { locale: es })}
                                        </div>
                                    </div>
                                </div>
                                <Button variant="ghost" size="icon" className="rounded-xl">
                                    <ChevronRight className="size-5 text-slate-300" />
                                </Button>
                            </div>

                            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-50 flex flex-col gap-2">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-600">
                                    <MapPin className="size-3 text-indigo-500" />
                                    <span>{item.origin_name || 'Ubicación Desconocida'}</span>
                                    <span className="text-slate-300">→</span>
                                    <span>{item.destination_name || 'Destino'}</span>
                                </div>

                                {item.metadata?.duration && (
                                    <div className="flex items-center gap-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                                        <FileAudio className="size-3" />
                                        Duración: {Math.floor(item.metadata.duration / 60)}m {item.metadata.duration % 60}s
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 flex items-center justify-between gap-3">
                                <p className="text-[9px] font-medium text-slate-400 leading-tight italic max-w-[70%]">
                                    Esta evidencia se almacena en una bóveda privada. Solo el equipo autorizado puede revisarla cuando existe un reporte oficial.
                                </p>
                                <Lock className="size-4 text-slate-300" />
                            </div>
                        </Card>
                    ))
                )}
            </div>

            <Card className="p-4 bg-indigo-900 border-none rounded-2xl shadow-xl shadow-indigo-100 flex items-center gap-4">
                <div className="p-2 bg-white/10 rounded-xl">
                    <CheckCircle2 className="size-5 text-indigo-200" />
                </div>
                <div>
                    <p className="text-[10px] font-black uppercase text-indigo-100 tracking-widest mb-0.5">Privacidad Blindada</p>
                    <p className="text-[9px] font-medium text-indigo-200/70 uppercase tracking-wider">
                        Tus grabaciones se eliminan automáticamente después de 30 días si no hay reportes activos.
                    </p>
                </div>
            </Card>
        </div>
    );
};

export default SafetyHistory;
