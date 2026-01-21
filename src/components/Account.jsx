import React from 'react';
import { useNavigate, useOutletContext, Link } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

// --- UI & Icons ---
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { LogOut, Star, User, Settings, Wallet, Route, ShieldCheck, Car, Cigarette, Dog, Music, MessageCircle, ChevronRight, Mail, Calendar, Shield, Leaf } from 'lucide-react';
import { cn } from '@/lib/utils';

const getInitials = (name) => {
    if (!name) return '?';
    const words = name.trim().split(' ');
    return words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase() : words[0].substring(0, 2).toUpperCase();
};

const StarRating = ({ rating, count }) => {
    const fullStars = Math.floor(rating);
    const halfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);
    if (!count || count === 0) return <p className="text-sm text-muted-foreground font-medium">Nuevo en ShareWay</p>;

    return (
        <div className="flex items-center gap-1">
            {[...Array(fullStars)].map((_, i) => <Star key={`full-${i}`} className="h-4 w-4 text-yellow-400 fill-yellow-400" />)}
            {halfStar && <Star key="half" className="h-4 w-4 text-yellow-400 fill-yellow-200" />}
            {[...Array(emptyStars)].map((_, i) => <Star key={`empty-${i}`} className="h-4 w-4 text-gray-200" />)}
            <span className="text-sm text-gray-500 font-bold ml-1">{rating.toFixed(1)} ({count})</span>
        </div>
    );
};

const PreferenceIcon = ({ icon: Icon, label, status }) => {
    const statusMap = {
        yes: { text: `Permite ${label.toLowerCase()}`, color: 'text-green-500 bg-green-50' },
        no: { text: `No permite ${label.toLowerCase()}`, color: 'text-red-500 bg-red-50' },
        any: { text: `Indiferente a ${label.toLowerCase()}`, color: 'text-gray-400 bg-gray-50' }
    };
    const current = statusMap[status] || statusMap.any;
    return (
        <div className={cn("p-3 rounded-2xl transition-all", current.color)} title={current.text}>
            <Icon className="h-6 w-6" />
        </div>
    );
};

