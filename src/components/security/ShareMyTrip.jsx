import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { ArrowLeft, Share2, Map, Lock, Link2 } from 'lucide-react';

function ShareMyTrip() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="sticky top-0 z-10 border-b bg-card">
                <div className="container mx-auto flex items-center gap-4 p-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Volver">
                        <ArrowLeft />
                    </Button>
                    <h1 className="text-xl font-bold">Compartir mi viaje</h1>
                </div>
            </header>

            <main className="container mx-auto max-w-2xl space-y-8 p-4">
                <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-3">
                            <Share2 className="text-blue-600" />
                            <span>Comparte solo lo necesario</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            Desde el detalle de un viaje programado, activo o en curso puedes generar un enlace temporal para una persona de confianza.
                            El enlace muestra únicamente el estado, la ruta, la salida, el conductor público y la última ubicación disponible.
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Usar un enlace seguro</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-start gap-4">
                            <div className="rounded-full bg-primary/10 p-3 text-primary"><Map className="h-6 w-6" /></div>
                            <div>
                                <h3 className="font-semibold">1. Abre el detalle del viaje</h3>
                                <p className="text-muted-foreground">Entra en Mis viajes y selecciona el viaje que quieres compartir.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="rounded-full bg-primary/10 p-3 text-primary"><Link2 className="h-6 w-6" /></div>
                            <div>
                                <h3 className="font-semibold">2. Genera y comparte el enlace</h3>
                                <p className="text-muted-foreground">El servidor genera un token aleatorio; solo se guarda su hash y el token se muestra una vez al crearlo.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="rounded-full bg-primary/10 p-3 text-primary"><Lock className="h-6 w-6" /></div>
                            <div>
                                <h3 className="font-semibold">3. Revócalo cuando quieras</h3>
                                <p className="text-muted-foreground">El enlace caduca automáticamente, se invalida al cancelar el viaje y deja de funcionar dos horas después de finalizarlo.</p>
                            </div>
                        </div>
                        <Button type="button" onClick={() => navigate('/my-rides')} className="w-full">
                            Ver mis viajes
                        </Button>
                    </CardContent>
                </Card>
            </main>
        </div>
    );
}

export default ShareMyTrip;
