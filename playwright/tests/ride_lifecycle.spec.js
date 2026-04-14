import { test, expect } from '@playwright/test';

/**
 * SHARWAY E2E - CICLO DE VIDA COMPLETO DE UN VIAJE
 * Prueba el flujo desde creación hasta pago y valoración.
 */

test.describe('Flujo Completo de Carsharing', () => {
  
  test('debe permitir crear un viaje, reservarlo, chatear y finalizarlo', async ({ page }) => {
    // 1. LOGIN & PUBLICAR (Simulado como Conductor)
    await page.goto('/login');
    // Asumimos que hay un sistema de login o bypass para tests
    await page.fill('input[name="email"]', 'driver@test.com');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button[type="submit"]');

    await page.click('text=Ofrecer Plaza');
    await page.fill('input[placeholder*="Origen"]', 'Madrid');
    await page.fill('input[placeholder*="Destino"]', 'Barcelona');
    await page.fill('input[name="price"]', '25');
    await page.click('button:has-text("Publicar Viaje")');
    
    await expect(page.locator('text=Viaje publicado con éxito')).toBeVisible();

    // 2. BUSCAR Y RESERVAR (Simulado como Pasajero)
    // En un test real usaríamos dos contextos (browser contexts) diferentes
    // Aquí simulamos la navegación
    await page.goto('/explore');
    await page.fill('input[placeholder*="A dónde vas"]', 'Barcelona');
    await page.click('text=Barcelona'); // Seleccionar del dropdown
    
    // Seleccionar el primer resultado
    await page.locator('.ride-card').first().click();
    await page.click('text=Reservar Plaza');

    // 3. PAGO Y CHAT
    await page.click('text=Confirmar y Pagar');
    await expect(page.locator('text=Reserva Confirmada')).toBeVisible();

    // Abrir Chat
    await page.click('button[aria-label="chat"]');
    await page.fill('input[placeholder="Escribe un mensaje..."]', '¡Hola! Te espero en el punto de encuentro.');
    await page.keyboard.press('Enter');
    await expect(page.locator('text=¡Hola! Te espero')).toBeVisible();

    // 4. INICIO Y FINALIZACIÓN (Simulando Conductor recibiendo PIN)
    await page.goto('/my-rides');
    await page.click('text=Iniciar Viaje');
    
    // Pantalla de PIN
    await page.fill('input[name="pin"]', '1234'); // PIN de prueba
    await page.click('text=Validar Pasajero');
    await expect(page.locator('text=Pasajero validado')).toBeVisible();

    await page.click('text=Completar Viaje');
    await expect(page.locator('text=Viaje finalizado con éxito')).toBeVisible();

    // 5. VALORACIÓN
    await page.click('text=Valorar Conductor');
    await page.click('.star-rating >> nth=4'); // 5 estrellas
    await page.fill('textarea', 'Conductor excelente, muy puntual y amable.');
    await page.click('text=Enviar Reseña');
    
    await expect(page.locator('text=¡Gracias por tu opinión!')).toBeVisible();
  });
});
