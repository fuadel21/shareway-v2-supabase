import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info, Leaf, Calculator, ShieldCheck } from 'lucide-react';

const ClimateMethodologyDialog = () => {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button 
                    variant="link" 
                    className="h-auto p-0 text-[10px] text-emerald-600 underline decoration-emerald-300 hover:text-emerald-800"
                >
                    ¿Cómo calculamos esto?
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-emerald-900">
                        <Leaf className="h-5 w-5 text-emerald-600" />
                        Transparencia Climática
                    </DialogTitle>
                    <DialogDescription>
                        Metodología de cálculo de impacto ambiental Shareway v2
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 pt-2">
                    {/* La Fórmula */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <h4 className="font-bold text-slate-800 flex items-center gap-2 mb-3">
                            <Calculator className="h-4 w-4 text-slate-500" />
                            La Fórmula
                        </h4>
                        <div className="text-sm space-y-2 text-slate-600">
                            <p>Calculamos el ahorro comparando tu viaje compartido vs. ir solo en un coche promedio.</p>
                            <div className="bg-white p-3 rounded-lg border border-slate-200 font-mono text-xs text-center my-2 text-slate-800 shadow-sm">
                                Ahorro = (Emisión Coche Solo) - (Tu Emisión Compartida)
                            </div>
                            <p className="text-xs text-slate-500 italic">
                                * Usamos factores de emisión oficiales de la AEMA/EEA (120g/km promedio UE).
                            </p>
                        </div>
                    </div>

                    {/* Factores */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="border border-emerald-100 bg-emerald-50/50 p-3 rounded-xl">
                            <h5 className="font-bold text-emerald-800 text-xs mb-1">Tu Ahorro Aumenta si:</h5>
                            <ul className="text-xs text-emerald-700 list-disc list-inside space-y-1">
                                <li>Compartes con más personas</li>
                                <li>Usas vehículos eléctricos</li>
                                <li>Haces viajes largos</li>
                            </ul>
                        </div>
                        <div className="border border-red-100 bg-red-50/50 p-3 rounded-xl">
                            <h5 className="font-bold text-red-800 text-xs mb-1">Tu Huella es Menor que:</h5>
                            <ul className="text-xs text-red-700 list-disc list-inside space-y-1">
                                <li>Ir solo en tu coche</li>
                                <li>Vuelos de corta distancia</li>
                                <li>Taxis convencionales</li>
                            </ul>
                        </div>
                    </div>

                    {/* Auditoría */}
                    <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
                        <ShieldCheck className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-blue-900 text-sm">Datos Auditables</h4>
                            <p className="text-xs text-blue-700 leading-relaxed mt-1">
                                Cada gramo de CO₂ ahorrado se registra en un <strong>ledger inmutable</strong>. Esto nos permite certificar el impacto colectivo para programas de la UE (Green Deal).
                            </p>
                        </div>
                    </div>

                    <div className="text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                            Sin Greenwashing. Solo Datos.
                        </p>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ClimateMethodologyDialog;
