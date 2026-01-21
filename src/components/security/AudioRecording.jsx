import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { ArrowLeft, Mic, ShieldCheck, Download } from 'lucide-react';

function AudioRecording() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="bg-card border-b sticky top-0 z-10">
                <div className="container mx-auto p-4 flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft /></Button>
                    <h1 className="text-xl font-bold">Grabación de Audio</h1>
                </div>
            </header>

            <main className="container mx-auto p-4 max-w-2xl space-y-8">
                <Card className="bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-3"><Mic className="text-orange-600" /><span>Tu seguridad, tu voz</span></CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            Si en algún momento de tu viaje te sientes incómodo o inseguro, puedes iniciar una grabación de audio directamente desde la app. El audio se guardará de forma segura para que nuestro equipo de soporte pueda revisarlo si es necesario.
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Puntos Clave</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 bg-primary/10 text-primary p-3 rounded-full"><ShieldCheck className="h-6 w-6" /></div>
                            <div>
                                <h3 className="font-semibold">Confidencial y Seguro</h3>
                                <p className="text-muted-foreground">Las grabaciones son encriptadas y solo serán accedidas por nuestro equipo de soporte en caso de que envíes un reporte.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                             <div className="flex-shrink-0 bg-primary/10 text-primary p-3 rounded-full"><Download className="h-6 w-6" /></div>
                            <div>
                                <h3 className="font-semibold">Disponible para Ti</h3>
                                <p className="text-muted-foreground">Tendrás la opción de descargar el audio para tus propios registros después de que el viaje haya finalizado.</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                
                <Card className="border-dashed">
                    <CardHeader>
                        <CardTitle>Próximamente</CardTitle>
                        <CardDescription>Esta función estará disponible durante un viaje activo para garantizar tu tranquilidad. ¡Estamos ultimando los detalles!</CardDescription>
                    </CardHeader>
                </Card>
            </main>
        </div>
    );
}

export default AudioRecording;
