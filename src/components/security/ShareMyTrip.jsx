import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { ArrowLeft, Share2, Map, Lock } from 'lucide-react';

function ShareMyTrip() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="bg-card border-b sticky top-0 z-10">
                <div className="container mx-auto p-4 flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft /></Button>
                    <h1 className="text-xl font-bold">Compartir Mi Viaje</h1>
                </div>
            </header>

            <main className="container mx-auto p-4 max-w-2xl space-y-8">
                <Card className="bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-3"><Share2 className="text-blue-600" /><span>Tranquilidad para todos</span></CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            La función "Compartir Mi Viaje" te permite enviar un enlace privado y seguro a tus contactos de confianza. Con este enlace, podrán ver tu ubicación y el progreso de tu viaje en tiempo real en un mapa.
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>¿Cómo funciona?</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 bg-primary/10 text-primary p-3 rounded-full">
                                <Map className="h-6 w-6" />
                            </div>
                            <div>
                                <h3 className="font-semibold">1. Inicia un Viaje</h3>
                                <p className="text-muted-foreground">Durante cualquier viaje que realices o conduzcas, verás un botón para compartir en la pantalla del mapa.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 bg-primary/10 text-primary p-3 rounded-full">
                                <Share2 className="h-6 w-6" />
                            </div>
                            <div>
                                <h3 className="font-semibold">2. Genera un Enlace Seguro</h3>
                                <p className="text-muted-foreground">Al pulsar el botón, se generará un enlace único. Solo las personas con este enlace podrán ver los detalles de tu viaje.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 bg-primary/10 text-primary p-3 rounded-full">
                                <Lock className="h-6 w-6" />
                            </div>
                            <div>
                                <h3 className="font-semibold">3. El Enlace Expira Automáticamente</h3>
                                <p className="text-muted-foreground">Por tu seguridad, el enlace dejará de funcionar poco después de que tu viaje haya finalizado.</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                 <Card className="border-dashed">
                    <CardHeader>
                        <CardTitle>Próximamente</CardTitle>
                        <CardDescription>Esta función se activará desde la pantalla de un viaje en curso. ¡Estamos trabajando en ello!</CardDescription>
                    </CardHeader>
                </Card>
            </main>
        </div>
    );
}

export default ShareMyTrip;
