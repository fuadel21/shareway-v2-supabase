import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Loader2, ArrowLeft, Shield, Mail, Phone, Calendar, Car, Star, MapPin, History, ShieldCheck, ShieldX } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { adminUpdateUserStatus } from '@/lib/supabaseRPC';

const getInitials = (name) => {
    if (!name || typeof name !== 'string') return '?';
    return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
};

const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) return 'Fecha inválida';
        return date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        });
    } catch {
        return 'Fecha inválida';
    }
};

const formatDateTime = (dateStr) => {
    if (!dateStr) return 'Fecha pendiente';
    try {
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) return 'Fecha inválida';
        return date.toLocaleString('es-ES');
    } catch {
        return 'Fecha inválida';
    }
};

const getLocationLabel = (location, fallback) => location?.name || location?.address || location?.formatted_address || fallback;

function AdminUserProfile() {
    const { userId } = useParams();
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [createdRides, setCreatedRides] = useState([]);
    const [joinedRides, setJoinedRides] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processingStatus, setProcessingStatus] = useState(false);

    const fetchData = async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (profileError || !profile) {
                toast.error('Usuario no encontrado.');
                navigate('/admin/users');
                return;
            }
            setUser(profile);

            const { data: rides, error: ridesError } = await supabase
                .from('rides')
                .select('*')
                .eq('driver_id', userId)
                .order('departure_time', { ascending: false });

            if (!ridesError) setCreatedRides(rides || []);

            const { data: requests, error: requestsError } = await supabase
                .from('ride_requests')
                .select('ride_id, rides (*)')
                .eq('passenger_id', userId)
                .eq('status', 'accepted');

            if (!requestsError) {
                const mappedJoined = (requests || []).map(req => req.rides).filter(Boolean);
                setJoinedRides(mappedJoined);
            }
        } catch (err) {
            console.error('Error fetchData:', err);
            toast.error('Error al cargar los datos del usuario.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [userId]);

    const handleUpdateVerification = async (status) => {
        if (!userId) return;
        setProcessingStatus(true);
        const toastId = toast.loading(status === 'verified' ? 'Aprobando verificación...' : 'Rechazando verificación...');
        try {
            const { success, error } = await adminUpdateUserStatus(userId, status);
            if (!success) throw new Error(error);
            toast.success(status === 'verified' ? 'Usuario verificado' : 'Verificación rechazada', { id: toastId });
            await fetchData();
        } catch (error) {
            toast.error('Error al actualizar verificación', { id: toastId, description: error.message });
        } finally {
            setProcessingStatus(false);
        }
    };

    const getVerificationBadge = (status) => {
        const variants = { verified: 'default', pending: 'outline', rejected: 'destructive' };
        const text = { verified: 'Verificado', pending: 'Pendiente', rejected: 'Rechazado' };
        return <Badge variant={variants[status] || 'secondary'} className="rounded-full px-3">{text[status] || 'No Verificado'}</Badge>;
    };

    if (loading) return <div className="h-screen flex flex-col items-center justify-center gap-4 bg-gray-50">
        <Loader2 className="animate-spin h-10 w-10 text-primary" />
        <p className="text-muted-foreground font-medium">Cargando perfil...</p>
    </div>;

    if (!user) return null;

    const verificationStatus = user.verification?.status || 'unverified';

    return (
        <div className="min-h-screen bg-gray-50/50 space-y-8 pb-20">
            <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-10 px-4 py-4">
                <div className="container mx-auto flex items-center gap-6">
                    <Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></Button>
                    <div className="flex items-center gap-4">
                        <Avatar className="h-16 w-16 border-2 border-primary/10 shadow-sm">
                            <AvatarImage src={user.photo_url} />
                            <AvatarFallback className="bg-primary/5 text-primary text-xl font-bold">{getInitials(user.display_name || user.email)}</AvatarFallback>
                        </Avatar>
                        <div>
                            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">{user.display_name || 'Usuario sin nombre'}</h1>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <Badge variant="secondary" className="rounded-full">{user.role || 'user'}</Badge>
                                {getVerificationBadge(verificationStatus)}
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 max-w-6xl">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="space-y-6">
                        <Card className="rounded-3xl border-none shadow-xl shadow-blue-500/5 overflow-hidden">
                            <CardHeader className="bg-gradient-to-br from-white to-blue-50/30">
                                <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" /> Detalles de Cuenta</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-6 space-y-4">
                                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl">
                                    <Mail className="h-5 w-5 text-blue-500" />
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-gray-400">Correo Electrónico</p>
                                        <p className="font-medium text-gray-700 break-all">{user.email || 'Sin correo'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl">
                                    <Phone className="h-5 w-5 text-green-500" />
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-gray-400">Teléfono</p>
                                        <p className="font-medium text-gray-700">{user.phone || 'No registrado'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl">
                                    <Calendar className="h-5 w-5 text-purple-500" />
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-gray-400">Fecha de Registro</p>
                                        <p className="font-medium text-gray-700">{formatDate(user.created_at)}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="rounded-3xl border-none shadow-xl shadow-blue-500/5 overflow-hidden">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-500" /> Verificación KYC</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                                    <span className="text-xs font-black uppercase tracking-widest text-slate-400">Estado actual</span>
                                    {getVerificationBadge(verificationStatus)}
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <Button
                                        className="h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-widest"
                                        disabled={processingStatus || verificationStatus === 'verified'}
                                        onClick={() => handleUpdateVerification('verified')}
                                    >
                                        {processingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />} Aprobar
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        className="h-12 rounded-2xl font-black text-[10px] uppercase tracking-widest"
                                        disabled={processingStatus || verificationStatus === 'rejected'}
                                        onClick={() => handleUpdateVerification('rejected')}
                                    >
                                        {processingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4 mr-2" />} Rechazar
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="rounded-3xl border-none shadow-xl shadow-blue-500/5 bg-primary text-white overflow-hidden">
                            <CardContent className="p-5 flex flex-col items-center gap-4">
                                <div className="p-4 bg-white/20 rounded-full backdrop-blur-sm">
                                    <Star className="h-10 w-10 text-yellow-300 fill-yellow-300" />
                                </div>
                                <div className="text-center">
                                    <p className="text-4xl font-extrabold">{Number(user.rating || 0).toFixed(1)}</p>
                                    <p className="text-primary-foreground/80 font-medium">({user.review_count || 0} reseñas)</p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="lg:col-span-2 space-y-8">
                        <section>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="bg-indigo-100 p-2 rounded-xl text-indigo-600"><Car className="h-6 w-6" /></div>
                                <h3 className="text-xl font-bold text-gray-800">Viajes como Conductor <span className="text-gray-400 font-normal ml-2">({createdRides.length})</span></h3>
                            </div>
                            <div className="grid gap-4">
                                {createdRides.length > 0 ? (
                                    createdRides.map(r => (
                                        <div key={r.id} className="bg-white p-5 rounded-3xl border border-gray-100 flex items-center justify-between group hover:shadow-md transition-all">
                                            <div className="flex items-center gap-4">
                                                <div className="p-3 bg-gray-50 rounded-2xl text-gray-400 group-hover:text-primary transition-colors"><MapPin className="h-6 w-6" /></div>
                                                <div>
                                                    <p className="font-bold text-gray-900 leading-tight">{getLocationLabel(r.origin, 'Origen sin definir')} → {getLocationLabel(r.destination, 'Destino sin definir')}</p>
                                                    <p className="text-xs text-muted-foreground mt-1">{formatDateTime(r.departure_time)}</p>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="sm" className="rounded-xl text-primary font-bold hover:bg-primary/10" onClick={() => navigate(`/ride/${r.id}`)}>Ver Viaje</Button>
                                        </div>
                                    ))
                                ) : (
                                    <div className="bg-white p-12 text-center rounded-3xl border border-dashed border-gray-200">
                                        <Car className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                                        <p className="text-gray-400 font-medium">No ha organizado ningún viaje todavía.</p>
                                    </div>
                                )}
                            </div>
                        </section>

                        <section>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="bg-blue-100 p-2 rounded-xl text-blue-600"><History className="h-6 w-6" /></div>
                                <h3 className="text-xl font-bold text-gray-800">Historial como Pasajero <span className="text-gray-400 font-normal ml-2">({joinedRides.length})</span></h3>
                            </div>
                            <div className="grid gap-4">
                                {joinedRides.length > 0 ? (
                                    joinedRides.map(r => (
                                        <div key={r.id} className="bg-white p-5 rounded-3xl border border-gray-100 flex items-center justify-between group hover:shadow-md transition-all">
                                            <div className="flex items-center gap-4">
                                                <div className="p-3 bg-gray-50 rounded-2xl text-gray-400 group-hover:text-blue-500 transition-colors"><MapPin className="h-6 w-6" /></div>
                                                <div>
                                                    <p className="font-bold text-gray-900 leading-tight">{getLocationLabel(r.origin, 'Origen sin definir')} → {getLocationLabel(r.destination, 'Destino sin definir')}</p>
                                                    <p className="text-xs text-muted-foreground mt-1">{formatDateTime(r.departure_time)}</p>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="sm" className="rounded-xl text-primary font-bold hover:bg-primary/10" onClick={() => navigate(`/ride/${r.id}`)}>Detalles</Button>
                                        </div>
                                    ))
                                ) : (
                                    <div className="bg-white p-12 text-center rounded-3xl border border-dashed border-gray-200">
                                        <History className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                                        <p className="text-gray-400 font-medium">No hay viajes registrados en el historial.</p>
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default AdminUserProfile;