function Account() {
    const { profile, handleSignOut } = useOutletContext();
    const navigate = useNavigate();

    if (!profile) return <div className="h-screen w-screen flex flex-col items-center justify-center gap-4"><Loader2 className="animate-spin text-primary h-10 w-10" /> <p className="font-bold text-gray-500">Cargando perfil...</p></div>;

    const creationDate = profile.created_at ? new Date(profile.created_at) : null;
    const memberSince = creationDate ?
        `Miembro desde ${format(creationDate, "MMMM yyyy", { locale: es })}` : '';

    const ActionButton = ({ to, icon: Icon, children, color = "text-primary" }) => (
        <Button variant="outline" size="lg" asChild className="justify-start text-base py-8 rounded-3xl border-none shadow-sm bg-white dark:bg-navy hover:shadow-md transition-all group">
            <Link to={to} className="flex items-center gap-4">
                <div className={cn("p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 transition-colors group-hover:bg-primary/10", color)}>
                    <Icon className="h-6 w-6" />
                </div>
                <span className="flex-grow font-black text-gray-700 dark:text-gray-200 tracking-tight">{children}</span>
                <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-primary transition-colors" />
            </Link>
        </Button>
    );

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-navy pb-24">
            <main className="container mx-auto p-4 max-w-2xl pt-8">
                {/* --- Tarjeta de Perfil Principal --- */}
                <Card className="rounded-[3rem] border-none shadow-xl shadow-blue-500/5 overflow-hidden mb-8 bg-white dark:bg-navy">
                    <CardContent className="p-8 flex flex-col items-center text-center">
                        <div className="relative mb-6">
                            <Avatar className="h-32 w-32 border-4 border-white dark:border-slate-800 shadow-2xl">
                                <AvatarImage src={profile.photo_url} alt={profile.display_name} />
                                <AvatarFallback className="text-4xl bg-primary/5 text-primary font-black">{getInitials(profile.display_name)}</AvatarFallback>
                            </Avatar>
                            {profile.verification?.status === 'verified' && (
                                <div className="absolute -bottom-2 -right-2 bg-green-500 text-white rounded-full p-2 border-4 border-white dark:border-slate-800 shadow-lg" title="Perfil Verificado">
                                    <ShieldCheck className="h-6 w-6" />
                                </div>
                            )}
                        </div>

                        <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight mb-1">{profile.display_name}</h1>
                        <div className="flex items-center gap-2 text-slate-400 font-medium text-sm mb-4">
                            <Mail className="h-3.5 w-3.5" />
                            {profile.email}
                        </div>

                        <div className="flex items-center gap-4 mb-6">
                            <StarRating rating={Number(profile.rating) || 0} count={profile.review_count || 0} />
                        </div>

                        <div className="flex items-center gap-2 text-primary bg-primary/5 rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-widest">
                            <Calendar className="h-4 w-4" /> {memberSince}
                        </div>

                        {/* STATS BOARD PREMIUM */}
                        <div className="grid grid-cols-2 gap-4 w-full mt-8">
                            <div className="bg-slate-50 dark:bg-slate-800 p-5 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col items-center text-center group hover:bg-white transition-all">
                                <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                                    <Route className="h-5 w-5" />
                                </div>
                                <p className="text-2xl font-black text-slate-900 dark:text-white italic leading-none">{profile.rides_count || 0}</p>
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1">Viajes Realizados</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-5 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col items-center text-center group hover:bg-white transition-all">
                                <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                                    <Leaf className="h-5 w-5" />
                                </div>
                                <p className="text-2xl font-black text-slate-900 dark:text-white italic leading-none">{parseFloat(profile.total_co2_saved || 0).toFixed(1)}</p>
                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1">Kg CO2 Ahorrados</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* --- Botones de Acción Principales --- */}
                <div className="grid grid-cols-1 gap-4 mb-8">
                    <ActionButton to="/edit-profile" icon={User} color="text-blue-500">Editar Perfil</ActionButton>
                    <ActionButton to="/identity-verification" icon={ShieldCheck} color="text-green-500">Verificación de Identidad</ActionButton>
                    <ActionButton to="/wallet" icon={Wallet} color="text-emerald-500">Mi Cartera</ActionButton>
                    <ActionButton to="/my-rides" icon={Route} color="text-amber-500">Mis Viajes</ActionButton>
                    <ActionButton to="/security" icon={Shield} color="text-gray-500">Seguridad</ActionButton>
                    <ActionButton to="/settings" icon={Settings} color="text-indigo-500">Ajustes</ActionButton>
                </div>

                {/* --- Tarjeta de Vehículo (si existe) --- */}
                {profile.vehicle && profile.vehicle.make && (
                    <Card className="rounded-[3rem] border-none shadow-xl shadow-blue-500/5 overflow-hidden mb-8 bg-slate-900 group">
                        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
                            <Car size={140} className="text-white" />
                        </div>
                        <CardHeader className="pb-2 relative z-10">
                            <div className="flex items-center justify-between">
                                <CardTitle className="flex items-center gap-2 text-xl font-black text-white italic uppercase tracking-tighter">
                                    <Car className="text-primary h-5 w-5" /> Garage ShareWay
                                </CardTitle>
                                <span className="bg-primary text-white text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest italic shadow-lg shadow-primary/20">{profile.vehicle.color || 'Premium'}</span>
                            </div>
                        </CardHeader>
                        <CardContent className="flex items-center gap-6 pt-4 relative z-10">
                            {profile.vehicle.photoURL ? (
                                <div className="h-24 w-36 rounded-2xl overflow-hidden border-2 border-white/10 shadow-2xl">
                                    <img src={profile.vehicle.photoURL} alt="Vehículo" className="w-full h-full object-cover" />
                                </div>
                            ) : (
                                <div className="h-24 w-24 rounded-2xl bg-white/5 flex items-center justify-center text-white/20 border border-white/10 backdrop-blur-md">
                                    <Car className="h-10 w-10" />
                                </div>
                            )}
                            <div className="space-y-1">
                                <p className="font-black text-2xl text-white tracking-tighter italic leading-none uppercase">{profile.vehicle.make} {profile.vehicle.model}</p>
                                <div className="flex items-center gap-2">
                                    <p className="text-primary font-black text-[10px] tracking-[0.2em] uppercase">{profile.vehicle.year || '2024'}</p>
                                    <span className="text-white/20">•</span>
                                    <p className="font-mono text-white/40 text-[10px] tracking-widest uppercase">Matrícula Privada</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* --- Tarjeta de Preferencias --- */}
                {profile.preferences && (
                    <Card className="rounded-[2.5rem] border-none shadow-xl shadow-blue-500/5 overflow-hidden mb-8">
                        <CardHeader><CardTitle className="text-xl font-black">Preferencias de Viaje</CardTitle></CardHeader>
                        <CardContent className="flex justify-around items-center pt-2 pb-6">
                            <PreferenceIcon icon={Cigarette} label="Fumar" status={profile.preferences.smoking} />
                            <PreferenceIcon icon={Dog} label="Mascotas" status={profile.preferences.pets} />
                            <PreferenceIcon icon={Music} label="Música" status={profile.preferences.music} />
                            <PreferenceIcon icon={MessageCircle} label="Conversación" status={profile.preferences.talkativeness} />
                        </CardContent>
                    </Card>
                )}

                {/* --- Cerrar Sesión --- */}
                <div className="space-y-6 pt-4 pb-12">
                    <Button variant="ghost" size="lg" className="w-full h-16 rounded-2xl text-destructive hover:text-destructive hover:bg-destructive/5 font-black text-lg transition-all" onClick={handleSignOut}>
                        <LogOut className="mr-3 h-6 w-6" />
                        Cerrar Sesión
                    </Button>
                    <div className="flex flex-col items-center gap-2">
                        <p className="text-center text-xs text-slate-400 font-medium">
                            ¿Necesitas ayuda? Escríbenos a
                        </p>
                        <a href="mailto:soporte@taxicompartido.com" className="text-primary font-black text-sm hover:underline">
                            soporte@shareway.app
                        </a>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default Account;