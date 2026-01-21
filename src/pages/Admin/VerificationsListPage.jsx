import React from 'react';
import PendingVerificationsTab from './tabs/PendingVerificationsTab';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const VerificationsListPage = () => {
    return (
        <div>
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Gestión de Verificaciones</h1>
                <p className="text-muted-foreground mt-1">
                    Revisa las solicitudes de verificación de documentos de los usuarios para mantener la seguridad de la plataforma.
                </p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Usuarios Pendientes</CardTitle>
                    <CardDescription>
                        Estos usuarios han subido sus documentos y están esperando aprobación para poder conducir.
                    </CardDescription>
                </CardHeader>
                <PendingVerificationsTab />
            </Card>
        </div>
    );
};

export default VerificationsListPage;