import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { X, Star } from 'lucide-react';

const getInitials = (name) => name ? name.split(' ').map(w => w[0]).join('').toUpperCase() : '?';

const DriverInfoCard = ({ ride, onClose }) => {
    if (!ride || !ride.driver) return null;

    const { driver } = ride;
    // Simulación de datos que podrían venir del perfil del conductor en el futuro
    const rating = driver.rating || 4.8;
    const tripCount = driver.tripCount || 120;

    return (
        <Card className="absolute top-4 left-4 z-20 w-80 shadow-lg">
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
                <Avatar className="h-12 w-12">
                    <AvatarImage src={driver.photoURL} alt={driver.name} />
                    <AvatarFallback>{getInitials(driver.name)}</AvatarFallback>
                </Avatar>
                <div>
                    <CardTitle className="text-lg">{driver.name}</CardTitle>
                    <CardDescription>Conductor verificado</CardDescription>
                </div>
                <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-6 w-6" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>
            </CardHeader>
            <CardContent>
                <div className="flex justify-between items-center text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        <span className="font-semibold">{rating.toFixed(1)}</span>
                    </div>
                    <span>{tripCount} viajes completados</span>
                </div>
            </CardContent>
        </Card>
    );
};

export default DriverInfoCard;
