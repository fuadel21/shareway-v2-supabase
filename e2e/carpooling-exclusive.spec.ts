
import { test, expect } from '@playwright/test';

test.setTimeout(400000); 

const DRIVER = { email: 'driver.elite@shareway.test', pass: 'ShareWayTest2026!' };
const PASSENGER = { email: 'passenger.1@shareway.test', pass: 'ShareWayTest2026!' };

async function waitForAppReady(page) {
    await page.waitForLoadState('networkidle');
    const loader = page.locator('text=/Cargando|Sincronizando/i');
    await expect(loader).not.toBeVisible({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000); // Pausa para animaciones
}

async function login(page, user) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.pass);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/dashboard', { timeout: 20000 });
    await waitForAppReady(page);
}

test.describe('SHAREWAY V2 - ECOSISTEMA CARPOOLING', () => {

    test('1. Flujo Maestro: Oferta -> Reserva -> Chat -> PIN -> Cobro', async ({ page, browser }) => {
        console.log('🚀 Iniciando flujo maestro...');

        // --- CONDUCTOR PUBLICA ---
        await login(page, DRIVER);
        await page.goto('/publish');
        await waitForAppReady(page);

        console.log('📍 Seleccionando Origen...');
        const originInput = page.getByPlaceholder(/Desde dónde/i);
        await originInput.click();
        await originInput.pressSequentially('Madrid', { delay: 100 });
        // Esperar a que aparezca la lista de sugerencias y hacer clic en la primera
        const originSuggestion = page.locator('ul li').first();
        await originSuggestion.waitFor({ state: 'visible', timeout: 15000 });
        await originSuggestion.click();
        
        console.log('📍 Seleccionando Destino...');
        const destInput = page.getByPlaceholder(/A dónde/i);
        await destInput.click();
        await destInput.pressSequentially('Barcelona', { delay: 100 });
        const destSuggestion = page.locator('ul li').first();
        await destSuggestion.waitFor({ state: 'visible', timeout: 15000 });
        await destSuggestion.click();
        
        await page.locator('input[type="number"]').fill('20');
        await page.click('button:has-text("Publicar")', { force: true });
        await page.click('button:has-text("Confirmar")', { force: true });
        
        await expect(page.locator('text=/éxito|publicado/i')).toBeVisible({ timeout: 15000 });
        console.log('✅ Viaje publicado');

        // --- PASAJERO RESERVA ---
        const userContext = await browser.newContext();
        const userPage = await userContext.newPage();
        await login(userPage, PASSENGER);
        
        console.log('🚗 Pasajero buscando viaje...');
        const rideCard = userPage.locator('div[class*="rounded"]').filter({ hasText: /Barcelona/i }).first();
        await expect(rideCard).toBeVisible({ timeout: 15000 });
        await rideCard.click({ force: true });

        await userPage.click('button:has-text("RESERVAR")', { force: true });
        await userPage.click('text=/Saldo Cartera/i', { force: true });
        
        await expect(userPage.locator('text=/Código/i')).toBeVisible({ timeout: 20000 });
        const pinText = await userPage.locator('p[class*="text-5xl"]').innerText();
        console.log(`✅ PIN obtenido: ${pinText}`);

        // --- CONDUCTOR FINALIZA ---
        await page.goto('/my-rides');
        await waitForAppReady(page);
        await page.locator('div[class*="rounded"]').first().click({ force: true });
        
        // Iniciar
        await page.click('button:has-text("INICIAR")', { force: true });
        
        // Validar con PIN
        await page.click('button:has-text("VALIDAR")', { force: true });
        await page.locator('input').first().fill(pinText);
        await page.click('button:has-text("Confirmar")', { force: true });
        
        // Cobrar
        await page.click('button:has-text("FINALIZAR")', { force: true });
        await expect(page.locator('text=/finalizado/i')).toBeVisible();
        
        console.log('🏁 FLUJO MAESTRO COMPLETADO');
    });
});
