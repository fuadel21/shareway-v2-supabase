import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import { format, differenceInMinutes, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';

import SubPageHeader from './SubPageHeader';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import MapComponent from './MapComponent';
import ShareRideCard from './share/ShareRideCard.jsx';
import SimpleBookingModal from './SimpleBookingModal';
import PinVerificationDialog from './PinVerificationDialog.jsx';
import RideRatingModal from './RideRatingModal.jsx';
import { Button } from './ui/button.jsx';
import { Card } from './ui/card.jsx';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar.jsx';
import {
    Loader2, Users, Calendar, Clock, MapPin,
    ShieldCheck, Star, Car, Heart, Music,
    ChevronRight, BadgeCheck, MessageCircle, Lock,
    Play, CheckCircle2, AlertCircle, XCircle, Navigation, Fingerprint,
    ShieldAlert, UserX
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { supabase } from '../lib/supabase.js';
import { useDriverTracking } from '../hooks/useDriverTracking.js';
import { getRideDetailsSecure, getRideStartReadiness, getMyRidePin, startRide, verifyPassenger, handlePassengerNoShow, getOrCreateChat } from '../lib/supabaseRPC.js';
import { cancelRide, cancelBooking, completeRide as completeRideService, isRideBookable } from '../services/rideService.js';
import { calculateRefundAmount } from '../services/bookingService.js';
import { triggerSOS } from '../services/safetyService.js';
import { canPresentStartRide, getStartBlockReason, normalizeBoardingPin } from '../utils/rideBoarding.js';

const formatMoney = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return null;
    return `${numericValue.toFixed(2)}€`;
};

const formatRating = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return 'Nuevo';
    return numericValue.toFixed(1);
};

const getPassengerName = (passenger) => passenger?.displayName || passenger?.display_name || 'Pasajero';
const getPassengerAvatar = (passenger) => passenger?.avatarUrl || passenger?.avatar_url || passenger?.photo_url;

