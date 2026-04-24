import { test, expect } from '@playwright/test';

/**
 * SHAREWAY COMPONENT AUDIT & E2E FLOW
 * Audita tarjetas de usuario, conductor y flujos de reserva/oferta.
 */

test.describe('Auditoría de Componentes y Flujos Críticos', () => {

    test.beforeEach(async ({ page }) => {
        // Bypass de autenticación (Simulamos sesión activa)
        // En un entorno real, esto usaría storageState o cookies de sesión
        await page.goto('/');
    });

    test('Audit: Tarjeta de Conductor en Detalles de Viaje', async ({ page }) => {
        // Navegamos a un viaje existente (usar ID de prueba)
        await page.goto('/ride/test-uuid'); // Asume un mock o data de test

        const driverCard = page.locator('div.rounded-\\[2\\.5rem\\].bg-white.p-6'); // Selector de la tarjeta

        await expect(driverCard).toBeVisible();
        await expect(driverCard.locator('h3')).toContainText(/conductor/i);
        await expect(driverCard.locator('text=Viajes')).toBeVisible();
        await expect(driverCard.locator('span.text-amber-700')).toBeVisible(); // Rating

        // Verificar info del vehículo
        await expect(driverCard.locator('text=Vehículo verificado')).toBeVisible();
    });

    test('Audit: Tarjeta de Pasajero y Código PIN', async ({ page }) => {
        // Simular que somos un pasajero con reserva
        await page.goto('/ride/test-uuid-booked');

        // El PIN de abordaje debe ser visible para el pasajero
        const pinSection = page.locator('text=Código de Abordaje');
        await expect(pinSection).toBeVisible();

        const pinCode = page.locator('.text-6xl.font-black.text-emerald-700');
        await expect(pinCode).toHaveText(/[0-9]{4}/); // Debe ser un número de 4 dígitos
    });

    test('E2E: Flujo de Ofrecer Plaza (Conductor)', async ({ page }) => {
        await page.goto('/publish');

        // Llenar formulario de oferta
        await page.fill('input[placeholder*="Origen"]', 'Madrid');
        await page.fill('input[placeholder*="Destino"]', 'Valencia');
        await page.fill('input[name="seats"]', '3');
        await page.fill('input[name="price"]', '15');

        await page.click('button:has-text("Publicar Oferta")');

        // Auditoría de la tarjeta resultante
        await expect(page).toHaveURL(/\/ride\//);
        await expect(page.locator('text=15€')).toBeVisible();
        await expect(page.locator('text=Control del Conductor')).toBeVisible();
    });

    test('E2E: Flujo de Reserva de Plaza (Pasajero)', async ({ page }) => {
        await page.goto('/explore');

        // Buscar y seleccionar viaje
        await page.locator('.ride-card').first().click();

        // Verificar visibilidad del precio y botón reservar
        await expect(page.locator('text=Por Plaza')).toBeVisible();
        const reserveBtn = page.locator('button:has-text("Reservar Plaza")');
        await expect(reserveBtn).toBeEnabled();

        await reserveBtn.click();

        // Verificar modal de pago (BookingPaymentModal)
        await expect(page.locator('text=Resumen de la Reserva')).toBeVisible();
        await page.click('button:has-text("Confirmar Pago")');

        // Post-reserva: verificar que aparece el PIN
        await expect(page.locator('text=Plaza Reservada')).toBeVisible();
        await expect(page.locator('text=Código de Abordaje')).toBeVisible();
    });

});
