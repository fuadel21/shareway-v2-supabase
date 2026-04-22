import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog.jsx";
import { Input } from './ui/input.jsx';
import { Button } from './ui/button.jsx';
import { Loader2, ShieldCheck, Lock, Sparkles, X } from 'lucide-react';
import { cn } from '../lib/utils.js';

const PinVerificationDialog = ({ open, onOpenChange, onConfirm, isLoading, title }) => {
    const [pin, setPin] = useState(['', '', '', '']);
    const inputRefs = [useRef(), useRef(), useRef(), useRef()];

    useEffect(() => {
        if (open) {
            setPin(['', '', '', '']);
            setTimeout(() => inputRefs[0].current?.focus(), 300);
        }
    }, [open]);

    const handleChange = (index, value) => {
        const newValue = value.replace(/[^0-9]/g, '').slice(-1);
        if (!newValue) {
            const newPin = [...pin];
            newPin[index] = '';
            setPin(newPin);
            return;
        }

        const newPin = [...pin];
        newPin[index] = newValue;
        setPin(newPin);

        if (index < 3) {
            inputRefs[index + 1].current?.focus();
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !pin[index] && index > 0) {
            inputRefs[index - 1].current?.focus();
        }
    };

    const handleConfirm = () => {
        const fullPin = pin.join('');
        if (fullPin.length === 4) {
            onConfirm(fullPin);
        }
    };

    const isComplete = pin.every(digit => digit !== '');

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="rounded-[3.5rem] border-none shadow-[0_40px_100px_rgba(0,0,0,0.2)] overflow-hidden max-w-[420px] p-0">

                <div className="bg-navy p-12 text-center text-white relative">
                    <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                        <Sparkles className="h-full w-full p-4" />
                    </div>

                    <div className="h-20 w-20 bg-primary/20 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 border border-white/10 backdrop-blur-xl animate-in zoom-in duration-700">
                        <Lock className="h-10 w-10 text-primary" />
                    </div>

                    <DialogHeader className="space-y-4">
                        <DialogTitle className="text-3xl font-black tracking-tighter text-white">
                            {title || "Verificar PIN"}
                        </DialogTitle>
                        <DialogDescription className="font-bold text-white/40 leading-relaxed max-w-[280px] mx-auto text-sm">
                            Solicita el código de 4 dígitos al pasajero para confirmar el embarque seguro.
                        </DialogDescription>
                    </DialogHeader>
                </div>

                <div className="p-12 space-y-12 bg-white">
                    <div className="flex justify-center gap-4">
                        {pin.map((digit, index) => (
                            <input
                                key={index}
                                ref={inputRefs[index]}
                                type="text"
                                inputMode="numeric"
                                value={digit}
                                onChange={(e) => handleChange(index, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(index, e)}
                                className={cn(
                                    "w-16 h-24 text-center text-4xl font-black rounded-[1.5rem] border-4 transition-all duration-300 outline-none",
                                    digit
                                        ? "border-primary bg-primary/5 text-primary shadow-2xl shadow-primary/10"
                                        : "border-slate-50 bg-slate-50 focus:border-indigo-100 text-slate-800"
                                )}
                                autoComplete="off"
                            />
                        ))}
                    </div>

                    <div className="flex flex-col gap-4">
                        <Button
                            onClick={handleConfirm}
                            disabled={isLoading || !isComplete}
                            className="w-full h-20 rounded-[2rem] text-xl font-black tracking-tighter shadow-2xl shadow-indigo-200 hover:scale-[1.02] active:scale-95 transition-all bg-indigo-600 hover:bg-navy text-white"
                        >
                            {isLoading ? (
                                <><Loader2 className="mr-3 h-8 w-8 animate-spin" /> VERIFICANDO...</>
                            ) : (
                                <><ShieldCheck className="mr-3 h-8 w-8" /> CONFIRMAR EMBARQUE</>
                            )}
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            className="font-black text-[10px] uppercase tracking-widest text-slate-400 hover:text-slate-900 h-10 transition-colors"
                        >
                            Pospone verificación
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default PinVerificationDialog;
