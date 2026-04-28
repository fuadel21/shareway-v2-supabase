import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
    AlertCircle,
    Clock,
    CheckCircle2,
    XCircle,
    ChevronLeft,
    Loader2,
    FileText,
    MessageSquare,
    ExternalLink,
    ShieldCheck,
    History as LucideHistory
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import SubPageHeader from './SubPageHeader';

const DisputeHistory = () => {
    const [disputes, setDisputes] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchDisputes = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;

                const { data, error } = await supabase
                    .from('cancellation_disputes')
                    .select('*, ride:rides(origin, destination, departure_time)')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false });

                if (error) throw error;
                setDisputes(data || []);
            } catch (error) {
                console.error("Error fetching disputes:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchDisputes();
    }, []);

    const getStatusTheme = (status) => {
        switch (status) {
            case 'approved':
                return {
                    label: 'APROBADA',
                    icon: CheckCircle2,
                    color: 'text-emerald-600',
                    bg: 'bg-emerald-50 border-emerald-100'
                };
            case 'rejected':
                return {
                    label: 'RECHAZADA',
                    icon: XCircle,
                    color: 'text-red-600',
                    bg: 'bg-red-50 border-red-100'
                };
            default:
                return {
                    label: 'EN REVISIÓN',
                    icon: Clock,
                    color: 'text-amber-600',
                    bg: 'bg-amber-50 border-amber-100'
                };
        }
    };

    if (loading) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Consultando Archivos...</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-50 min-h-screen pb-40 font-sans">
            <SubPageHeader title="Mis Disputas" />

            <main className="max-w-xl mx-auto px-4 py-6 space-y-6">
                <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex items-center gap-4">
                    <div className="size-12 bg-amber-50 rounded-2xl flex items-center justify-center border border-amber-100">
                        <AlertCircle className="text-amber-500 size-6" />
                    </div>
                    <div>
                        <h2 className="text-lg font-black italic uppercase tracking-tighter leading-none">Centro de Apelaciones</h2>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Revisión de casos de fuerza mayor</p>
                    </div>
                </div>

                <div className="space-y-4">
                    {disputes.length > 0 ? (
                        disputes.map((dispute) => {
                            const theme = getStatusTheme(dispute.status);
                            const StatusIcon = theme.icon;

                            return (
                                <Card key={dispute.id} className="rounded-[2.5rem] border-none shadow-xl bg-white overflow-hidden group">
                                    {dispute.safety_evidence_id && (
                                        <div className="bg-amber-500 py-1.5 px-6 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <ShieldCheck size={12} className="text-white" />
                                                <span className="text-[9px] font-black text-white uppercase tracking-[0.1em]">Evidencia SOS Protegida</span>
                                            </div>
                                            <div className="flex gap-1">
                                                <div className="size-1 bg-white/40 rounded-full animate-pulse" />
                                                <div className="size-1 bg-white/40 rounded-full animate-pulse delay-75" />
                                                <div className="size-1 bg-white/40 rounded-full animate-pulse delay-150" />
                                            </div>
                                        </div>
                                    )}
                                    <CardContent className="p-6 space-y-4">
                                        <div className="flex justify-between items-start">
                                            <div className={cn("px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5 border", theme.bg, theme.color)}>
                                                <StatusIcon size={10} />
                                                {theme.label}
                                            </div>
                                            <span className="text-[9px] font-bold text-slate-300 uppercase">
                                                ID: {dispute.id.substring(0, 8)}
                                            </span>
                                        </div>

                                        <div className="space-y-2">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Motivo de la disputa</p>
                                            <p className="text-sm font-medium text-slate-700 leading-relaxed italic">
                                                "{dispute.reason}"
                                            </p>
                                        </div>

                                        {dispute.admin_notes && (
                                            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex gap-3 items-start">
                                                <MessageSquare size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                                <div>
                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Nota del Administrador</p>
                                                    <p className="text-[11px] font-bold text-slate-600 italic leading-snug">
                                                        {dispute.admin_notes}
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        <div className="pt-4 border-t border-slate-50 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="size-8 bg-slate-100 rounded-xl flex items-center justify-center">
                                                    <FileText size={14} className="text-slate-400" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-black text-slate-900 uppercase italic leading-none">
                                                        {format(new Date(dispute.created_at), "d 'de' MMMM", { locale: es })}
                                                    </span>
                                                    <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5">Fecha de solicitud</span>
                                                </div>
                                            </div>

                                            {dispute.evidence_urls && dispute.evidence_urls.length > 0 && (
                                                <div className="flex gap-1">
                                                    {dispute.evidence_urls.map((url, i) => (
                                                        <a key={i} href={url} target="_blank" rel="noreferrer" className="size-8 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center hover:bg-indigo-100 transition-colors">
                                                            <ExternalLink size={12} />
                                                        </a>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })
                    ) : (
                        <div className="text-center py-20 bg-white rounded-[3rem] border border-dashed border-slate-200">
                            <LucideHistory className="size-12 text-slate-100 mx-auto mb-4" />
                            <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] italic">No tienes reclamaciones activas</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default DisputeHistory;
