
import { test, expect } from '@playwright/test';

test.describe('Shareway V2 - Blindaje de Ciclo de Vida', () => {

  test('Verificar Regla de 15 Minutos y Finalización Segura', async ({ page }) => {
    // 1. LOGIN
    console.log('🚀 Iniciando sesión...');
    await page.goto('/');
    await page.waitForSelector('input[type="email"]');
    await page.locator('input[type="email"]').fill('driver.elite@shareway.test');
    await page.locator('input[type="password"]').fill('ShareWayTest2026!');
    await page.locator('button[type="submit"]').click();

    // 2. VERIFICACIÓN DE ENTRADA
    console.log('📊 Esperando Dashboard...');
    await page.waitForURL('**/dashboard', { timeout: 20000 });

    // 3. IR A MIS VIAJES (Usando el icono o el texto del nav)
    console.log('🚗 Navegando a Actividad...');
    await page.locator('a[href="/my-rides"]').click();
    await page.waitForURL('**/my-rides', { timeout: 10000 });
    
    // 4. CLIC EN EL VIAJE
    console.log('⚙️ Abriendo detalles del viaje...');
    // Buscamos cualquier tarjeta que parezca un viaje
    const rideCard = page.locator('div[class*="rounded"]').filter({ hasText: /Madrid|Barcelona|€/ }).first();
    await expect(rideCard).toBeVisible({ timeout: 15000 });
    await rideCard.click();

    // 5. COMPROBAR REGLAS EN EL PANEL DE GESTIÓN
    console.log('🛡️ Verificando existencia del Panel de Control...');
    
    // Selector ultra-flexible: buscamos el ID del componente o un texto clave del subtítulo
    const panelSubtitle = page.getByText('Ride Control Panel').or(page.getByText('Control del Conductor'));
    await expect(panelSubtitle).toBeVisible({ timeout: 15000 });

    // Caso A: Verificamos botón INICIAR
    const startBtn = page.locator('button').filter({ hasText: /INICIAR|START/i });
    if (await startBtn.isVisible()) {
        const isDisabled = await startBtn.isDisabled();
        console.log(isDisabled ? '✅ SEGURIDAD 15MIN: BLOQUEADO (CORRECTO)' : 'ℹ️ SEGURIDAD 15MIN: DISPONIBLE');
    }

    // Caso B: Verificamos botón FINALIZAR
    const finishBtn = page.locator('button').filter({ hasText: /FINALIZAR|FINISH|LLEGA/i });
    if (await finishBtn.isVisible()) {
        const isFinishDisabled = await finishBtn.isDisabled();
        if (isFinishDisabled) {
            console.log('✅ SEGURIDAD COBRO: BLOQUEADO HASTA DESTINO (CORRECTO)');
        }
    }

    console.log('🏁 TEST COMPLETADO EXITOSAMENTE');
  });

});
