
import { test, expect } from '@playwright/test';

test.setTimeout(300000); 

const DRIVER = { email: 'driver.elite@shareway.test', pass: 'ShareWayTest2026!' };
const PASSENGER = { email: 'passenger.1@shareway.test', pass: 'ShareWayTest2026!' };

async function cleanAppOverlay(page) {
    // Esperar a que los loaders y la capa de login desaparezcan
    await page.waitForSelector('text=/Cargando|Sincronizando/i', { state: 'hidden', timeout: 30000 }).catch(() => {});
    // Pequeña pausa para que terminen las animaciones de CSS (fade-out)
    await page.waitForTimeout(1000);
}

test.describe('SHAREWAY V2 - MASTER TEST SUITE', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
    });

    test.describe('1. Autenticación', () => {
        test('Login y Limpieza de Interfaz', async ({ page }) => {
            await page.locator('input[type="email"]').fill(DRIVER.email);
            await page.locator('input[type="password"]').fill(DRIVER.pass);
            await page.locator('button[type="submit"]').click();
            await page.waitForURL('**/dashboard', { timeout: 20000 });
            await cleanAppOverlay(page);
            await expect(page.locator('header')).toBeVisible();
            console.log('✅ Login y Dashboard listos');
        });
    });

    test.describe('2. Reglas de Negocio', () => {
        test('Protección de Precios (0.60€/km)', async ({ page }) => {
            await page.locator('input[type="email"]').fill(DRIVER.email);
            await page.locator('input[type="password"]').fill(DRIVER.pass);
            await page.locator('button[type="submit"]').click();
            await page.waitForURL('**/dashboard');
            await cleanAppOverlay(page);

            await page.goto('/publish');
            await page.waitForSelector('input[placeholder*="donde"]', { timeout: 10000 });
            
            // Origen
            await page.getByPlaceholder(/Desde dónde/i).fill('Barcelona');
            await page.waitForSelector('ul li', { timeout: 10000 });
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            
            // Destino
            await page.getByPlaceholder(/A dónde/i).fill('Girona');
            await page.waitForSelector('ul li', { timeout: 10000 });
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');

            await page.locator('input[type="number"]').fill('300');
            // Clic forzado para ignorar posibles toasts que bloqueen
            await page.click('button:has-text("Publicar")', { force: true });
            
            await expect(page.locator('text=/Precio Justo|supera/i')).toBeVisible();
            console.log('✅ Precio bloqueado correctamente');
        });
    });

    test.describe('3. Finanzas', () => {
        test('Reserva y Saldo Retenido', async ({ page }) => {
            await page.locator('input[type="email"]').fill(PASSENGER.email);
            await page.locator('input[type="password"]').fill(PASSENGER.pass);
            await page.locator('button[type="submit"]').click();
            await page.waitForURL('**/dashboard');
            await cleanAppOverlay(page);

            // Seleccionar viaje del seed
            const rideCard = page.locator('div[class*="rounded"]').filter({ hasText: /Madrid|Barcelona|30/i }).first();
            await rideCard.click({ force: true });

            await page.waitForSelector('button:has-text("RESERVAR")', { timeout: 10000 });
            await page.click('button:has-text("RESERVAR")', { force: true });
            await page.click('text=/Saldo Cartera|Wallet/i', { force: true });
            
            await expect(page.locator('text=/PIN|Código/i')).toBeVisible({ timeout: 20000 });
            console.log('✅ Reserva financiera completada');
        });
    });

    test.describe('4. Impacto CO2', () => {
        test('Verificar Nueva Pestaña de Impacto', async ({ page }) => {
            await page.locator('input[type="email"]').fill(DRIVER.email);
            await page.locator('input[type="password"]').fill(DRIVER.pass);
            await page.locator('button[type="submit"]').click();
            await page.waitForURL('**/dashboard');
            await cleanAppOverlay(page);

            await page.goto('/settings');
            await page.click('text=Impacto Ambiental', { force: true });
            
            await expect(page.locator('text=/KG/i')).toBeVisible();
            await expect(page.locator('text=/Árboles|Trees/i')).toBeVisible();
            console.log('✅ Vista de Impacto CO2 verificada');
        });
    });
});
