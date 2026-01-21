import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Plus, Search } from 'lucide-react';

const AddFlow = () => {
    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md space-y-6">
                <div className="text-center">
                    <h1 className="text-3xl font-bold">Crear</h1>
                    <p className="text-muted-foreground mt-2">¿Qué te gustaría hacer?</p>
                </div>
                <Link to="/create-ride" className="block">
                    <Card className="hover:bg-gray-100 transition-colors py-6">
                        <CardContent className="flex flex-col items-center justify-center text-center">
                            <Plus className="h-10 w-10 text-primary mb-3" />
                            <h3 className="text-xl font-semibold">Publicar un Viaje</h3>
                            <p className="text-sm text-muted-foreground mt-1">Ofrece las plazas libres de tu coche.</p>
                        </CardContent>
                    </Card>
                </Link>
                <Link to="/create-request" className="block">
                    <Card className="hover:bg-gray-100 transition-colors py-6">
                         <CardContent className="flex flex-col items-center justify-center text-center">
                            <Search className="h-10 w-10 text-primary mb-3" />
                            <h3 className="text-xl font-semibold">Solicitar un Viaje</h3>
                            <p className="text-sm text-muted-foreground mt-1">Busca un conductor para la ruta que necesitas.</p>
                        </CardContent>
                    </Card>
                </Link>
            </div>
        </div>
    );
};

export default AddFlow;