const RideDetails = () => {
    const { id: rideId } = useParams();
    const navigate = useNavigate();
    const { user } = useOutletContext();
    const [ride, setRide] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [isCompleting, setIsCompleting] = useState(false);
    const [isDroppingOff, setIsDroppingOff] = useState(false);
    const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [hasAutoOpenedRating, setHasAutoOpenedRating] = useState(false);
    const [isPinDialogOpen, setIsPinDialogOpen] = useState(false);
    const [selectedPassenger, setSelectedPassenger] = useState(null);
    const [isVerifying, setIsVerifying] = useState(false);
    const [selectedPickupLocation, setSelectedPickupLocation] = useState(null);
    const [isSOSLoading, setIsSOSLoading] = useState(false);
    const [secureAction, setSecureAction] = useState(null);
    const [isSecureActionLoading, setIsSecureActionLoading] = useState(false);
    const [startReadiness, setStartReadiness] = useState(null);
    const [fetchedPin, setFetchedPin] = useState(null);
    const [driverLocation, setDriverLocation] = useState(null);
    const { isTracking, startTracking, stopTracking } = useDriverTracking(rideId);

    const currentUserId = user?.id?.toString()?.toLowerCase();
    const driverId = ride?.driver_id?.toString()?.toLowerCase();
    const isDriver = Boolean(currentUserId && driverId && currentUserId === driverId);
    const passengersForTracking = Array.isArray(ride?.passengers)
        ? ride.passengers.filter((passenger) => passenger.status !== 'cancelled')
        : [];
    const isPassenger = Boolean(currentUserId && (
        (Array.isArray(ride?.participant_ids) && ride.participant_ids.some(
            (participantId) => participantId?.toString()?.toLowerCase() === currentUserId,
        ))
        || passengersForTracking.some((passenger) => {
            const passengerId = passenger.id || passenger.user_id || passenger.passenger_id;
            return passengerId?.toString()?.toLowerCase() === currentUserId;
        })
    ));
    const isRideActive = ride?.status === 'active' || ride?.status === 'in_progress';
    const mapItems = useMemo(() => {
        if (!ride) return [];
        if (!driverLocation) return [ride];

        return [
            ride,
            {
                id: `${ride.id}-live-location`,
                type: 'live-location',
                current_location: driverLocation,
                driver_photo_url: ride.driver?.avatar_url || ride.driver?.photo_url,
            },
        ];
    }, [ride, driverLocation]);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (isDriver && isRideActive) {
            startTracking();
        } else {
            stopTracking();
        }

        return () => stopTracking();
    }, [isDriver, isRideActive, startTracking, stopTracking]);

    useEffect(() => {
        if (!rideId || !isRideActive || (!isDriver && !isPassenger)) {
            setDriverLocation(null);
            return undefined;
        }

        let mounted = true;
        const applyLocation = (row) => {
            const latitude = Number(row?.latitude);
            const longitude = Number(row?.longitude);
            if (!mounted || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
            setDriverLocation({
                lat: latitude,
                lng: longitude,
                heading: Number.isFinite(Number(row?.heading)) ? Number(row.heading) : 0,
                updated_at: row?.updated_at || null,
            });
        };

        const loadInitialLocation = async () => {
            const { data, error } = await supabase
                .from('ride_locations')
                .select('latitude, longitude, heading, updated_at')
                .eq('ride_id', rideId)
                .maybeSingle();

            if (!error && data) applyLocation(data);
        };

        loadInitialLocation();

        const channel = supabase
            .channel(`ride_details_location_${rideId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'ride_locations',
                filter: `ride_id=eq.${rideId}`,
            }, (payload) => applyLocation(payload.new))
            .subscribe();

        return () => {
            mounted = false;
            supabase.removeChannel(channel);
        };
    }, [rideId, isRideActive, isDriver, isPassenger]);

    const fetchRide = useCallback(async () => {
        if (!rideId || rideId === 'undefined') return;

        setLoading(true);
        try {
            const response = await getRideDetailsSecure(rideId);
            const rpcPayload = response.data;
            const rideData = rpcPayload?.success === false
                ? null
                : (rpcPayload?.data || rpcPayload);
            if (rideData?.id || rideData?.driver_id) {
                let nextRide = rideData;
                const isCurrentDriver = user?.id && String(rideData.driver_id) === String(user.id);
                const myEntry = rideData.passengers?.find(
                    p => p.id?.toString().toLowerCase() === user?.id?.toString().toLowerCase()
                );

                if (isCurrentDriver && rideData.status === 'scheduled') {
                    try {
                        const readinessResponse = await getRideStartReadiness(rideId);
                        if (readinessResponse?.success) {
                            setStartReadiness(readinessResponse.data);
                        } else {
                            setStartReadiness({
                                ready: false,
                                unavailable: true,
                                error: readinessResponse?.error || 'No se pudo comprobar el embarque.',
                            });
                        }
                    } catch (readinessError) {
                        setStartReadiness({
                            ready: false,
                            unavailable: true,
                            error: readinessError?.message || 'No se pudo comprobar el embarque.',
                        });
                    }

                    try {
                        const unpaidResponse = await supabase
                            .from('ride_requests')
                            .select('id,status,requester_id')
                            .eq('ride_id', rideId)
                            .in('status', ['pending', 'requested', 'awaiting_payment', 'processing', 'unpaid']);

                        if (!unpaidResponse.error && Array.isArray(unpaidResponse.data)) {
                            nextRide = { ...rideData, ride_requests: unpaidResponse.data };
                        }
                    } catch (requestError) {
                        console.warn('No se pudieron cargar reservas pendientes:', requestError);
                    }
                } else {
                    setStartReadiness(null);
                }

                if (myEntry && !['verified', 'completed'].includes(String(myEntry.status || '').toLowerCase())) {
                    try {
                        const pinResponse = await getMyRidePin(rideId);
                        const pinValue = pinResponse?.data?.pin || pinResponse?.data?.data?.pin || rideData.user_pin;
                        if (pinValue) setFetchedPin(pinValue);
                    } catch (pinError) {
                        console.warn('No se pudo cargar el PIN del pasajero:', pinError);
                    }
                }

                setRide(nextRide);

                if (rideData.status === 'completed' &&
                    myEntry?.status === 'verified' &&
                    !myEntry?.rated &&
                    !hasAutoOpenedRating) {
                    setIsRatingModalOpen(true);
                    setHasAutoOpenedRating(true);
                }
            }
        } catch (err) {
            console.error('Error fetching ride:', err);
            toast.error('No se pudo cargar el viaje');
        } finally {
            setLoading(false);
        }
    }, [rideId, user?.id, hasAutoOpenedRating]);

    useEffect(() => {
        if (!rideId) return;

        fetchRide();

        const channel = supabase
            .channel(`ride_updates_${rideId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'rides',
                filter: `id=eq.${rideId}`
            }, () => {
                fetchRide();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [rideId, fetchRide]);

    const openSecureAction = useCallback((config) => {
        setSecureAction(config);
    }, []);

    const handleSecureActionConfirm = async () => {
        if (!secureAction?.onConfirm || isSecureActionLoading) return;

        setIsSecureActionLoading(true);
        try {
            await secureAction.onConfirm();
            setSecureAction(null);
        } catch (error) {
            toast.error(secureAction.errorTitle || 'No se pudo completar la acción', {
                description: error.message || 'Error inesperado',
            });
        } finally {
            setIsSecureActionLoading(false);
        }
    };

    const handleStartRide = async () => {
        const reason = getStartBlockReason({ ride, now: new Date(), readiness: startReadiness });
        if (reason) {
            toast.error('No se puede iniciar el viaje', { description: reason });
            return;
        }

        setIsStarting(true);
        try {
            const { success, error } = await startRide(rideId);
            if (!success) throw new Error(error);
            toast.success('¡Viaje iniciado! Buen camino.');
            startTracking();
            fetchRide();
        } catch (error) {
            toast.error(error.message || 'No se pudo iniciar');
        } finally {
            setIsStarting(false);
        }
    };

    const handleCompleteRide = async () => {
        setIsCompleting(true);
        try {
            const result = await completeRideService(rideId);
            if (!result?.success) {
                throw new Error(result?.error || result?.message || 'Error inesperado al finalizar');
            }

            stopTracking();

            const payoutLabel = formatMoney(result.payout);
            const platformFeeLabel = formatMoney(result.platformFee);
            const totalGrossLabel = result.payout != null && result.platformFee != null
                ? formatMoney(Number(result.payout) + Number(result.platformFee))
                : null;

            toast.success('¡Viaje finalizado con éxito!', {
                description: payoutLabel ? (
                    <div className="mt-2 space-y-1 border-t border-emerald-100 pt-2">
                        {totalGrossLabel && (
                            <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                <span>Total Bruto:</span>
                                <span>{totalGrossLabel}</span>
                            </div>
                        )}
                        {platformFeeLabel && (
                            <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                <span>Comisión Plataforma:</span>
                                <span>{platformFeeLabel}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-xs font-black uppercase italic text-emerald-600 pt-1 border-t border-dashed border-emerald-100">
                            <span>Tu Ganancia Neta:</span>
                            <span>{payoutLabel}</span>
                        </div>
                    </div>
                ) : 'La liquidación se actualizará cuando el servidor confirme los importes.',
                duration: 6000,
            });

            setTimeout(() => {
                setIsRatingModalOpen(true);
            }, 1000);

            fetchRide();
        } catch (error) {
            console.error('🔴 Error en handleCompleteRide:', error);
            toast.error('No se pudo finalizar el viaje', {
                description: error.message || 'Error de conexión con el servidor'
            });
        } finally {
            setIsCompleting(false);
        }
    };

    const handleVerifyPin = async (pin) => {
        setIsVerifying(true);
        try {
            const cleanPin = normalizeBoardingPin(pin);
            const res = await verifyPassenger(rideId, cleanPin, selectedPassenger?.id ?? null);
            const failureText = `${res.error || ''} ${res.message || ''} ${res.data?.error || ''} ${res.data?.message || ''}`;

            if (!res.success) {
                if (failureText.includes('DEMASIADO_PRONTO') || failureText.includes('antes de la salida')) {
                    toast.error('¡Es demasiado pronto!', {
                        description: 'Solo puedes verificar el PIN del pasajero 15 minutos antes de la hora de salida programada.',
                        duration: 5000
                    });
                    setIsPinDialogOpen(false);
                    return;
                }

                if (failureText.includes('PIN_INCORRECTO') || failureText.includes('incorrecto')) {
                    throw new Error('El PIN introducido no coincide. Solicítalo de nuevo al pasajero.');
                }
                throw new Error(res.error || res.message || res.data?.message || 'Error al verificar');
            }

            toast.success(`¡${getPassengerName(selectedPassenger)} verificado!`, {
                description: 'Ya puede subir al vehículo.',
                icon: <BadgeCheck className="text-emerald-500" />
            });
            setIsPinDialogOpen(false);
            await fetchRide();
        } catch (error) {
            toast.error('Error de verificación', { description: error.message });
        } finally {
            setIsVerifying(false);
        }
    };

    const performCancelRide = async () => {
        setIsCancelling(true);
        try {
            const result = await cancelRide(rideId);
            if (result.success) {
                stopTracking();
                const penaltyLabel = formatMoney(result.driverPenalty);
                const compensationLabel = formatMoney(result.passengerCompensationTotal);
                const platformPenaltyLabel = formatMoney(result.platformPenalty);
                toast.success('Viaje cancelado correctamente', {
                    description: penaltyLabel
                        ? `Penalización aplicada: ${penaltyLabel}${compensationLabel ? ` · Compensación a pasajeros: ${compensationLabel}` : ''}${platformPenaltyLabel ? ` · Plataforma: ${platformPenaltyLabel}` : ''}.`
                        : 'Se han procesado los reembolsos y las compensaciones según la política vigente.',
                });
                fetchRide();
            } else {
                throw new Error(result.message || 'Error al cancelar');
            }
        } finally {
            setIsCancelling(false);
        }
    };

    const askCancelRide = () => {
        const departureTimestamp = new Date(ride?.departure_time).getTime();
        const hoursUntilDeparture = Number.isFinite(departureTimestamp)
            ? (departureTimestamp - Date.now()) / 3600000
            : null;
        const driverPenalty = hoursUntilDeparture == null
            ? 0
            : hoursUntilDeparture < 2 ? 5 : hoursUntilDeparture < 24 ? 2 : 0;
        const activePassengerCount = passengers.filter((passenger) => [
            'confirmed', 'accepted', 'pending_boarding', 'verified', 'on_board', 'confirmed_by_pin',
        ].includes(String(passenger?.status || '').toLowerCase())).length;
        const passengerCompensation = activePassengerCount > 0 ? driverPenalty / 2 : 0;
        const platformPenalty = driverPenalty - passengerCompensation;
        const reputationImpact = driverPenalty === 0
            ? 'sin penalización reputacional'
            : hoursUntilDeparture < 2 ? '−20 confianza y −0,5 de valoración' : '−10 confianza y −0,2 de valoración';

        openSecureAction({
            tone: 'danger',
            title: '¿Cancelar este viaje?',
            description: `Esta acción devolverá el 100% a cada pasajero. Penalización económica del conductor: ${driverPenalty.toFixed(2)}€. Plataforma: ${platformPenalty.toFixed(2)}€; compensación a pasajeros: ${passengerCompensation.toFixed(2)}€. Impacto reputacional: ${reputationImpact}.`,
            confirmLabel: 'Sí, cancelar viaje',
            errorTitle: 'No se pudo cancelar el viaje',
            onConfirm: performCancelRide,
        });
    };

    const handleTriggerSOS = () => {
        openSecureAction({
            tone: 'danger',
            title: '¿Activar emergencia SOS?',
            description: 'Usa esta acción solo si estás en peligro. Se abrirá el canal de emergencia y se registrará la incidencia para soporte y contactos configurados.',
            confirmLabel: 'Activar SOS',
            errorTitle: 'No se pudo activar SOS',
            onConfirm: async () => {
                setIsSOSLoading(true);
                try {
                    const result = await triggerSOS(rideId);
                    if (!result?.success) throw new Error(result?.message || result?.error || 'El servidor no confirmó el SOS');
                    navigate(`/emergency/${rideId}`);
                } finally {
                    setIsSOSLoading(false);
                }
            },
        });
    };

    const handleOpenPrivateChat = async (otherUserId) => {
        try {
            const { data, success, error } = await getOrCreateChat(otherUserId, rideId);
            if (!success) throw new Error(error);
            if (data?.chatId) {
                navigate(`/rides/${rideId}/chat/${data.chatId}`);
            } else {
                throw new Error('No se pudo obtener el ID del chat');
            }
        } catch (error) {
            toast.error('No se pudo abrir la conversación');
            console.error('Chat error:', error);
        }
    };

    const onPassengerNoShow = (passenger) => {
        const passengerName = getPassengerName(passenger);
        openSecureAction({
            tone: 'danger',
            title: '¿Marcar pasajero como no presentado?',
            description: `Confirma solo si ${passengerName} no ha acudido al punto acordado. Esta acción es irreversible y puede aplicar penalización económica.`,
            confirmLabel: 'Confirmar no-show',
            errorTitle: 'No se pudo registrar el no-show',
            onConfirm: async () => {
                const res = await handlePassengerNoShow(rideId, passenger.id);
                if (res.success) {
                    const payoutLabel = formatMoney(res.data?.payout);
                    toast.success('No-show registrado', {
                        description: payoutLabel ? `Se ha procesado tu compensación de ${payoutLabel}` : 'El servidor ha registrado la incidencia.'
                    });
                    fetchRide();
                } else {
                    throw new Error(res.error || 'No se pudo procesar el no-show');
                }
            },
        });
    };

    const handlePassengerDropoff = (passenger) => {
        const passengerName = getPassengerName(passenger);
        openSecureAction({
            tone: 'success',
            title: '¿Finalizar esta parada?',
            description: `Confirma que has dejado a ${passengerName} en su destino. Al confirmar, se intentará liberar su pago inmediatamente.`,
            confirmLabel: 'Finalizar parada',
            errorTitle: 'No se pudo procesar la entrega',
            onConfirm: async () => {
                setIsDroppingOff(true);
                try {
                    const { data, error } = await supabase.rpc('complete_passenger_dropoff', {
                        p_ride_id: rideId,
                        p_passenger_id: passenger.id
                    });

                    if (error) throw error;

                    if (data?.success) {
                        toast.success(`¡Pago de ${passengerName} liberado!`, {
                            icon: <CheckCircle2 className="text-emerald-500" />
                        });
                        fetchRide();
                    } else {
                        throw new Error(data?.error || 'Error al procesar la entrega');
                    }
                } finally {
                    setIsDroppingOff(false);
                }
            },
        });
    };

    const askCancelBooking = () => {
        const refundEstimate = calculateRefundAmount(ride, myPassengerEntry);
        const estimatedRefund = formatMoney(refundEstimate.amount) || '0.00€';
        const estimatedTotal = formatMoney(refundEstimate.total) || 'el importe almacenado';
        const estimatedPenalty = Math.max(0, Number(refundEstimate.total || 0) - Number(refundEstimate.amount || 0));
        const estimatedDriverShare = estimatedPenalty * 0.80;
        const estimatedPlatformShare = estimatedPenalty - estimatedDriverShare;
        openSecureAction({
            tone: 'danger',
            title: '¿Cancelar tu reserva?',
            description: `Reembolso estimado: ${estimatedRefund} (${refundEstimate.percentage}% de ${estimatedTotal}). Parte no reembolsada: ${formatMoney(estimatedPenalty)}; conductor: ${formatMoney(estimatedDriverShare)} y plataforma: ${formatMoney(estimatedPlatformShare)}. La política es 100% con más de 24 h, 50% entre 2 h y 24 h y 0% con menos de 2 h. El servidor volverá a calcularlo usando tu pago y tus plazas antes de mover fondos.`,
            confirmLabel: 'Cancelar reserva',
            errorTitle: 'No se pudo cancelar la reserva',
            onConfirm: async () => {
                const res = await cancelBooking(rideId);
                if (res === true || res?.success) {
                    const refundLabel = formatMoney(res?.refunded);
                    const penaltyLabel = formatMoney(res?.penalty);
                    const driverShareLabel = formatMoney(res?.driverCompensation);
                    const platformShareLabel = formatMoney(res?.platformPenalty);
                    toast.success('Reserva cancelada', {
                        description: refundLabel
                            ? `Reembolso procesado: ${refundLabel}${Number(res?.penalty || 0) > 0 ? ` · Parte no reembolsada: ${penaltyLabel || '0.00€'} · Conductor: ${driverShareLabel || '0.00€'} · Plataforma: ${platformShareLabel || '0.00€'}` : ''}.`
                            : 'El servidor ha aplicado la política de reembolso a tu pago almacenado.',
                    });
                    fetchRide();
                    return;
                }
                throw new Error(res?.message || 'No se pudo cancelar');
            },
        });
    };

    if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-primary" /></div>;
    if (!ride) return <SubPageHeader title="No encontrado" backPath="/dashboard" />;

    const passengers = passengersForTracking;
    const confirmedPassengers = passengers.filter(p => ['confirmed', 'verified', 'completed'].includes(p.status));
    const isRideCancelled = ride.status === 'cancelled';
    const isRideClosed = ride.status === 'completed' || ride.status === 'cancelled' || ride.status === 'expired';

    const departureDate = new Date(ride.departure_time);
    const hasValidDeparture = Number.isFinite(departureDate.getTime());
    const hasDeparted = hasValidDeparture && departureDate <= currentTime;
    const minutesToDeparture = differenceInMinutes(departureDate, currentTime);
    const isTooLate = differenceInMinutes(currentTime, departureDate) > 120;
    const isDelayed = ride.status === 'scheduled' && hasDeparted && !isTooLate;
    const startBlockReason = getStartBlockReason({ ride, now: currentTime, readiness: startReadiness });
    const canStartRide = isDriver && canPresentStartRide({ ride, now: currentTime, readiness: startReadiness });
    const isStartWindowOpen = ride.status === 'scheduled' && (minutesToDeparture <= 15 || hasDeparted) && !isRideActive && !isRideCancelled && !isTooLate;
    const canVerifyPassenger = isRideActive || isStartWindowOpen;
    const isRideBookableNow = isRideBookable(ride, currentTime);
    const myPassengerEntry = passengers.find(p => p.id?.toString().toLowerCase() === currentUserId);
    const isRated = myPassengerEntry?.rated === true || myPassengerEntry?.rated === 'true';
    const rawPin = fetchedPin || ride.user_pin || myPassengerEntry?.pin;
    const myPin = rawPin && String(rawPin).replace(/\*/g, '') ? rawPin : null;
    const ridePrice = formatMoney(ride.price) || '0.00€';
    const ridePricing = ride?.pricing || {};
    const platformFeePerSeat = formatMoney(ridePricing.platform_fee_per_seat);
    const driverPayoutPerSeat = formatMoney(ridePricing.driver_payout_per_seat);
    const seatsAvailable = Number(ride.seats_available ?? ride.available_seats ?? 0);

    const bookingBlockedLabel = (() => {
        if (isRideCancelled) return 'Viaje Cancelado';
        if (ride.status === 'completed') return 'Viaje Finalizado';
        if (ride.status === 'expired' || isTooLate) return 'Viaje Expirado';
        if (hasDeparted) return 'Viaje ya salido';
        if (seatsAvailable <= 0) return 'Viaje Completo';
        if (ride.status !== 'scheduled') return 'No Disponible';
        return 'No Disponible';
    })();

    const bookingBlockedDescription = (() => {
        if (isRideCancelled) return 'Este viaje ha sido cancelado y ya no acepta reservas.';
        if (ride.status === 'completed') return 'Este viaje ya ha finalizado.';
        if (ride.status === 'expired' || isTooLate || hasDeparted) return 'Este viaje ya ha salido o ha expirado.';
        if (seatsAvailable <= 0) return 'No quedan plazas disponibles en este viaje.';
        return 'Este viaje ya no está disponible para reservar.';
    })();

    const handleOpenBookingModal = () => {
        if (!isRideBookableNow) {
            toast.error('Reserva no disponible', {
                description: bookingBlockedDescription,
                duration: 5000,
            });
            fetchRide();
            return;
        }

        setIsBookingModalOpen(true);
    };

    return (
        <div className="bg-[#F8FAFC] min-h-screen pb-96">
            <SubPageHeader
                title="Detalles del Viaje"
                actions={(isDriver || isPassenger) && (
                    <button
                        onClick={() => navigate(`/rides/${rideId}/chats`)}
                        className="h-11 w-11 rounded-2xl bg-primary shadow-lg flex items-center justify-center text-white active:scale-95 transition-all"
                        title="Conversaciones"
                    >
                        <MessageCircle size={20} />
                    </button>
                )}
            />

            <main className="max-w-xl mx-auto px-4 mt-6 space-y-6 animate-in fade-in duration-500">
                {isRideCancelled && (
                    <div className="bg-red-50 border-2 border-red-100 rounded-3xl p-6 flex items-center gap-4 text-red-600">
                        <XCircle size={32} className="shrink-0" />
                        <div>
                            <p className="font-black uppercase italic leading-none">Viaje Cancelado</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest mt-1 opacity-70">Este viaje ya no está disponible</p>
                        </div>
                    </div>
                )}

                {!isDriver && !isPassenger && !isRideBookableNow && !isRideCancelled && (
                    <div className="bg-amber-50 border-2 border-amber-100 rounded-3xl p-6 flex items-center gap-4 text-amber-700">
                        <AlertCircle size={32} className="shrink-0" />
                        <div>
                            <p className="font-black uppercase italic leading-none">{bookingBlockedLabel}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest mt-1 opacity-70">{bookingBlockedDescription}</p>
                        </div>
                    </div>
                )}

                <div className="h-56 w-full rounded-3xl overflow-hidden shadow-xl border-4 border-white relative group">
                    <MapComponent
                        center={isRideActive && driverLocation ? driverLocation : (selectedPickupLocation || ride.origin)}
                        itemsToDisplay={mapItems}
                        zoom={12}
                        followLocation={isRideActive && Boolean(driverLocation)}
                        interactive={true}
                        pickupLocation={selectedPickupLocation}
                        onLocationSelect={(loc) => {
                            if (!isPassenger && isRideBookableNow) {
                                setSelectedPickupLocation(loc);
                                toast.info('Punto de recogida seleccionado', {
                                    description: 'Se usará esta ubicación al reservar.',
                                    duration: 2000
                                });
                            }
                        }}
                    />
                    {isRideActive && (
                        <div className="absolute top-4 left-4 bg-white/95 backdrop-blur px-3 py-1.5 rounded-xl border border-emerald-100 flex items-center gap-1.5 shadow-sm z-[10] pointer-events-none">
                            <span className={`size-2 rounded-full ${driverLocation ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
                            <span className="text-[9px] font-black uppercase text-slate-900 tracking-tighter">
                                {driverLocation
                                    ? (isTracking ? 'Conductor en tiempo real' : 'Ubicación del conductor')
                                    : 'Esperando ubicación del conductor'}
                            </span>
                        </div>
                    )}
                    {!isPassenger && isRideBookableNow && (
                        <div className="absolute top-4 right-4 bg-white/90 backdrop-blur px-3 py-1.5 rounded-xl border border-slate-100 flex items-center gap-1.5 shadow-sm z-[10] pointer-events-none">
                            <MapPin className="size-3 text-primary animate-pulse" />
                            <span className="text-[9px] font-black uppercase text-slate-900 tracking-tighter">Toca el mapa para elegir recogida</span>
                        </div>
                    )}
                    {isRideActive && (isDriver || isPassenger) && (
                        <button
                            onClick={handleTriggerSOS}
                            disabled={isSOSLoading}
                            className="absolute bottom-4 right-4 bg-red-600 hover:bg-red-700 text-white p-3 rounded-2xl shadow-lg shadow-red-500/40 flex items-center gap-2 transition-all active:scale-95 z-[20] disabled:opacity-50"
                        >
                            {isSOSLoading ? <Loader2 className="size-5 animate-spin" /> : <ShieldAlert size={20} />}
                            <span className="text-[10px] font-black uppercase tracking-widest">SOS</span>
                        </button>
                    )}
                </div>

                {(ride.status === 'scheduled' || isRideActive) && (isDriver || isPassenger) && (
                    <ShareRideCard ride={ride} rideId={rideId} />
                )}

                <Card className="rounded-3xl border-none shadow-2xl bg-white p-5 space-y-6">
                    <div className="flex justify-between items-start gap-4">
                        <div className="text-left space-y-1 min-w-0">
                            <div className="flex items-center gap-2 text-primary font-black uppercase tracking-[0.2em] text-[10px]">
                                <Calendar size={12} className="shrink-0" />
                                <span className="truncate">{ride.departure_time ? format(new Date(ride.departure_time), "EEEE d 'de' MMMM", { locale: es }) : 'Fecha pendiente'}</span>
                            </div>
                            <h2 className={cn(
                                'text-4xl font-black tracking-tighter italic leading-none pt-1 transition-colors',
                                isDelayed ? 'text-amber-500' : 'text-slate-900'
                            )}>
                                {ride.departure_time ? format(new Date(ride.departure_time), 'HH:mm') : '--:--'}
                            </h2>
                            {isDelayed && !isTooLate && (
                                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase text-amber-500 animate-pulse">
                                    <AlertCircle size={10} /> Salida con retraso
                                </div>
                            )}
                            {isTooLate && (
                                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase text-red-500">
                                    <XCircle size={10} /> Viaje expirado
                                </div>
                            )}
                        </div>
                        <div className="text-right shrink-0">
                            <div className="bg-emerald-50 text-emerald-600 px-4 py-3 rounded-2xl inline-block border border-emerald-100 shadow-sm">
                                <span className="text-[9px] font-black uppercase block leading-none opacity-60 tracking-widest mb-1.5">Precio por plaza</span>
                                <span className="text-3xl font-black tracking-tighter leading-none">{ridePrice}</span>
                                <span className="text-[8px] font-bold uppercase tracking-widest opacity-50 block mt-1">Comisión incluida</span>
                            </div>
                        </div>
                    </div>
                    {(platformFeePerSeat || driverPayoutPerSeat) && (
                        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                            {platformFeePerSeat && (
                                <div className="rounded-2xl bg-amber-50 p-3 text-left border border-amber-100">
                                    <p className="text-[8px] font-black uppercase tracking-widest text-amber-700">Comisión plataforma · 10%</p>
                                    <p className="mt-1 text-sm font-black text-amber-700">{platformFeePerSeat} / plaza</p>
                                </div>
                            )}
                            {driverPayoutPerSeat && (
                                <div className="rounded-2xl bg-emerald-50 p-3 text-left border border-emerald-100">
                                    <p className="text-[8px] font-black uppercase tracking-widest text-emerald-700">Neto conductor · 90%</p>
                                    <p className="mt-1 text-sm font-black text-emerald-700">{driverPayoutPerSeat} / plaza</p>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1 bg-slate-50 p-4 rounded-3xl border border-slate-100">
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                                <Users size={12} /> Plazas
                            </p>
                            <p className="text-sm font-bold text-slate-700">
                                {ride.seats_available} disponibles <span className="text-slate-300 font-normal">/ {ride.total_seats ?? '—'}</span>
                            </p>
                        </div>
                        <div className="space-y-1 bg-slate-50 p-4 rounded-3xl border border-slate-100">
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                                <ShieldCheck size={12} /> Seguro
                            </p>
                            <p className="text-sm font-bold text-slate-700">Protección ShareWay</p>
                        </div>
                    </div>
                </Card>

                <Card className="rounded-3xl border-none shadow-xl bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] p-4 text-white">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Política económica</p>
                            <p className="mt-1 text-xs font-bold text-slate-300">Importes aplicados por el servidor</p>
                        </div>
                        <ShieldCheck className="text-primary" size={22} />
                    </div>
                    <div className="grid gap-3 text-[9px] font-bold uppercase tracking-wider text-slate-400 sm:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-1.5">
                            <p className="text-slate-200">Cancelación del pasajero</p>
                            <p>&gt;24 h: reembolso 100% · 2–24 h: 50% · &lt;2 h: 0%</p>
                            <p>Parte no reembolsada: 80% conductor · 20% plataforma</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-1.5">
                            <p className="text-slate-200">Cancelación del conductor</p>
                            <p>Pasajero: reembolso 100% · penalización: 0€ ≥24 h, 2€ de 2 a &lt;24 h, 5€ &lt;2 h</p>
                            <p>Con pasajeros: 50% compensación · 50% plataforma; sin pasajeros: 100% plataforma + impacto reputacional</p>
                        </div>
                    </div>
                </Card>

                <Card className="rounded-3xl border-none shadow-xl bg-white p-5">
                    <div className="relative space-y-8 before:absolute before:left-3 before:top-3 before:bottom-3 before:w-0.5 before:bg-gradient-to-b before:from-primary before:to-emerald-500 before:rounded-full">
                        <div className="relative pl-10">
                            <div className="absolute left-0 top-1 w-6 h-6 bg-primary/10 rounded-full flex items-center justify-center">
                                <div className="w-2 h-2 bg-primary rounded-full ring-4 ring-primary/20" />
                            </div>
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Origen</p>
                            <p className="text-lg font-black text-slate-900 tracking-tight leading-tight">{ride.origin_address || ride.origin?.address || 'Ubicación de origen'}</p>
                        </div>
                        <div className="relative pl-10">
                            <div className="absolute left-0 top-1 w-6 h-6 bg-emerald-500/10 rounded-full flex items-center justify-center">
                                <div className="w-2 h-2 bg-emerald-500 rounded-full ring-4 ring-emerald-500/20" />
                            </div>
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Destino Final</p>
                            <p className="text-lg font-black text-slate-900 tracking-tight leading-tight">{ride.destination_address || ride.destination?.address || 'Ubicación de destino'}</p>
                        </div>
                    </div>
                </Card>

                <Card className="rounded-3xl border-none shadow-xl bg-white overflow-hidden">
                    <div className="p-8">
                        <div className="flex items-center gap-6">
                            <div className="relative shrink-0">
                                <Avatar className="w-20 h-20 ring-4 ring-slate-50">
                                    <AvatarImage src={ride.driver?.avatar_url || ride.driver?.photo_url} />
                                    <AvatarFallback className="bg-primary/10 text-primary font-black text-xl">
                                        {(ride.driver?.display_name || 'D').charAt(0)}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-lg">
                                    <BadgeCheck className="text-primary size-6 fill-white" />
                                </div>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex flex-col gap-1.5 mb-2">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-xl font-black text-slate-900 tracking-tighter truncate leading-none">
                                            {ride.driver?.display_name || 'Conductor'}
                                        </h3>
                                        <div className="flex items-center gap-1 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-lg border border-amber-100 shrink-0">
                                            <Star size={10} className="fill-current" />
                                            <span className="text-[10px] font-bold">{formatRating(ride.driver?.rating)}</span>
                                        </div>
                                    </div>
                                    <p className="text-slate-500 text-xs font-medium tracking-tight truncate">Viene de {ride.driver?.city || 'Ciudad no indicada'}</p>
                                </div>

                                <div className="flex gap-2">
                                    <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100"><Car size={16} className="text-slate-400" /></div>
                                    <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100"><Music size={16} className="text-slate-400" /></div>
                                    <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100"><Heart size={16} className="text-slate-400" /></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 px-8 py-4 border-t border-slate-100 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="size-8 rounded-full bg-white flex items-center justify-center shadow-sm">
                                <Car size={14} className="text-primary" />
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase text-slate-400 tracking-tighter leading-none">Vehículo</p>
                                <p className="text-xs font-bold text-slate-700">{ride.vehicle_model || 'Vehículo no indicado'}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-tighter leading-none">Matrícula</p>
                            <p className="text-xs font-black text-slate-900 uppercase tracking-widest">{ride.vehicle_plate || '••••'}</p>
                        </div>
                    </div>
                </Card>

                {isDriver && ride.status === 'scheduled' && startBlockReason && (
                    <div className="bg-amber-50 border-2 border-amber-100 rounded-3xl p-6 flex items-center gap-4 text-amber-700">
                        <Lock size={28} className="shrink-0" />
                        <div>
                            <p className="font-black uppercase italic leading-none">Inicio bloqueado</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest mt-1 opacity-80">{startBlockReason}</p>
                        </div>
                    </div>
                )}

                {(isDriver || isPassenger) && confirmedPassengers.length > 0 && (
                    <div className="space-y-4 pt-4">
                        <div className="flex items-center justify-between px-2">
                            <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
                                <Users size={14} /> Tus compañeros de viaje ({confirmedPassengers.length})
                            </h4>
                        </div>
                        <div className="grid gap-3">
                            {confirmedPassengers.map((passenger) => {
                                const passengerName = getPassengerName(passenger);
                                return (
                                    <Card key={passenger.id} className="rounded-3xl border-none shadow-sm bg-white p-4 flex items-center justify-between gap-3 group transition-all hover:shadow-md">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <Avatar className="w-10 h-10 ring-2 ring-slate-50 shrink-0">
                                                <AvatarImage src={getPassengerAvatar(passenger)} />
                                                <AvatarFallback className="bg-primary/5 text-primary text-xs font-black">
                                                    {passengerName.charAt(0)}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-slate-900 leading-none mb-1 truncate">{passengerName}</p>
                                                <div className="flex items-center gap-1.5">
                                                    {passenger.status === 'completed' ? (
                                                        <span className="text-[9px] font-black uppercase tracking-tighter text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-md border border-blue-100 flex items-center gap-1">
                                                            <CheckCircle2 size={10} /> Entregado
                                                        </span>
                                                    ) : passenger.status === 'verified' ? (
                                                        <span className="text-[9px] font-black uppercase tracking-tighter text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-100 flex items-center gap-1">
                                                            <BadgeCheck size={10} /> A bordo
                                                        </span>
                                                    ) : (
                                                        <span className="text-[9px] font-black uppercase tracking-tighter text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100 flex items-center gap-1">
                                                            <Clock size={10} /> Confirmado
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 shrink-0">
                                            {isDriver && !isRideClosed && (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="rounded-xl bg-slate-50 hover:bg-primary/10 hover:text-primary transition-colors h-10 w-10"
                                                        onClick={() => {
                                                            const targetLat = passenger.pickup_location?.lat || passenger.pickup_location?.latitude || ride.origin?.lat || ride.origin?.coordinates?.lat;
                                                            const targetLng = passenger.pickup_location?.lng || passenger.pickup_location?.longitude || ride.origin?.lng || ride.origin?.coordinates?.lng;
                                                            const url = `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=driving`;
                                                            window.open(url, '_blank');
                                                        }}
                                                        title="Navegar al origen"
                                                    >
                                                        <Navigation size={18} className={cn((isRideActive && passenger.status === 'verified') ? 'text-emerald-500' : 'text-primary')} />
                                                    </Button>

                                                    {passenger.status === 'verified' && (
                                                        <Button
                                                            onClick={() => handlePassengerDropoff(passenger)}
                                                            disabled={isDroppingOff}
                                                            className="rounded-xl h-10 px-3 bg-emerald-500 text-white font-black uppercase italic tracking-tighter text-[10px] gap-2 shadow-lg shadow-emerald-200 hover:scale-105 active:scale-95 transition-all"
                                                        >
                                                            {isDroppingOff ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 size={14} />}
                                                            Finalizar
                                                        </Button>
                                                    )}

                                                    {passenger.status === 'confirmed' && isRideActive && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => onPassengerNoShow(passenger)}
                                                            className="rounded-xl bg-red-50 hover:bg-red-100 text-red-500 transition-colors h-10 w-10"
                                                            title="No se presentó"
                                                        >
                                                            <UserX size={18} />
                                                        </Button>
                                                    )}
                                                </>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="rounded-xl bg-slate-50 hover:bg-primary/10 hover:text-primary transition-colors h-10 w-10"
                                                onClick={() => handleOpenPrivateChat(passenger.id)}
                                            >
                                                <MessageCircle size={18} />
                                            </Button>
                                            {isDriver && passenger.status === 'confirmed' && !isRideClosed && (
                                                <div className="flex flex-col items-end gap-1">
                                                    <Button
                                                        disabled={!canVerifyPassenger}
                                                        onClick={() => {
                                                            setSelectedPassenger(passenger);
                                                            setIsPinDialogOpen(true);
                                                        }}
                                                        className={cn(
                                                            'rounded-xl h-10 px-4 font-black uppercase italic tracking-tighter text-[10px] gap-2 shadow-lg transition-all z-10',
                                                            canVerifyPassenger ? 'bg-primary text-white shadow-primary/20 hover:scale-105 active:scale-95' : 'bg-slate-100 text-slate-400 shadow-none cursor-not-allowed'
                                                        )}
                                                    >
                                                        <Fingerprint size={14} /> Verificar
                                                    </Button>
                                                    {!canVerifyPassenger && (
                                                        <span className="text-[7px] font-bold text-slate-400 uppercase tracking-tighter mr-1">Disponible 15m antes</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>

            <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-0 right-0 px-4 pb-3 z-40 pointer-events-none">
                <div className="max-w-xl mx-auto flex gap-3 pointer-events-auto">
                    {isDriver ? (
                        <>
                            {ride.status === 'scheduled' && (
                                <>
                                    <Button
                                        onClick={askCancelRide}
                                        disabled={isCancelling}
                                        variant="outline"
                                        className="h-12 flex-1 rounded-3xl border-2 border-slate-100 font-black uppercase italic tracking-widest text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-100 transition-all duration-300"
                                    >
                                        {isCancelling ? <Loader2 className="animate-spin" /> : 'Cancelar'}
                                    </Button>
                                    <Button
                                        onClick={handleStartRide}
                                        disabled={isStarting || !canStartRide}
                                        className={cn(
                                            'h-12 flex-[2] rounded-3xl font-black uppercase italic tracking-widest text-white shadow-2xl transition-all duration-300 transform active:scale-95 group overflow-hidden relative',
                                            canStartRide ? 'bg-primary hover:shadow-primary/40' : 'bg-slate-200 cursor-not-allowed'
                                        )}
                                    >
                                        {isStarting ? (
                                            <Loader2 className="animate-spin" />
                                        ) : (
                                            <span className="flex items-center gap-3">
                                                Iniciar Viaje <Play size={20} className="fill-current group-hover:translate-x-1 transition-transform" />
                                            </span>
                                        )}
                                        {!canStartRide && (
                                            <div className="absolute inset-x-0 bottom-1 flex justify-center">
                                                <span className="text-[7px] tracking-normal opacity-70">Disponible 15 min antes</span>
                                            </div>
                                        )}
                                    </Button>
                                </>
                            )}
                            {(ride.status === 'active' || ride.status === 'in_progress') && (
                                <Button
                                    onClick={handleCompleteRide}
                                    disabled={isCompleting}
                                    className="h-12 flex-1 rounded-3xl bg-emerald-500 hover:bg-emerald-600 font-black uppercase italic tracking-widest text-white shadow-2xl shadow-emerald-200"
                                >
                                    {isCompleting ? <Loader2 className="animate-spin" /> : 'Finalizar Viaje'}
                                </Button>
                            )}
                        </>
                    ) : isPassenger ? (
                        <div className="flex flex-col w-full gap-4">
                            {myPassengerEntry?.status !== 'verified' && (ride.status === 'scheduled' || isRideActive) && (
                                <div className="bg-primary/10 border-2 border-primary/20 rounded-3xl p-4 flex items-center justify-between mb-2">
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-primary tracking-widest">Tu PIN de Seguridad</p>
                                        <p className="text-2xl font-black text-slate-900 tracking-[0.5em]">{myPin}</p>
                                    </div>
                                    <Lock className="text-primary size-8 opacity-50" />
                                </div>
                            )}

                            <div className="flex gap-3">
                                <Button
                                    variant="outline"
                                    className="h-12 flex-1 rounded-3xl border-2 border-slate-100 font-black uppercase italic tracking-widest text-slate-400"
                                    onClick={askCancelBooking}
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    onClick={() => navigate(`/rides/${rideId}/chats`)}
                                    className="h-12 flex-[2] rounded-3xl bg-gradient-to-br from-[#0B2A86] via-[#1267FF] to-[#0FC6A6] font-black uppercase italic tracking-widest text-white shadow-2xl"
                                >
                                    <span className="flex items-center gap-2">Chat <MessageCircle size={18} /></span>
                                </Button>
                            </div>

                            {ride.status === 'completed' && myPassengerEntry?.status === 'verified' && !isRated && (
                                <Button
                                    onClick={() => setIsRatingModalOpen(true)}
                                    className="h-12 w-full rounded-3xl bg-amber-400 hover:bg-amber-500 font-black uppercase italic tracking-widest text-slate-900"
                                >
                                    <Star className="mr-2 fill-current" /> Calificar Viaje
                                </Button>
                            )}
                        </div>
                    ) : (
                        <Button
                            disabled={!isRideBookableNow}
                            onClick={handleOpenBookingModal}
                            className={cn(
                                'h-12 w-full rounded-3xl font-black uppercase italic tracking-[0.2em] text-lg shadow-2xl transition-all duration-300 transform active:scale-95 group',
                                isRideBookableNow ? 'bg-primary hover:shadow-primary/40 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            )}
                        >
                            {isRideBookableNow ? (
                                <span className="flex items-center gap-3">
                                    Reservar Plaza <ChevronRight size={24} className="group-hover:translate-x-1 transition-transform" />
                                </span>
                            ) : bookingBlockedLabel}
                        </Button>
                    )}
                </div>
            </div>

            <SimpleBookingModal
                isOpen={isBookingModalOpen}
                onClose={() => setIsBookingModalOpen(false)}
                ride={ride}
                initialPickupLocation={selectedPickupLocation}
                onSuccess={() => {
                    setIsBookingModalOpen(false);
                    fetchRide();
                    toast.success('¡Reserva completada!', {
                        description: 'Tu plaza ha sido confirmada con éxito.'
                    });
                }}
            />

            <PinVerificationDialog
                open={isPinDialogOpen}
                onOpenChange={setIsPinDialogOpen}
                onConfirm={handleVerifyPin}
                title={selectedPassenger ? `Verificar a ${getPassengerName(selectedPassenger)}` : 'Verificar PIN'}
                isLoading={isVerifying}
            />

            <RideRatingModal
                isOpen={isRatingModalOpen}
                onClose={() => setIsRatingModalOpen(false)}
                rideId={rideId}
                driverId={ride.driver_id}
                driverName={ride.driver?.display_name}
                onSuccess={() => {
                    setIsRatingModalOpen(false);
                    fetchRide();
                }}
            />

            <AlertDialog
                open={Boolean(secureAction)}
                onOpenChange={(open) => {
                    if (!open && !isSecureActionLoading) setSecureAction(null);
                }}
            >
                <AlertDialogContent className="rounded-3xl border-none p-8">
                    <AlertDialogHeader>
                        <div className={cn(
                            'mb-3 flex h-12 w-12 items-center justify-center rounded-2xl',
                            secureAction?.tone === 'danger' ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'
                        )}>
                            {secureAction?.tone === 'danger' ? <ShieldAlert className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
                        </div>
                        <AlertDialogTitle className="text-2xl font-black italic uppercase tracking-tighter">
                            {secureAction?.title || 'Confirmar acción'}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-500 font-medium pt-2 leading-6">
                            {secureAction?.description || 'Confirma que quieres continuar.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-6 gap-3">
                        <AlertDialogCancel
                            disabled={isSecureActionLoading}
                            className="h-14 rounded-2xl border-2 border-slate-100 font-bold uppercase tracking-widest text-[10px]"
                        >
                            Cerrar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault();
                                handleSecureActionConfirm();
                            }}
                            disabled={isSecureActionLoading}
                            className={cn(
                                'h-14 rounded-2xl font-bold uppercase tracking-widest text-[10px] text-white',
                                secureAction?.tone === 'danger' ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'
                            )}
                        >
                            {isSecureActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (secureAction?.confirmLabel || 'Confirmar')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default RideDetails;
