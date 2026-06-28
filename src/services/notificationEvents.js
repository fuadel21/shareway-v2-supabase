import { createNotification, NOTIFICATION_TYPES } from './notificationService.js';
import { supabase } from '@/lib/supabase.js';

const safeText = (value, fallback = '') => String(value || fallback).trim();

const getCurrentActorId = async () => {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
};

const notify = async (payload) => {
  try {
    if (!payload?.userId || !payload?.title) return null;
    const actorId = payload.actorId === undefined ? await getCurrentActorId() : payload.actorId;

    return await createNotification({
      ...payload,
      actorId,
    });
  } catch (error) {
    console.warn('🛡️ [NotificationEvents] Notification skipped:', error?.message || error);
    return null;
  }
};

export const notifyRideRequestCreated = async ({
  driverId,
  passengerId,
  rideId,
  passengerName = 'Un pasajero',
  origin = '',
  destination = '',
}) => notify({
  userId: driverId,
  actorId: passengerId,
  type: NOTIFICATION_TYPES.RIDE_REQUEST,
  title: 'Nueva solicitud de plaza',
  message: `${safeText(passengerName, 'Un pasajero')} quiere unirse a tu viaje${origin || destination ? `: ${safeText(origin)} → ${safeText(destination)}` : ''}.`,
  actionUrl: `/ride/${rideId}`,
  entityType: 'ride',
  entityId: rideId,
  priority: 'high',
  metadata: { passengerId, rideId, origin, destination },
});

export const notifyRideRequestAccepted = async ({
  passengerId,
  driverId,
  rideId,
  driverName = 'El conductor',
}) => notify({
  userId: passengerId,
  actorId: driverId,
  type: NOTIFICATION_TYPES.REQUEST_ACCEPTED,
  title: 'Solicitud aceptada',
  message: `${safeText(driverName, 'El conductor')} ha aceptado tu plaza. Ya puedes ver los detalles del viaje.`,
  actionUrl: `/ride/${rideId}`,
  entityType: 'ride',
  entityId: rideId,
  priority: 'high',
  metadata: { driverId, passengerId, rideId },
});

export const notifyRideRequestRejected = async ({
  passengerId,
  driverId,
  rideId,
  driverName = 'El conductor',
}) => notify({
  userId: passengerId,
  actorId: driverId,
  type: NOTIFICATION_TYPES.REQUEST_REJECTED,
  title: 'Solicitud rechazada',
  message: `${safeText(driverName, 'El conductor')} no ha podido aceptar tu solicitud para este viaje.`,
  actionUrl: '/dashboard',
  entityType: 'ride',
  entityId: rideId,
  priority: 'normal',
  metadata: { driverId, passengerId, rideId },
});

export const notifyRideCancelled = async ({
  userId,
  actorId,
  rideId,
  origin = '',
  destination = '',
  reason = '',
}) => notify({
  userId,
  actorId,
  type: NOTIFICATION_TYPES.RIDE_CANCELLED,
  title: 'Viaje cancelado',
  message: `Se ha cancelado el viaje${origin || destination ? ` ${safeText(origin)} → ${safeText(destination)}` : ''}.${reason ? ` Motivo: ${reason}` : ''}`,
  actionUrl: `/ride/${rideId}`,
  entityType: 'ride',
  entityId: rideId,
  priority: 'critical',
  metadata: { actorId, rideId, origin, destination, reason },
  ignorePreferences: true,
});

export const notifyChatMessage = async ({
  recipientId,
  senderId,
  chatId,
  rideId = null,
  senderName = 'Nuevo mensaje',
  preview = '',
}) => notify({
  userId: recipientId,
  actorId: senderId,
  type: NOTIFICATION_TYPES.CHAT_MESSAGE,
  title: safeText(senderName, 'Nuevo mensaje'),
  message: safeText(preview, 'Tienes un nuevo mensaje en ShareWay.'),
  actionUrl: rideId ? `/rides/${rideId}/chat/${chatId}` : `/chat/${chatId}`,
  entityType: 'chat',
  entityId: chatId,
  priority: 'normal',
  metadata: { senderId, recipientId, chatId, rideId },
});

export const notifyReviewReceived = async ({
  revieweeId,
  reviewerId,
  rideId,
  rating,
  reviewerName = 'Un usuario',
}) => notify({
  userId: revieweeId,
  actorId: reviewerId,
  type: NOTIFICATION_TYPES.REVIEW,
  title: 'Nueva valoración recibida',
  message: `${safeText(reviewerName, 'Un usuario')} te ha dejado una valoración de ${rating}/5.`,
  actionUrl: `/profile/${revieweeId}`,
  entityType: 'review',
  entityId: rideId,
  priority: 'normal',
  metadata: { reviewerId, revieweeId, rideId, rating },
});

export const notifyRideReminder = async ({
  userId,
  rideId,
  origin = '',
  destination = '',
  minutes = 30,
}) => notify({
  userId,
  actorId: null,
  type: NOTIFICATION_TYPES.RIDE_REMINDER,
  title: 'Recordatorio de viaje',
  message: `Tu viaje${origin || destination ? ` ${safeText(origin)} → ${safeText(destination)}` : ''} empieza en ${minutes} minutos.`,
  actionUrl: `/ride/${rideId}`,
  entityType: 'ride',
  entityId: rideId,
  priority: 'high',
  metadata: { rideId, origin, destination, minutes },
});
