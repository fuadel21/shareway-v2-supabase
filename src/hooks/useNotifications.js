import { useEffect } from 'react';
import { getMessaging, onMessage } from 'firebase/messaging';
import { app } from '../lib/firebase';
import { toast } from 'sonner';

export const useNotifications = (user) => {

    // Listener para notificaciones en primer plano
    useEffect(() => {
        if (!user || !app) return;

        try {
            const messaging = getMessaging(app);
            const unsubscribe = onMessage(messaging, (payload) => {
                console.log('Notificación recibida en primer plano:', payload);
                toast.info(payload.notification.title, {
                    description: payload.notification.body,
                    duration: 8000
                });
            });
            return () => unsubscribe();
        } catch (error) {
            console.error("Error al inicializar Firebase Messaging:", error);
        }
    }, [user]);
};
