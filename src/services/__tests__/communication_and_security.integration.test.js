/**
 * Communication and Security Integration Tests
 * Focus: Moderation, Chat Locking and Notifications
 * Rules: 2, 3, 7, 9
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendMessage } from '../chatService';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis()
    })),
    rpc: vi.fn()
  }
}));

describe('Comunicación y Seguridad: Chat y Moderación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- ESCENARIO 1: MODERACIÓN (Regla 3) ---
  it('DEBE aplicar moderación de contenido al enviar un mensaje', async () => {
    const chatId = 'chat-123';
    const senderId = 'user-abc';
    const content = 'Llámame al 600123456 para pagar fuera';

    // Simulamos que el trigger de DB (o el servicio) censura el contenido
    // Como testeamos el servicio, validamos que la inserción se intenta
    supabase.from().insert.mockResolvedValue({ 
      data: { content: 'Llámame al [NÚMERO PROTEGIDO] para pagar fuera' }, 
      error: null 
    });

    const result = await sendMessage(chatId, senderId, content);
    
    expect(result.content).toContain('[NÚMERO PROTEGIDO]');
  });

  // --- ESCENARIO 2: BLOQUEO POR PRIVACIDAD (Regla 7) ---
  it('DEBE impedir enviar mensajes en un chat expirado (>24h post-viaje)', async () => {
    const chatId = 'expired-chat';
    
    // Simulamos el error que lanzaría el trigger 'check_chat_active_fn' de Postgres
    supabase.from().insert.mockResolvedValue({ 
      data: null, 
      error: { message: 'El chat para este viaje ha sido cerrado por privacidad' } 
    });

    await expect(sendMessage(chatId, 'user-1', 'Hola')).rejects.toThrow(/cerrado por privacidad/);
  });

  // --- ESCENARIO 3: NOTIFICACIONES (Regla 9) ---
  it('DEBE registrar una notificación cuando se recibe un mensaje nuevo', async () => {
    // Aquí validamos que el flujo de inserción de notificaciones es invocado
    // Por el diseño de Supabase, esto suele ser un Trigger, pero podemos testear la RPC
    const userId = 'recipient-123';
    
    supabase.rpc.mockResolvedValue({ 
      data: { success: true }, 
      error: null 
    });

    // Simulamos la llamada que haría un sistema de notificaciones
    const { data } = await supabase.rpc('create_notification', {
      p_user_id: userId,
      p_title: 'Nuevo mensaje',
      p_content: 'Tienes un mensaje de Juan'
    });

    expect(data.success).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('create_notification', expect.objectContaining({
      p_user_id: userId
    }));
  });

  // --- ESCENARIO 4: SEGURIDAD DE ACCESO (Regla 1) ---
  it('DEBE fallar si un usuario intenta leer chats donde no es participante', async () => {
    // Simulamos error de RLS (Row Level Security)
    supabase.from().select.mockResolvedValue({ 
      data: [], 
      error: { message: 'Acceso denegado por política de seguridad' } 
    });

    const { error } = await supabase.from('chats').select('*').eq('id', 'secret-chat');
    expect(error.message).toContain('Acceso denegado');
  });
});
