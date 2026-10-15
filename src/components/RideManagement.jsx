import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.jsx';
import { Card } from '@/components/ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import {
    AlertTriangle, BadgeCheck, CalendarDays, Check, Clock3, Edit3, Euro,
    MessageCircle, MessageSquare, Navigation, PlayCircle, Radio, Save,
    Trash2, UserCheck, UserMinus, UserPlus, Users, X
} from 'lucide-react';
import PinVerificationDialog from './PinVerificationDialog';
import {
    RIDE_RULES,
    acceptPassenger,
    cancelRide,
    completeRide,
    rejectPassenger,
    startRide,
    updateRide,
    verifyPassenger
} from '@/services/rideService';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { canPresentStartRide, getStartBlockReason, normalizeBoardingPin } from '@/utils/rideBoarding.js';

const toLocalDateInput = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const toLocalTimeInput = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const getRideDeparture = (ride) => ride?.departure_time || ride?.departureTime || new Date().toISOString();
const getRideSeats = (ride) => Number(ride?.seats_total ?? ride?.total_seats ?? ride?.seats ?? ride?.seats_available ?? 1);
const getRidePrice = (ride) => Number(ride?.price_per_seat ?? ride?.price ?? RIDE_RULES.MIN_PRICE);

const PassengerItem = ({ passenger, onVerify, onAccept, onReject, rideId }) => {
    const navigate = useNavigate();
    const isVerified = ['verified', 'on_board', 'completed'].includes(passenger.status);
    const isPending = passenger.status === 'pending';
    const isConfirmed = passenger.status === 'confirmed';
    const photoURL = passenger.photoURL || passenger.photo_url;

    return (
        <div className={cn(
            'flex flex-col p-4 rounded-3xl border mb-3 transition-all',
            isPending ? 'bg-indigo-50/30 border-indigo-100 ring-1 ring-indigo-50' : 'bg-white border-slate-100 shadow-sm'
        )}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Avatar className="h-12 w-12 border-2 border-white shadow-md">
                        <AvatarImage src={photoURL} />
                        <AvatarFallback className="font-black bg-slate-100 text-slate-400">{passenger.displayName?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="text-left flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <p className="font-black text-sm uppercase italic tracking-tighter text-slate-900 truncate">{passenger.displayName}</p>
                            {isVerified && <BadgeCheck size={14} className="text-emerald-500" />}
                        </div>
                        <p className={cn(
                            'text-[9px] font-black uppercase tracking-widest',
                            isVerified ? 'text-emerald-600' : isPending ? 'text-indigo-600 animate-pulse' : 'text-amber-600'
                        )}>
                            {isVerified ? 'En el vehículo' : isPending ? 'Solicitud Pendiente' : 'Reserva Confirmada'}
                        </p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button
                        size="icon"
                        variant="ghost"
                        className="size-10 rounded-xl bg-slate-50 text-slate-400 hover:text-primary hover:bg-primary/5"
                        onClick={() => navigate(`/ride-chat/${rideId}/${passenger.id}`)}
                    >
                        <MessageSquare size={18} />
                    </Button>

                    {isPending && (
                        <div className="flex gap-1.5">
                            <Button size="icon" onClick={() => onAccept(passenger)} className="size-10 rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-200 active:scale-90">
                                <UserCheck size={18} />
                            </Button>
                            <Button size="icon" onClick={() => onReject(passenger)} className="size-10 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 active:scale-90">
                                <UserMinus size={18} />
                            </Button>
                        </div>
                    )}

                    {isConfirmed && !isVerified && (
                        <Button onClick={() => onVerify(passenger)} className="h-10 px-4 rounded-xl bg-slate-900 text-white font-black text-[10px] uppercase shadow-lg active:scale-95">
                            VALIDAR PIN
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

const RideManagement = ({ ride, onRefresh }) => {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [isPinDialogOpen, setIsPinDialogOpen] = useState(false);
    const [selectedPassenger, setSelectedPassenger] = useState(null);
    const [currentCoords] = useState(null);
    const [distMeters, setDistMeters] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editDate, setEditDate] = useState('');
    const [editTime, setEditTime] = useState('');
    const [editSeats, setEditSeats] = useState(1);
    const [editPrice, setEditPrice] = useState(RIDE_RULES.MIN_PRICE);
    const [editDetails, setEditDetails] = useState('');
    const [editWomenOnly, setEditWomenOnly] = useState(false);

    const isRideStarted = ride.status === 'active' || ride.status === 'in_progress';
    const isRideScheduled = ride.status === 'scheduled';
    const startBlockReason = getStartBlockReason({ ride });
    const canStartRide = canPresentStartRide({ ride });

    const passengers = useMemo(() => ride.passengers || [], [ride.passengers]);
    const pendingRequests = useMemo(() => passengers.filter((p) => p.status === 'pending'), [passengers]);
    const onboardPassengers = useMemo(
        () => passengers.filter((p) => !['pending', 'cancelled', 'rejected'].includes(p.status)),
        [passengers]
    );
    const confirmedSeatCount = useMemo(
        () => onboardPassengers.filter((p) => ['confirmed', 'verified', 'on_board', 'completed'].includes(p.status)).length,
        [onboardPassengers]
    );

    useEffect(() => {
        const departure = getRideDeparture(ride);
        setEditDate(toLocalDateInput(departure));
        setEditTime(toLocalTimeInput(departure));
        setEditSeats(getRideSeats(ride));
        setEditPrice(getRidePrice(ride));
        setEditDetails(ride?.details || ride?.description || '');
        setEditWomenOnly(Boolean(ride?.is_women_only ?? ride?.isWomenOnly));
    }, [ride]);

    useEffect(() => {
        if (!currentCoords || !ride.destination?.coordinates) return;
        const dest = ride.destination.coordinates;
        const R = 6371e3;
        const phi1 = currentCoords.lat * Math.PI / 180;
        const phi2 = dest.lat * Math.PI / 180;
        const deltaPhi = (dest.lat - currentCoords.lat) * Math.PI / 180;
        const deltaLambda = (dest.lng - currentCoords.lng) * Math.PI / 180;
        const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2)
            + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        setDistMeters(Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))));
    }, [currentCoords, ride.destination]);

    const canCompleteRide = useMemo(() => {
        const verifiedCount = onboardPassengers.filter((p) => ['verified', 'on_board', 'completed'].includes(p.status)).length;
        return (distMeters !== null && distMeters <= 500)
            || (onboardPassengers.length > 0 && verifiedCount === onboardPassengers.length);
    }, [distMeters, onboardPassengers]);

    const resetEditor = () => {
        const departure = getRideDeparture(ride);
        setEditDate(toLocalDateInput(departure));
        setEditTime(toLocalTimeInput(departure));
        setEditSeats(getRideSeats(ride));
        setEditPrice(getRidePrice(ride));
        setEditDetails(ride?.details || ride?.description || '');
        setEditWomenOnly(Boolean(ride?.is_women_only ?? ride?.isWomenOnly));
        setIsEditing(false);
    };

    const handleAccept = async (passenger) => {
        setIsLoading(true);
        try {
            await acceptPassenger(ride.id, passenger.id);
            toast.success(`${passenger.displayName} aceptado`);
            onRefresh();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReject = async (passenger) => {
        if (!window.confirm('¿Rechazar esta solicitud?')) return;
        setIsLoading(true);
        try {
            await rejectPassenger(ride.id, passenger.id);
            onRefresh();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveSchedule = async () => {
        if (!editDate || !editTime) {
            toast.error('Selecciona la fecha y la hora del viaje.');
            return;
        }

        const departure = new Date(`${editDate}T${editTime}:00`);
        if (Number.isNaN(departure.getTime())) {
            toast.error('La fecha del viaje no es válida.');
            return;
        }

        const minimumDeparture = Date.now() + (RIDE_RULES.MIN_ADVANCE_MINUTES * 60 * 1000);
        if (departure.getTime() < minimumDeparture) {
            toast.error(`El viaje debe quedar programado con al menos ${RIDE_RULES.MIN_ADVANCE_MINUTES} minutos de antelación.`);
            return;
        }

        const seats = Number.parseInt(editSeats, 10);
        if (!Number.isInteger(seats) || seats < RIDE_RULES.MIN_SEATS || seats > RIDE_RULES.MAX_SEATS) {
            toast.error(`Las plazas deben estar entre ${RIDE_RULES.MIN_SEATS} y ${RIDE_RULES.MAX_SEATS}.`);
            return;
        }
        if (seats < confirmedSeatCount) {
            toast.error(`Ya tienes ${confirmedSeatCount} plaza${confirmedSeatCount === 1 ? '' : 's'} confirmada${confirmedSeatCount === 1 ? '' : 's'}.`);
            return;
        }

        const price = Number.parseFloat(String(editPrice).replace(',', '.'));
        if (!Number.isFinite(price) || price < RIDE_RULES.MIN_PRICE || price > RIDE_RULES.MAX_PRICE) {
            toast.error(`El precio debe estar entre ${RIDE_RULES.MIN_PRICE}€ y ${RIDE_RULES.MAX_PRICE}€.`);
            return;
        }

        setIsLoading(true);
        try {
            await updateRide(ride.id, {
                dateTime: departure,
                seats,
                price,
                details: editDetails.trim(),
                isWomenOnly: editWomenOnly
            });
            toast.success('Viaje actualizado', {
                description: 'La nueva fecha, hora y condiciones ya están guardadas.'
            });
            setIsEditing(false);
            await onRefresh();
        } catch (error) {
            toast.error(error.message || 'No se pudo actualizar el viaje');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancelRide = async () => {
        const warning = confirmedSeatCount > 0
            ? `Este viaje tiene ${confirmedSeatCount} pasajero${confirmedSeatCount === 1 ? '' : 's'} confirmado${confirmedSeatCount === 1 ? '' : 's'}. Se devolverá el 100% de cada pago; la penalización del conductor es 0€ (≥24 h), 2€ (2–<24 h) o 5€ (<2 h). Con pasajeros activos, el 50% compensa a los pasajeros y el 50% va a la plataforma; además puede aplicarse impacto reputacional. ¿Cancelar igualmente?`
            : '¿Seguro que quieres cancelar este viaje programado? Esta acción no se puede deshacer y el servidor aplicará la penalización vigente si corresponde.';

        if (!window.confirm(warning)) return;

        setIsLoading(true);
        try {
            const result = await cancelRide(ride.id, 'Cancelado por el conductor desde Gestión');
            toast.success('Viaje cancelado', {
                description: result?.refundsProcessed
                    ? 'Se han procesado los reembolsos asociados.'
                    : 'El viaje ya no está disponible para reservas.'
            });
            await onRefresh();
            navigate('/my-rides');
        } catch (error) {
            toast.error(error.message || 'No se pudo cancelar el viaje');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Card className="rounded-3xl border-none shadow-diamond bg-white p-4 sm:p-5 space-y-8 relative overflow-hidden">
            <div className="flex items-center justify-between">
                <div className="text-left">
                    <h3 className="font-black text-2xl text-slate-900 uppercase italic tracking-tighter leading-none">Gestión Élite</h3>
                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-1">Control del Conductor</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={() => navigate(`/ride-chat/${ride.id}`)} variant="outline" className="h-12 w-12 rounded-2xl border-2 border-orange-50 bg-orange-50/50 text-orange-600 shadow-sm">
                        <MessageCircle size={20} />
                    </Button>
                    {isRideStarted && (
                        <div className="flex items-center gap-2 px-4 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100 animate-pulse">
                            <Radio size={12} /> <span className="text-[10px] font-black uppercase">En Vivo</span>
                        </div>
                    )}
                </div>
            </div>

            {isRideScheduled && (
                <div className="rounded-3xl border border-slate-100 bg-slate-50/80 p-4 sm:p-5 space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                                <CalendarDays size={20} />
                            </div>
                            <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Viaje programado</p>
                                <p className="text-sm font-black text-slate-900">Edita horario, plazas y precio antes de salir</p>
                            </div>
                        </div>
                        {!isEditing && (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsEditing(true)}
                                disabled={isLoading}
                                className="h-11 rounded-2xl border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest"
                            >
                                <Edit3 size={15} className="mr-2" /> Editar viaje
                            </Button>
                        )}
                    </div>

                    {confirmedSeatCount > 0 && (
                        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                            <p className="text-[10px] font-bold leading-relaxed">
                                Hay reservas confirmadas. Los cambios sensibles quedan protegidos por el contrato del viaje y el servidor puede bloquearlos.
                            </p>
                        </div>
                    )}

                    {isEditing && (
                        <div className="space-y-4 rounded-[1.75rem] bg-white p-4 sm:p-5 shadow-sm">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className="space-y-1.5">
                                    <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
                                        <CalendarDays size={12} /> Fecha
                                    </span>
                                    <input
                                        type="date"
                                        value={editDate}
                                        onChange={(event) => setEditDate(event.target.value)}
                                        className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-900 outline-none focus:border-primary"
                                    />
                                </label>
                                <label className="space-y-1.5">
                                    <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
                                        <Clock3 size={12} /> Hora
                                    </span>
                                    <input
                                        type="time"
                                        value={editTime}
                                        onChange={(event) => setEditTime(event.target.value)}
                                        className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-900 outline-none focus:border-primary"
                                    />
                                </label>
                                <label className="space-y-1.5">
                                    <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
                                        <Users size={12} /> Plazas totales
                                    </span>
                                    <input
                                        type="number"
                                        min={Math.max(RIDE_RULES.MIN_SEATS, confirmedSeatCount)}
                                        max={RIDE_RULES.MAX_SEATS}
                                        value={editSeats}
                                        onChange={(event) => setEditSeats(event.target.value)}
                                        className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-900 outline-none focus:border-primary"
                                    />
                                </label>
                                <label className="space-y-1.5">
                                    <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">
                                        <Euro size={12} /> Precio por plaza
                                    </span>
                                    <input
                                        type="number"
                                        min={RIDE_RULES.MIN_PRICE}
                                        max={RIDE_RULES.MAX_PRICE}
                                        step="0.01"
                                        value={editPrice}
                                        onChange={(event) => setEditPrice(event.target.value)}
                                        className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-900 outline-none focus:border-primary"
                                    />
                                </label>
                            </div>

                            <label className="block space-y-1.5">
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Detalles del viaje</span>
                                <textarea
                                    rows={3}
                                    maxLength={1000}
                                    value={editDetails}
                                    onChange={(event) => setEditDetails(event.target.value)}
                                    placeholder="Punto de encuentro, equipaje, preferencias..."
                                    className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none focus:border-primary"
                                />
                            </label>

                            <button
                                type="button"
                                onClick={() => setEditWomenOnly((value) => !value)}
                                className={cn(
                                    'flex w-full items-center justify-between rounded-2xl border p-4 text-left transition-all',
                                    editWomenOnly ? 'border-primary bg-primary/5' : 'border-slate-200 bg-slate-50'
                                )}
                            >
                                <div>
                                    <p className="text-xs font-black uppercase tracking-tight text-slate-900">Solo mujeres</p>
                                    <p className="mt-1 text-[10px] font-medium text-slate-500">Mantiene la preferencia de seguridad del viaje.</p>
                                </div>
                                <div className={cn(
                                    'flex h-8 w-8 items-center justify-center rounded-xl',
                                    editWomenOnly ? 'bg-primary text-white' : 'bg-white text-slate-300'
                                )}>
                                    {editWomenOnly ? <Check size={16} /> : <X size={16} />}
                                </div>
                            </button>

                            <div className="grid grid-cols-2 gap-3">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={resetEditor}
                                    disabled={isLoading}
                                    className="h-12 rounded-2xl border-slate-200 text-[10px] font-black uppercase tracking-widest"
                                >
                                    <X size={15} className="mr-2" /> Cerrar
                                </Button>
                                <Button
                                    type="button"
                                    onClick={handleSaveSchedule}
                                    disabled={isLoading}
                                    className="h-12 rounded-2xl bg-primary text-white text-[10px] font-black uppercase tracking-widest"
                                >
                                    <Save size={15} className="mr-2" /> {isLoading ? 'Guardando...' : 'Guardar cambios'}
                                </Button>
                            </div>
                        </div>
                    )}

                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancelRide}
                        disabled={isLoading}
                        className="h-12 w-full rounded-2xl border-red-100 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 text-[10px] font-black uppercase tracking-widest"
                    >
                        <Trash2 size={15} className="mr-2" /> Cancelar viaje programado
                    </Button>
                </div>
            )}

            {pendingRequests.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 px-2">
                        <UserPlus size={14} className="text-indigo-500" />
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Solicitudes por Aprobar ({pendingRequests.length})</h4>
                    </div>
                    {pendingRequests.map((passenger) => (
                        <PassengerItem key={passenger.id} passenger={passenger} rideId={ride.id} onAccept={handleAccept} onReject={handleReject} />
                    ))}
                </div>
            )}

            <div className="space-y-4">
                <div className="flex items-center gap-2 px-2">
                    <Users size={14} className="text-slate-400" />
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pasajeros del Viaje ({onboardPassengers.length})</h4>
                </div>
                {onboardPassengers.length > 0 ? (
                    onboardPassengers.map((passenger) => (
                        <PassengerItem
                            key={passenger.id}
                            passenger={passenger}
                            rideId={ride.id}
                            onVerify={(pax) => {
                                setSelectedPassenger(pax);
                                setIsPinDialogOpen(true);
                            }}
                        />
                    ))
                ) : (
                    <div className="p-8 text-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-100">
                        <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest leading-relaxed">No hay pasajeros confirmados<br />todavía.</p>
                    </div>
                )}
            </div>

            <div className="pt-4 space-y-4">
                {isRideScheduled && (
                    <Button
                        onClick={async () => {
                            try {
                                const reason = getStartBlockReason({ ride });
                                if (reason) {
                                    toast.error(reason);
                                    return;
                                }
                                setIsLoading(true);
                                await startRide(ride.id);
                                onRefresh();
                            } catch (error) {
                                toast.error(error.message || 'No se pudo iniciar el viaje');
                            } finally {
                                setIsLoading(false);
                            }
                        }}
                        disabled={!canStartRide || isLoading}
                        className={cn(
                            'w-full h-14 rounded-3xl font-black text-xl uppercase italic shadow-2xl active:scale-95 transition-all border-none',
                            canStartRide ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        )}
                    >
                        {canStartRide ? (
                            <>INICIAR VIAJE <PlayCircle className="ml-3 text-primary h-6 w-6" /></>
                        ) : (
                            startBlockReason || 'NO SE PUEDE INICIAR'
                        )}
                    </Button>
                )}

                {isRideStarted && (
                    <div className="space-y-4">
                        {distMeters !== null && (
                            <div className={cn(
                                'p-6 rounded-3xl border-2 flex items-center justify-between',
                                distMeters <= 500 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-100'
                            )}>
                                <div className="text-left">
                                    <p className="text-[9px] font-black uppercase text-slate-400">Distancia al destino</p>
                                    <p className="font-black text-2xl italic text-slate-900">{distMeters > 1000 ? `${(distMeters / 1000).toFixed(1)} km` : `${distMeters} m`}</p>
                                </div>
                                <Navigation size={24} className={distMeters <= 500 ? 'text-emerald-500 animate-bounce' : 'text-slate-300'} />
                            </div>
                        )}
                        <Button
                            onClick={async () => {
                                try {
                                    setIsLoading(true);
                                    await completeRide(ride.id);
                                    navigate('/my-rides');
                                } catch (error) {
                                    toast.error(error.message || 'No se pudo finalizar el viaje');
                                } finally {
                                    setIsLoading(false);
                                }
                            }}
                            disabled={!canCompleteRide || isLoading}
                            className={cn(
                                'w-full h-14 rounded-3xl font-black text-xl uppercase italic shadow-2xl transition-all border-none',
                                !canCompleteRide ? 'bg-slate-100 text-slate-300' : 'bg-emerald-600 text-white'
                            )}
                        >
                            {canCompleteRide ? 'FINALIZAR Y COBRAR' : 'BLOQUEADO HASTA DESTINO'}
                        </Button>
                    </div>
                )}
            </div>

            <PinVerificationDialog
                open={isPinDialogOpen}
                onOpenChange={setIsPinDialogOpen}
                onConfirm={async (pin) => {
                    if (!selectedPassenger?.id) return;
                    try {
                        await verifyPassenger(ride.id, selectedPassenger.id, normalizeBoardingPin(pin));
                        toast.success(`${selectedPassenger.displayName || 'Pasajero'} verificado`);
                        setIsPinDialogOpen(false);
                        onRefresh();
                    } catch (error) {
                        const message = error.message?.includes('PIN_INCORRECTO')
                            ? 'PIN incorrecto. Solicítalo de nuevo al pasajero.'
                            : (error.message || 'Error al verificar PIN');
                        toast.error(message);
                    }
                }}
            />
        </Card>
    );
};

export default RideManagement;
