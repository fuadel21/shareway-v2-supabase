import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2, ArrowLeft, CheckCircle2, XCircle, ExternalLink, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

// --- Componente para mostrar imagen segura ---
const SecureImage = ({ imagePath, alt }) => {
    const [imageUrl, setImageUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!imagePath) {
            setLoading(false);
            return;
        }

        const fetchImage = async () => {
            try {
                const { data, error } = await supabase.storage
                    .from('verification-documents')
                    .download(imagePath);

                if (error) throw error;

                const objectUrl = URL.createObjectURL(data);
                setImageUrl(objectUrl);
                return () => URL.revokeObjectURL(objectUrl);
            } catch (err) {
                console.error(`Error al cargar la imagen desde ${imagePath}:`, err);
                setError('No se pudo cargar la imagen.');
            } finally {
                setLoading(false);
            }
        };

        fetchImage();

        return () => {
            if (imageUrl) URL.revokeObjectURL(imageUrl);
        };
    }, [imagePath]);

    if (loading) return <div className="flex items-center justify-center bg-gray-50 h-64 rounded-2xl border-2 border-dashed border-gray-100"><Loader2 className="h-8 w-8 animate-spin text-primary/30" /></div>;
    if (error) return <div className="flex items-center justify-center bg-red-50 h-64 rounded-2xl border-2 border-dashed border-red-100 text-red-500 text-sm p-4 text-center">{error}</div>;
    if (!imageUrl) return <div className="flex items-center justify-center bg-gray-50 h-64 rounded-2xl border-2 border-dashed border-gray-100 text-gray-400">No disponible</div>;

    return (
        <div className="relative group overflow-hidden rounded-2xl border-2 border-gray-100">
            <img src={imageUrl} alt={alt} className="w-full h-64 object-cover transition-transform duration-500 group-hover:scale-110" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="bg-white text-black p-3 rounded-full shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-transform">
                    <ExternalLink className="h-6 w-6" />
                </a>
            </div>
        </div>
    );
};

const VerificationReview = () => {
    const { userId } = useParams();
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchUser = useCallback(async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) throw error;

            if (data) {
                setUser(data);
            } else {
                toast.error("Usuario no encontrado.");
                navigate('/admin/verifications');
            }
        } catch (error) {
            console.error("Error fetchUser:", error);
            toast.error("Error al cargar el usuario.");
        } finally {
            setLoading(false);
        }
    }, [userId, navigate]);

    useEffect(() => {
        fetchUser();
    }, [fetchUser]);

    const handleVerificationAction = async (status) => {
        setIsSubmitting(true);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({
                    verification: {
                        ...(user.verification || {}),
                        status: status,
                        reviewedAt: new Date().toISOString(),
                    },
                    // Si se aprueba, podríamos querer cambiar el rol o algo similar
                    // role: status === 'approved' ? 'verified_user' : user.role
                })
                .eq('id', userId);

            if (error) throw error;

            toast.success(`La verificación ha sido ${status === 'approved' ? 'aprobada' : 'rechazada'}.`);
            navigate('/admin/verifications');
        } catch (error) {
            console.error("Error updating verification:", error);
            toast.error("Error al actualizar la verificación.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading) {
        return <div className="h-screen flex flex-col justify-center items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground font-medium">Cargando expediente...</p>
        </div>;
    }

    if (!user) {
        return <div className="text-center text-muted-foreground py-12">No se pudo cargar la información del usuario.</div>;
    }

    const { display_name, email, verification, documents } = user;

    return (
        <div className="space-y-6 pb-20">
            <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={() => navigate(-1)} className="rounded-xl hover:bg-white">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Volver a la lista
                </Button>
                <div className="flex gap-2">
                    <span className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${verification?.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            verification?.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                        Estado actual: {verification?.status || 'Pendiente'}
                    </span>
                </div>
            </div>

            <Card className="rounded-[2.5rem] border-none shadow-xl shadow-blue-500/5 overflow-hidden">
                <CardHeader className="bg-gradient-to-br from-white to-blue-50/20 p-8 border-b border-gray-50">
                    <div className="flex items-center gap-4">
                        <div className="bg-primary/10 p-4 rounded-2xl">
                            <ShieldCheck className="h-8 w-8 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-3xl font-bold text-gray-900">{display_name}</CardTitle>
                            <CardDescription className="text-lg text-gray-500">{email}</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-8 space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="font-bold text-gray-700 flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                    DNI / Identificación
                                </h4>
                                {documents?.idCard && <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded-full font-bold uppercase text-gray-400">Exp: {new Date(documents.idCard.updatedAt).toLocaleDateString()}</span>}
                            </div>
                            <SecureImage imagePath={documents?.idCard?.path} alt="DNI / Pasaporte" />
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="font-bold text-gray-700 flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                    Licencia de Conducir
                                </h4>
                                {documents?.driverLicense && <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded-full font-bold uppercase text-gray-400">Exp: {new Date(documents.driverLicense.updatedAt).toLocaleDateString()}</span>}
                            </div>
                            <SecureImage imagePath={documents?.driverLicense?.path} alt="Permiso de Conducir" />
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="font-bold text-gray-700 flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                    Permiso de Circulación
                                </h4>
                                {documents?.vehicleRegistration && <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded-full font-bold uppercase text-gray-400">Exp: {new Date(documents.vehicleRegistration.updatedAt).toLocaleDateString()}</span>}
                            </div>
                            <SecureImage imagePath={documents?.vehicleRegistration?.path} alt="Permiso de Vehículo" />
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row justify-center gap-4 pt-10 border-t border-gray-50">
                        <Button
                            variant="outline"
                            className="rounded-2xl h-14 px-10 text-red-600 border-red-100 hover:bg-red-50 hover:text-red-700 font-bold transition-all shadow-sm"
                            onClick={() => handleVerificationAction('rejected')}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <XCircle className="mr-2 h-5 w-5" />}
                            Rechazar Verificación
                        </Button>
                        <Button
                            className="rounded-2xl h-14 px-10 bg-primary hover:bg-primary/90 font-bold transition-all shadow-lg shadow-primary/20"
                            onClick={() => handleVerificationAction('approved')}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                            Aprobar Expediente
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="bg-blue-50/50 rounded-3xl p-6 border border-blue-100">
                <p className="text-sm text-blue-700 leading-relaxed">
                    <strong>Nota para el Administrador:</strong> Al aprobar este expediente, el usuario recibirá una notificación y su perfil será marcado como verificado en toda la plataforma. Si el usuario subió documentos de conductor, también podrá empezar a publicar viajes.
                </p>
            </div>
        </div>
    );
};

export default VerificationReview;

