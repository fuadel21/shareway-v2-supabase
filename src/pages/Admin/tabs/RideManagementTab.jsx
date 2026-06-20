import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRideManagementList } from '@/lib/supabaseRPC';
import { Car, MapPin, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * RideManagementTab Component
 *
 * Provides an administrative overview of all rides on the platform.
 * Includes status-based filtering and detailed route information for each ride.
 */
const RideManagementTab = () => {
    const [rides, setRides] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const navigate = useNavigate();

    const fetchRides = async () => {
        setLoading(true);
        try {
            const { data, success, error } = await getRideManagementList(statusFilter);
            if (!success) throw new Error(error);
            setRides(data || []);
        } catch (error) {
            console.error("Error fetching rides:", error);
            toast.error("Error al cargar los viajes.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRides();
    }, [statusFilter]);

    const getStatusBadge = (status) => {
        const normalizedStatus = status === 'canceled' ? 'cancelled' : status === 'inprogress' ? 'in_progress' : status;
        const variants = {
            scheduled: 'bg-blue-50 text-blue-600 border-blue-100',
            active: 'bg-yellow-50 text-yellow-600 border-yellow-100',
            in_progress: 'bg-yellow-50 text-yellow-600 border-yellow-100',
            completed: 'bg-green-50 text-green-600 border-green-100',
            cancelled: 'bg-red-50 text-red-600 border-red-100',
        };
        const labels = {
            scheduled: 'Programado',
            active: 'En Curso',
            in_progress: 'En Curso',
            completed: 'Completado',
            cancelled: 'Cancelado'
        };
        return <Badge variant="outline" className={`${variants[normalizedStatus] || 'bg-gray-50 text-gray-600 border-gray-100'} rounded-full px-3`}>{labels[normalizedStatus] || status}</Badge>;
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'Fecha pendiente';
        return new Date(dateStr).toLocaleString('es-ES', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getLocationLabel = (location, fallback) => location?.name || location?.address || location?.formatted_address || fallback;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-gray-50 shadow-sm">
                <div className="flex items-center gap-2">
                    <Car className="h-5 w-5 text-primary" />
                    <span className="font-semibold text-gray-700">Filtrar Viajes</span>
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[200px] rounded-xl border-gray-100">
                        <SelectValue placeholder="Estado del viaje" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                        <SelectItem value="all">Todos los estados</SelectItem>
                        <SelectItem value="scheduled">Programados</SelectItem>
                        <SelectItem value="in_progress">En curso</SelectItem>
                        <SelectItem value="completed">Completados</SelectItem>
                        <SelectItem value="cancelled">Cancelados</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {loading ? (
                <div className="text-center py-20"><Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" /></div>
            ) : (
                <div className="grid gap-4">
                    {rides.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground italic">No se encontraron viajes.</div>
                    ) : (
                        rides.map(ride => (
                            <div key={ride.id} className="group bg-white border border-gray-100 rounded-3xl p-5 hover:shadow-lg transition-all duration-300">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                    <div className="space-y-3">
                                        <div className="flex items-start gap-3">
                                            <div className="mt-1 flex flex-col items-center gap-1">
                                                <div className="w-2 h-2 rounded-full bg-blue-500" />
                                                <div className="w-0.5 h-6 bg-gray-100" />
                                                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                                            </div>
                                            <div className="space-y-2 text-left">
                                                <p className="font-bold text-gray-900 leading-none">{getLocationLabel(ride.origin, 'Origen sin definir')}</p>
                                                <p className="font-bold text-gray-900 leading-none pt-1">{getLocationLabel(ride.destination, 'Destino sin definir')}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                            <span className="bg-gray-50 px-3 py-1 rounded-full font-medium">{formatDate(ride.departure_time)}</span>
                                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Conductor: {ride.profiles?.display_name || 'Desconocido'}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {getStatusBadge(ride.status)}
                                        <Button
                                            variant="secondary"
                                            className="rounded-xl font-semibold hover:bg-primary hover:text-white transition-all shadow-sm"
                                            onClick={() => navigate(`/ride/${ride.id}`)}
                                        >
                                            Detalles
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default RideManagementTab;
