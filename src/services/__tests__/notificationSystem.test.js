/**
 * Tests Completos del Sistema de Notificaciones
 * Verifica todas las funcionalidades de notificaciones push, email y preferencias
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NotificationCenterEnhanced from '../../components/NotificationCenterEnhanced.jsx';
import { testClient, createTestUser, cleanupTestData } from '../helpers.js';
import {
    createNotification,
    getUnreadNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    getNotificationPreferences,
    updateNotificationPreferences,
    notifyRideRequest,
    notifyRideAccepted,
    notifyPaymentRequired
} from '../../services/notificationServiceEnhanced.js';

// Mock de dependencias
vi.mock('../../lib/supabase', () => ({
    supabase: testClient
}));

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn()
    }
}));

// Mock de Notification API
global.Notification = {
    permission: 'granted',
    requestPermission: vi.fn().mockResolvedValue('granted')
};

global.Notification.prototype = {
    close: vi.fn()
};

const TestWrapper = ({ children, userId = 'test-user-id' }) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    });

    return (
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                {children}
            </BrowserRouter>
        </QueryClientProvider>
    );
};

describe('Notification System - Complete Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
        vi.clearAllMocks();
    });

    describe('createNotification Function', () => {
        it('debe crear notificación válida exitosamente', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            const notificationData = {
                userId: user.id,
                type: 'ride_request',
                title: 'Nueva solicitud',
                body: 'Tienes una nueva solicitud de plaza',
                data: { ride_id: 'test-ride-id' },
                priority: 'normal',
                category: 'ride'
            };

            // Act
            const result = await createNotification(notificationData);

            // Assert
            expect(result).toBeDefined();
            expect(typeof result).toBe('string'); // UUID
            
            // Verificar en base de datos
            const { data: notification } = await testClient
                .from('notifications')
                .select('*')
                .eq('id', result)
                .single();
            
            expect(notification.user_id).toBe(user.id);
            expect(notification.type).toBe('ride_request');
            expect(notification.title).toBe('Nueva solicitud');
            expect(notification.status).toBe('pending');
        });

        it('debe respetar preferencias de usuario', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Desactivar notificaciones de ride_requests
            await testClient
                .from('notification_preferences')
                .upsert({
                    user_id: user.id,
                    ride_requests: false,
                    push_enabled: true
                });

            // Act
            const result = await createNotification({
                userId: user.id,
                type: 'ride_request',
                title: 'Nueva solicitud',
                body: 'Esta no debería enviarse'
            });

            // Assert
            // La notificación debe crearse con status 'failed'
            const { data: notification } = await testClient
                .from('notifications')
                .select('*')
                .eq('id', result)
                .single();
            
            expect(notification.status).toBe('failed');
        });

        it('debe respetar horario de silencio', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Activar do not disturb de 22:00 a 08:00
            await testClient
                .from('notification_preferences')
                .upsert({
                    user_id: user.id,
                    do_not_disturb: true,
                    quiet_hours_start: '22:00',
                    quiet_hours_end: '08:00',
                    push_enabled: true
                });

            // Mock de hora actual (23:00)
            const originalDate = Date;
            const mockDate = vi.fn(() => new Date('2024-01-15T23:00:00Z'));
            global.Date = mockDate;

            // Act
            const result = await createNotification({
                userId: user.id,
                type: 'ride_request',
                title: 'Nueva solicitud',
                body: 'Esta no debería enviarse por horario'
            });

            // Restore Date
            global.Date = originalDate;

            // Assert
            const { data: notification } = await testClient
                .from('notifications')
                .select('*')
                .eq('id', result)
                .single();
            
            expect(notification.status).toBe('failed');
        });

        it('debe permitir notificaciones urgentes en horario de silencio', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            await testClient
                .from('notification_preferences')
                .upsert({
                    user_id: user.id,
                    do_not_disturb: true,
                    quiet_hours_start: '22:00',
                    quiet_hours_end: '08:00',
                    push_enabled: true
                });

            // Mock de hora actual (23:00)
            const originalDate = Date;
            const mockDate = vi.fn(() => new Date('2024-01-15T23:00:00Z'));
            global.Date = mockDate;

            // Act
            const result = await createNotification({
                userId: user.id,
                type: 'emergency_alert',
                title: 'Alerta de emergencia',
                body: 'Esta sí debería enviarse',
                priority: 'urgent'
            });

            // Restore Date
            global.Date = originalDate;

            // Assert
            const { data: notification } = await testClient
                .from('notifications')
                .select('*')
                .eq('id', result)
                .single();
            
            expect(notification.status).toBe('pending'); // No es 'failed'
        });
    });

    describe('getUnreadNotifications Function', () => {
        it('debe obtener notificaciones no leídas', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Crear varias notificaciones
            const notifications = [
                { type: 'ride_request', title: 'Solicitud 1', body: 'Body 1' },
                { type: 'ride_accepted', title: 'Aceptada 1', body: 'Body 2' },
                { type: 'payment_required', title: 'Pago 1', body: 'Body 3' }
            ];

            for (const notif of notifications) {
                await createNotification({
                    userId: user.id,
                    ...notif
                });
            }

            // Marcar una como leída
            const { data: createdNotifs } = await testClient
                .from('notifications')
                .select('id')
                .eq('user_id', user.id)
                .limit(1);
            
            if (createdNotifs && createdNotifs.length > 0) {
                await testClient
                    .from('notifications')
                    .update({ status: 'read', read_at: new Date().toISOString() })
                    .eq('id', createdNotifs[0].id);
            }

            // Act
            const result = await getUnreadNotifications(user.id);

            // Assert
            expect(result.success).toBe(true);
            expect(result.notifications).toHaveLength(2); // 3 - 1 leída
            expect(result.unread_count).toBe(2);
        });

        it('debe respetar límite de resultados', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Crear más de 20 notificaciones
            for (let i = 0; i < 25; i++) {
                await createNotification({
                    userId: user.id,
                    type: 'ride_request',
                    title: `Solicitud ${i}`,
                    body: `Body ${i}`
                });
            }

            // Act
            const result = await getUnreadNotifications(user.id, { limit: 10 });

            // Assert
            expect(result.notifications).toHaveLength(10);
            expect(result.unread_count).toBe(25); // Total no leídas
        });

        it('debe excluir notificaciones expiradas', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Crear notificación expirada
            const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            await testClient
                .from('notifications')
                .insert({
                    user_id: user.id,
                    type: 'ride_request',
                    title: 'Expirada',
                    body: 'Esta está expirada',
                    expires_at: pastDate,
                    status: 'pending'
                });

            // Crear notificación válida
            await createNotification({
                userId: user.id,
                type: 'ride_accepted',
                title: 'Válida',
                body: 'Esta no está expirada'
            });

            // Act
            const result = await getUnreadNotifications(user.id);

            // Assert
            expect(result.notifications).toHaveLength(1);
            expect(result.notifications[0].title).toBe('Válida');
        });
    });

    describe('markNotificationRead Function', () => {
        it('debe marcar notificación como leída', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            const notificationId = await createNotification({
                userId: user.id,
                type: 'ride_request',
                title: 'Test',
                body: 'Test body'
            });

            // Act
            const result = await markNotificationRead(notificationId);

            // Assert
            expect(result.success).toBe(true);
            
            const { data: notification } = await testClient
                .from('notifications')
                .select('*')
                .eq('id', notificationId)
                .single();
            
            expect(notification.status).toBe('read');
            expect(notification.read_at).toBeTruthy();
        });

        it('debe lanzar error si notificación no existe', async () => {
            // Act & Assert
            await expect(markNotificationRead('invalid-id')).rejects.toThrow('No encontrada');
        });
    });

    describe('markAllNotificationsRead Function', () => {
        it('debe marcar todas las notificaciones como leídas', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Crear 5 notificaciones
            for (let i = 0; i < 5; i++) {
                await createNotification({
                    userId: user.id,
                    type: 'ride_request',
                    title: `Test ${i}`,
                    body: `Body ${i}`
                });
            }

            // Act
            const result = await markAllNotificationsRead(user.id);

            // Assert
            expect(result.success).toBe(true);
            expect(result.marked_count).toBe(5);
            
            const { data: notifications } = await testClient
                .from('notifications')
                .select('status')
                .eq('user_id', user.id);
            
            notifications.forEach(n => {
                expect(n.status).toBe('read');
            });
        });

        it('debe manejar caso sin notificaciones', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            const result = await markAllNotificationsRead(user.id);

            // Assert
            expect(result.success).toBe(true);
            expect(result.marked_count).toBe(0);
        });
    });

    describe('Notification Preferences', () => {
        it('debe crear preferencias por defecto', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            const preferences = await getNotificationPreferences(user.id);

            // Assert
            expect(preferences.user_id).toBe(user.id);
            expect(preferences.ride_requests).toBe(true);
            expect(preferences.push_enabled).toBe(true);
            expect(preferences.email_enabled).toBe(true);
            expect(preferences.do_not_disturb).toBe(false);
        });

        it('debe actualizar preferencias', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Act
            const updated = await updateNotificationPreferences(user.id, {
                ride_requests: false,
                push_enabled: false,
                do_not_disturb: true,
                quiet_hours_start: '23:00',
                quiet_hours_end: '07:00'
            });

            // Assert
            expect(updated.ride_requests).toBe(false);
            expect(updated.push_enabled).toBe(false);
            expect(updated.do_not_disturb).toBe(true);
            expect(updated.quiet_hours_start).toBe('23:00');
            expect(updated.quiet_hours_end).toBe('07:00');
        });

        it('debe mantener preferencias existentes', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Crear preferencias iniciales
            await updateNotificationPreferences(user.id, {
                ride_requests: false,
                marketing_notifications: true
            });

            // Act: Actualizar solo algunas preferencias
            const updated = await updateNotificationPreferences(user.id, {
                push_enabled: false
            });

            // Assert
            expect(updated.ride_requests).toBe(false); // Mantenido
            expect(updated.marketing_notifications).toBe(true); // Mantenido
            expect(updated.push_enabled).toBe(false); // Actualizado
        });
    });

    describe('Event Notification Functions', () => {
        it('notifyRideRequest debe crear notificación correcta', async () => {
            // Arrange
            const driver = await createTestUser('driverVerified');
            
            const requestData = {
                rideId: 'test-ride-id',
                requestId: 'test-request-id',
                requesterId: 'test-requester-id',
                requesterName: 'Juan Pérez',
                origin: 'Madrid',
                destination: 'Barcelona',
                departureTime: '2024-01-20T10:00:00Z',
                suggestedPrice: 25,
                seatsNeeded: 1
            };

            // Act
            const notificationId = await notifyRideRequest(driver.id, requestData);

            // Assert
            const { data: notification } = await testClient
                .from('notifications')
                .select('*')
                .eq('id', notificationId)
                .single();
            
            expect(notification.type).toBe('ride_request');
            expect(notification.title).toBe('Nueva solicitud de plaza');
            expect(notification.body).toContain('Juan Pérez');
            expect(notification.data.ride_id).toBe('test-ride-id');
            expect(notification.data.requester_name).toBe('Juan Pérez');
            expect(notification.priority).toBe('normal');
            expect(notification.category).toBe('ride');
        });

        it('notifyRideAccepted debe crear notificación con PIN', async () => {
            // Arrange
            const passenger = await createTestUser('passengerMale');
            
            const rideData = {
                rideId: 'test-ride-id',
                driverId: 'test-driver-id',
                driverName: 'María García',
                origin: 'Madrid',
                destination: 'Barcelona',
                departureTime: '2024-01-20T10:00:00Z',
                pickupPoint: 'Puerta del Sol',
                price: 25,
                pin: '1234'
            };

            // Act
            const notificationId = await notifyRideAccepted(passenger.id, rideData);

            // Assert
            const { data: notification } = await testClient
                .from('notifications')
                .select('*')
                .eq('id', notificationId)
                .single();
            
            expect(notification.type).toBe('ride_accepted');
            expect(notification.title).toBe('¡Tu solicitud fue aceptada!');
            expect(notification.body).toContain('María García');
            expect(notification.data.pin).toBe('1234');
            expect(notification.data.driver_name).toBe('María García');
            expect(notification.priority).toBe('high');
        });

        it('notifyPaymentRequired debe crear notificación urgente', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            const paymentData = {
                rideId: 'test-ride-id',
                amount: 25,
                expiresIn: '15 minutos',
                origin: 'Madrid',
                destination: 'Barcelona',
                departureTime: '2024-01-20T10:00:00Z'
            };

            // Act
            const notificationId = await notifyPaymentRequired(user.id, paymentData);

            // Assert
            const { data: notification } = await testClient
                .from('notifications')
                .select('*')
                .eq('id', notificationId)
                .single();
            
            expect(notification.type).toBe('payment_required');
            expect(notification.title).toBe('Pago requerido para confirmar plaza');
            expect(notification.body).toContain('€25');
            expect(notification.data.amount).toBe(25);
            expect(notification.data.expires_in).toBe('15 minutos');
            expect(notification.priority).toBe('urgent');
            expect(notification.category).toBe('payment');
        });
    });

    describe('NotificationCenterEnhanced Component', () => {
        it('debe mostrar botón de notificaciones', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <NotificationCenterEnhanced userId="test-user-id" />
                </TestWrapper>
            );

            // Assert
            expect(screen.getByRole('button')).toBeInTheDocument();
        });

        it('debe mostrar contador de no leídas', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Crear 3 notificaciones
            for (let i = 0; i < 3; i++) {
                await createNotification({
                    userId: user.id,
                    type: 'ride_request',
                    title: `Test ${i}`,
                    body: `Body ${i}`
                });
            }

            render(
                <TestWrapper userId={user.id}>
                    <NotificationCenterEnhanced userId={user.id} />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                const badge = screen.getByText('3');
                expect(badge).toBeInTheDocument();
            });
        });

        it('debe mostrar badge "99+" para más de 99 notificaciones', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Crear 100 notificaciones
            for (let i = 0; i < 100; i++) {
                await createNotification({
                    userId: user.id,
                    type: 'ride_request',
                    title: `Test ${i}`,
                    body: `Body ${i}`
                });
            }

            render(
                <TestWrapper userId={user.id}>
                    <NotificationCenterEnhanced userId={user.id} />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                const badge = screen.getByText('99+');
                expect(badge).toBeInTheDocument();
            });
        });

        it('debe abrir panel al hacer clic', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <NotificationCenterEnhanced userId="test-user-id" />
                </TestWrapper>
            );

            // Act
            const button = screen.getByRole('button');
            fireEvent.click(button);

            // Assert
            await waitFor(() => {
                expect(screen.getByText('Notificaciones')).toBeInTheDocument();
                expect(screen.getByText('Preferencias')).toBeInTheDocument();
            });
        });

        it('debe mostrar notificaciones en el panel', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            await createNotification({
                userId: user.id,
                type: 'ride_request',
                title: 'Nueva solicitud',
                body: 'Tienes una nueva solicitud',
                data: { action_url: '/rides/test-ride' }
            });

            render(
                <TestWrapper userId={user.id}>
                    <NotificationCenterEnhanced userId={user.id} />
                </TestWrapper>
            );

            // Act
            const button = screen.getByRole('button');
            fireEvent.click(button);

            // Assert
            await waitFor(() => {
                expect(screen.getByText('Nueva solicitud')).toBeInTheDocument();
                expect(screen.getByText('Tienes una nueva solicitud')).toBeInTheDocument();
                expect(screen.getByText('Ver detalles')).toBeInTheDocument();
            });
        });

        it('debe mostrar mensaje cuando no hay notificaciones', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <NotificationCenterEnhanced userId="test-user-id" />
                </TestWrapper>
            );

            // Act
            const button = screen.getByRole('button');
            fireEvent.click(button);

            // Assert
            await waitFor(() => {
                expect(screen.getByText('No tienes notificaciones')).toBeInTheDocument();
            });
        });

        it('debe cambiar a tab de preferencias', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <NotificationCenterEnhanced userId="test-user-id" />
                </TestWrapper>
            );

            // Act
            const button = screen.getByRole('button');
            fireEvent.click(button);

            await waitFor(() => {
                const preferencesTab = screen.getByText('Preferencias');
                fireEvent.click(preferencesTab);
            });

            // Assert
            await waitFor(() => {
                expect(screen.getByText('Tipos de Notificación')).toBeInTheDocument();
                expect(screen.getByText('Métodos de Entrega')).toBeInTheDocument();
            });
        });

        it('debe mostrar preferencias de notificación', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Configurar preferencias
            await updateNotificationPreferences(user.id, {
                ride_requests: false,
                push_enabled: true,
                email_enabled: false
            });

            render(
                <TestWrapper userId={user.id}>
                    <NotificationCenterEnhanced userId={user.id} />
                </TestWrapper>
            );

            // Act
            const button = screen.getByRole('button');
            fireEvent.click(button);

            await waitFor(() => {
                const preferencesTab = screen.getByText('Preferencias');
                fireEvent.click(preferencesTab);
            });

            // Assert
            await waitFor(() => {
                // Verificar que los switches estén configurados correctamente
                expect(screen.getByText('Solicitudes de viaje')).toBeInTheDocument();
                expect(screen.getByText('Notificaciones Push')).toBeInTheDocument();
                expect(screen.getByText('Email')).toBeInTheDocument();
            });
        });
    });

    describe('Edge Cases y Error Handling', () => {
        it('debe manejar usuario sin autenticar', async () => {
            // Act & Assert
            await expect(createNotification({
                userId: null,
                type: 'test',
                title: 'Test',
                body: 'Test'
            })).rejects.toThrow();
        });

        it('debe validar tipos de notificación válidos', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act & Assert
            await expect(createNotification({
                userId: user.id,
                type: 'invalid_type',
                title: 'Test',
                body: 'Test'
            })).rejects.toThrow();
        });

        it('debe validar prioridad válida', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act & Assert
            await expect(createNotification({
                userId: user.id,
                type: 'ride_request',
                title: 'Test',
                body: 'Test',
                priority: 'invalid_priority'
            })).rejects.toThrow();
        });

        it('debe manejar longitud máxima de título y body', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            const longTitle = 'a'.repeat(300);
            const longBody = 'b'.repeat(2000);

            // Act
            const result = await createNotification({
                userId: user.id,
                type: 'ride_request',
                title: longTitle,
                body: longBody
            });

            // Assert
            expect(result).toBeDefined();
            
            const { data: notification } = await testClient
                .from('notifications')
                .select('*')
                .eq('id', result)
                .single();
            
            // La base de datos debería truncar automáticamente si hay constraints
            expect(notification.title).toBeTruthy();
            expect(notification.body).toBeTruthy();
        });
    });
});
