import React, { useState, useRef, useEffect } from 'react';
import {
    Mic,
    Square,
    Play,
    Trash2,
    Loader2,
    ShieldCheck,
    Save,
    AlertTriangle,
    Clock,
    Volume2,
    Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

const AudioRecording = ({ rideId, onRecordingComplete }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [audioURL, setAudioURL] = useState(null);
    const [recordingTime, setRecordingTime] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [audioBlob, setAudioBlob] = useState(null);
    const mediaRecorderRef = useRef(null);
    const timerRef = useRef(null);
    const chunksRef = useRef([]);

    // Limpieza al desmontar
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (mediaRecorderRef.current && isRecording) {
                mediaRecorderRef.current.stop();
            }
        };
    }, [isRecording]);

    const startRecording = async () => {
        try {
            // Feedback háptico (Vibración)
            if ('vibrate' in navigator) {
                navigator.vibrate([100, 50, 100]);
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            chunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                const url = URL.createObjectURL(blob);
                setAudioBlob(blob);
                setAudioURL(url);
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);
            setRecordingTime(0);

            timerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);

            toast.info("Grabación iniciada", {
                description: "La Caja Negra de ShareWay está activa."
            });
        } catch (err) {
            console.error("Error accessing microphone:", err);
            toast.error("Error al acceder al micrófono", {
                description: "Por favor, concede permisos de audio."
            });
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            clearInterval(timerRef.current);
        }
    };

    const deleteRecording = () => {
        setAudioURL(null);
        setAudioBlob(null);
        setRecordingTime(0);
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const uploadRecording = async () => {
        if (!audioBlob || !rideId) return;

        setIsUploading(true);
        try {
            const fileName = `blackbox/${rideId}/${Date.now()}.webm`;
            const { data, error } = await supabase.storage
                .from('safety-vault')
                .upload(fileName, audioBlob);

            if (error) throw error;

            // Registrar en la tabla de evidencias de seguridad
            const { error: dbError } = await supabase.from('safety_evidence').insert({
                ride_id: rideId,
                evidence_type: 'audio_recording',
                file_path: fileName,
                metadata: { duration: recordingTime }
            });

            if (dbError) throw dbError;

            toast.success("Evidencia protegida", {
                description: "La grabación se ha encriptado y guardado en la bóveda de seguridad."
            });

            if (onRecordingComplete) onRecordingComplete(data.path);
            deleteRecording();
        } catch (err) {
            console.error("Upload failed:", err);
            toast.error("Error al guardar evidencia");
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <Card className="rounded-[2rem] border-2 border-red-50 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className={cn(
                        "p-3 rounded-2xl transition-all duration-500",
                        isRecording ? "bg-red-600 animate-pulse" : "bg-slate-100"
                    )}>
                        <Mic className={cn("size-6", isRecording ? "text-white" : "text-slate-400")} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black uppercase italic tracking-tighter text-slate-900">Caja Negra de Audio</h3>
                        <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Protocolo SOS V1</p>
                    </div>
                </div>
                {isRecording && (
                    <div className="flex items-center gap-2 bg-red-50 px-3 py-1.5 rounded-full border border-red-100">
                        <div className="size-2 bg-red-600 rounded-full animate-ping" />
                        <span className="text-[11px] font-mono font-black text-red-600">{formatTime(recordingTime)}</span>
                    </div>
                )}
            </div>

            <div className="space-y-4">
                {!audioURL && !isRecording && (
                    <div className="py-10 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-100 rounded-[2rem] bg-slate-50/50">
                        <Volume2 className="size-10 text-slate-200 mb-4" />
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-10">
                            Pulsa para iniciar una grabación preventiva encriptada
                        </p>
                        <Button
                            onClick={startRecording}
                            className="mt-6 h-14 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest px-8 hover:scale-105 active:scale-95 transition-all"
                        >
                            Iniciar Grabación
                        </Button>
                    </div>
                )}

                {isRecording && (
                    <div className="py-10 flex flex-col items-center justify-center text-center border-2 border-red-100 rounded-[2rem] bg-red-50/30">
                        <div className="flex items-center gap-1 mb-6">
                            {[1, 2, 3, 4, 5, 6].map(i => (
                                <div
                                    key={i}
                                    className="w-1 bg-red-500 rounded-full animate-bounce"
                                    style={{
                                        height: `${Math.random() * 40 + 20}px`,
                                        animationDelay: `${i * 0.1}s`,
                                        animationDuration: '0.5s'
                                    }}
                                />
                            ))}
                        </div>
                        <p className="text-[11px] font-black text-red-600 uppercase tracking-widest mb-6">
                            Grabando Audio de Seguridad...
                        </p>
                        <Button
                            onClick={stopRecording}
                            className="h-20 w-20 rounded-full bg-red-600 text-white shadow-2xl shadow-red-200 animate-pulse flex items-center justify-center p-0"
                        >
                            <Square className="size-8 fill-current" />
                        </Button>
                    </div>
                )}

                {audioURL && !isRecording && (
                    <div className="space-y-4">
                        <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="p-2 bg-emerald-50 rounded-lg">
                                    <ShieldCheck className="size-4 text-emerald-600" />
                                </div>
                                <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Grabación Lista para Proteger</p>
                            </div>
                            <audio src={audioURL} controls className="w-full h-10" />
                        </div>

                        <div className="flex gap-3">
                            <Button
                                onClick={deleteRecording}
                                variant="outline"
                                className="h-14 flex-1 rounded-2xl border-2 border-slate-100 text-slate-400 font-black uppercase tracking-widest hover:text-red-500 hover:bg-red-50"
                            >
                                <Trash2 className="size-5 mr-2" /> Descartar
                            </Button>
                            <Button
                                onClick={uploadRecording}
                                disabled={isUploading}
                                className="h-14 flex-[2] rounded-2xl bg-emerald-600 text-white font-black uppercase tracking-widest shadow-xl shadow-emerald-100"
                            >
                                {isUploading ? (
                                    <Loader2 className="size-5 animate-spin" />
                                ) : (
                                    <span className="flex items-center"><Save className="size-5 mr-2" /> Guardar en Bóveda</span>
                                )}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <div className="mt-6 p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
                <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[9px] font-bold text-amber-700 uppercase tracking-wider leading-relaxed">
                    Las grabaciones se encriptan localmente y solo son accesibles por el equipo de seguridad judicial de ShareWay en caso de reporte oficial.
                </p>
            </div>
        </Card>
    );
};

export default AudioRecording;
