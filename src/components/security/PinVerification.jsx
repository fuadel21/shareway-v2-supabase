import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { ArrowLeft, ShieldQuestion, KeyRound, CheckCircle } from 'lucide-react';

function PinVerification() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="bg-card border-b sticky top-0 z-10">
                <div className="container mx-auto p-4 flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft /></Button>
                    <h1 className="text-xl font-bold">Verificación por PIN</h1>
                </div>
            </header>

            <main className="container mx-auto p-4 max-w-2xl space-y-8">
                <Card className="bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-3"><ShieldQuestion className="text-green-600" /><span>Viaja con la persona correcta</span></CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            Para asegurar que siempre subes al coche correcto, la aplicación te mostrará un PIN único de 4 dígitos para cada viaje. Deberás proporcionarle este PIN a tu conductor para que pueda iniciar el trayecto en su app.
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>¿Cómo funciona?</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-start gap-4">
                             <div className="flex-shrink-0 bg-primary/10 text-primary p-3 rounded-full"><KeyRound className="h-6 w-6" /></div>
                            <div>
                                <h3 className="font-semibold">1. Recibe tu PIN</h3>
                                <p className="text-muted-foreground">Cuando se te asigne un conductor, verás un PIN de 4 dígitos en los detalles de tu viaje.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                             <div className="flex-shrink-0 bg-primary/10 text-primary p-3 rounded-full"><CheckCircle className="h-6 w-6" /></div>
                            <div>
                                <h3 className="font-semibold">2. Compártelo con tu conductor</h3>
                                <p className="text-muted-foreground">Al encontrar a tu conductor, muéstrale o dile tu PIN. Él lo introducirá en su aplicación para confirmar que eres el pasajero correcto.</p>
                            </div>
                        </div>
                         <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 bg-primary/10 text-primary p-3 rounded-full"><ShieldQuestion className="h-6 w-6" /></div>
                            <div>
                                <h3 className="font-semibold">3. Viaje Verificado</h3>
                                <p className="text-muted-foreground">Una vez el PIN es validado, el viaje puede comenzar. ¡Así de fácil y seguro!</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-dashed">
                    <CardHeader>
                        <CardTitle>Siempre Activo</CardTitle>
                        <CardDescription>Esta función de seguridad está activada por defecto para todos los viajes y no requiere configuración.</CardDescription>
                    </CardHeader>
                </Card>
            </main>
        </div>
    );
}

export default PinVerification;
