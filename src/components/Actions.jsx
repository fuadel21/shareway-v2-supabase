import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Search, Package, Sparkles, Car, User, Navigation, ArrowRight, ChevronRight, Zap } from 'lucide-react';
import SubPageHeader from './SubPageHeader';

const Actions = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-slate-50 pb-40">
            <SubPageHeader title="¿Qué quieres hacer?" />

            <main className="max-w-xl mx-auto px-4 -mt-10 relative z-10 space-y-6">

                {/* OPCIÓN PRINCIPAL: PUBLICAR VIAJE (DRIVER) */}
                <section className="space-y-6">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-6">Como Conductor</p>
                    <Link to="/create-ride" className="block group">
                        <Card className="rounded-3xl border-none shadow-[0_40px_100px_rgba(0,0,0,0.08)] bg-navy text-white overflow-hidden transition-all duration-500 hover:scale-[1.02] active:scale-95 group-hover:shadow-[0_40px_120px_rgba(0,0,0,0.15)]">
                            <CardContent className="p-10 flex items-center justify-between relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <Car className="size-32 rotate-12" />
                                </div>
                                <div className="space-y-4 relative z-10">
                                    <div className="bg-primary/20 h-16 w-16 rounded-2xl flex items-center justify-center border border-white/10 backdrop-blur-xl">
                                        <Plus className="h-8 w-8 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="text-3xl font-black italic tracking-tighter uppercase leading-none">Publicar Viaje</h3>
                                        <p className="text-indigo-200/60 font-bold mt-2 text-sm">Comparte tus plazas y ahorra dinero.</p>
                                    </div>
                                </div>
                                <div className="h-20 w-20 bg-white/5 rounded-full flex items-center justify-center border border-white/10 group-hover:bg-primary group-hover:border-primary transition-all">
                                    <ArrowRight className="h-8 w-8 text-white group-hover:translate-x-1 transition-transform" />
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                </section>

                {/* OPCIONES SECUNDARIAS: PASAJEROS */}
                <section className="space-y-6">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-6">Como Pasajero</p>
                    <div className="grid grid-cols-1 gap-6">
                        <Link to="/create-request" className="block group">
                            <Card className="rounded-3xl border-none shadow-[0_20px_60px_rgba(0,0,0,0.05)] bg-white/70 backdrop-blur-3xl overflow-hidden hover:bg-white transition-all duration-500 active:scale-95">
                                <CardContent className="p-5 flex items-center gap-6">
                                    <div className="h-16 w-16 bg-indigo-50 rounded-2xl flex items-center justify-center group-hover:bg-primary transition-colors">
                                        <Search className="h-7 w-7 text-primary group-hover:text-white transition-colors" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-xl font-black text-slate-900 tracking-tighter">Solicitar Ruta</h3>
                                        <p className="text-slate-400 font-bold text-xs mt-1">Busca un conductor para tu trayecto.</p>
                                    </div>
                                    <ChevronRight className="h-6 w-6 text-slate-200 group-hover:text-primary transition-colors" />
                                </CardContent>
                            </Card>
                        </Link>

                        <Link to="/create-package" className="block group">
                            <Card className="rounded-3xl border-none shadow-[0_20px_60px_rgba(0,0,0,0.05)] bg-white/70 backdrop-blur-3xl overflow-hidden hover:bg-white transition-all duration-500 active:scale-95">
                                <CardContent className="p-5 flex items-center gap-6">
                                    <div className="h-16 w-16 bg-amber-50 rounded-2xl flex items-center justify-center group-hover:bg-amber-500 transition-colors">
                                        <Package className="h-7 w-7 text-amber-500 group-hover:text-white transition-colors" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-xl font-black text-slate-900 tracking-tighter">Enviar Paquete</h3>
                                        <p className="text-slate-400 font-bold text-xs mt-1">Aprovecha un viaje para tus envíos.</p>
                                    </div>
                                    <ChevronRight className="h-6 w-6 text-slate-200 group-hover:text-amber-500 transition-colors" />
                                </CardContent>
                            </Card>
                        </Link>
                    </div>
                </section>

                {/* INFO EXTRA / PROMOCIÓN */}
                <div className="p-10 bg-gradient-to-br from-primary to-indigo-600 rounded-3xl shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                        <Zap className="size-20 text-white animate-pulse" />
                    </div>
                    <div className="relative z-10 space-y-4">
                        <div className="inline-flex items-center gap-2 bg-white/20 px-4 py-1.5 rounded-full border border-white/20 backdrop-blur-md">
                            <Sparkles className="h-3 w-3 text-white" />
                            <span className="text-[9px] font-black uppercase tracking-widest text-white">ShareWay Premium</span>
                        </div>
                        <h4 className="text-2xl font-black text-white tracking-tighter leading-tight">Gana dinero de camino al trabajo</h4>
                        <p className="text-indigo-100 font-bold text-sm leading-relaxed max-w-[280px]">
                            Publica tu ruta diaria y financia tus gastos de combustible fácilmente.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Actions;
