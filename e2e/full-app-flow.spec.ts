
import { test, expect } from '@playwright/test';

test.describe('Shareway V2 - Flujo Crítico de Negocio', () => {
  
  test('Debe permitir login, reserva, chat y cancelación con reembolso', async ({ page }) => {
    // 1. Ir a la App (Vercel o Local)
    await page.goto('/');
    
    // 2. Login
    console.log('🔐 Iniciando sesión...');
    await page.waitForSelector('input[type="email"]');
    await page.locator('input[type="email"]').fill('test_passenger@shareway.com');
    await page.locator('input[type="password"]').fill('Password123!');
    await page.click('button:has-text("Iniciar sesión"), button:has-text("Login"), button[type="submit"]');

    // Esperar a que el Dashboard cargue (buscando el BottomNavBar o texto de bienvenida)
    await page.waitForURL('**/dashboard**', { timeout: 10000 }).catch(() => console.log('URL no cambió, pero seguimos...'));
    await expect(page.locator('nav')).toBeVisible();

    // 3. Buscar y Reservar un Viaje (BookingPaymentModal)
    console.log('🚗 Reservando viaje...');
    // Clic en la primera tarjeta de viaje que aparezca en el ExplorePage o Dashboard
    const rideCard = page.locator('text=Ver detalles, text=Detalles').first();
    await rideCard.click();
    
    // En RideDetails, buscar el botón de reserva
    const reserveBtn = page.locator('button:has-text("Reservar"), button:has-text("Confirmar y Pagar")');
    await reserveBtn.click();
    
    // Si aparece el modal de pago/confirmación
    const confirmBtn = page.locator('button:has-text("Confirmar Pago"), button:has-text("Pagar")');
    if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
    }

    // Verificar notificación de éxito (Toast o Sonner)
    await expect(page.locator('text=Reserva confirmada, text=éxito')).toBeVisible();

    // 4. Probar Chat (RideChat)
    console.log('💬 Probando Chat...');
    const chatTab = page.locator('text=Chat, [aria-label="Chat"]');
    await chatTab.click();
    
    const messageInput = page.getByPlaceholder('Escribe un mensaje...');
    await messageInput.fill('Hola! Confirmo mi plaza para el viaje.');
    await page.keyboard.press('Enter');
    
    // Verificar que el mensaje aparece en la burbuja
    await expect(page.locator('text=Confirmo mi plaza')).toBeVisible();

    // 5. Cancelar Reserva (Lógica de Reembolso 80/20)
    console.log('🔄 Cancelando con reembolso...');
    await page.click('text=Mis Viajes, [aria-label="Mis Viajes"]');
    
    // Clic en cancelar en el viaje activo
    await page.locator('button:has-text("Cancelar")').first().click();
    
    // IMPORTANTE: Verificar que el modal de cancelación advierta sobre la penalización del 20%
    await expect(page.locator('text=80%, text=penalización, text=reembolso')).toBeVisible();
    
    const finalCancelBtn = page.locator('button:has-text("Confirmar Cancelación"), button:has-text("Sí, cancelar")');
    await finalCancelBtn.click();

    // Verificar que se actualizó el estado a cancelado
    await expect(page.locator('text=Cancelado, text=Reserva cancelada')).toBeVisible();
    
    console.log('✅ TEST E2E COMPLETADO EXITOSAMENTE');
  });

});
