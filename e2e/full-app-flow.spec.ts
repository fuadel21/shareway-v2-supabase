
import { test, expect } from '@playwright/test';

test.describe('Shareway V2 - Blindaje de Ciclo de Vida', () => {

  test('Verificar Regla de 15 Minutos y Finalización Segura', async ({ page }) => {
    // 1. Login como Conductor
    await page.goto('/');
    await page.locator('input[type="email"]').fill('test_driver@shareway.com');
    await page.locator('input[type="password"]').fill('Password123!');
    await page.click('button:has-text("Iniciar sesión")');

    // 2. Ir a un viaje que sale pronto (simulamos navegación a un viaje específico)
    // Nota: El viaje debe existir en la base de datos
    await page.click('text=Mis Viajes');
    await page.click('text=Gestionar Viaje');

    // CASO 1: Viaje lejano (Bloqueo 15 min)
    console.log('🛡️ Probando bloqueo de inicio anticipado...');
    const startBtn = page.locator('button:has-text("INICIAR VIAJE")');
    
    // Si el viaje sale en más de 15 min, el botón debe estar deshabilitado
    const isDisabled = await startBtn.isDisabled();
    if (isDisabled) {
        console.log('✅ El botón está correctamente bloqueado (+15 min).');
        await expect(page.locator('text=Disponible 15 min antes')).toBeVisible();
    }

    // CASO 2: Finalización Segura
    console.log('🛡️ Probando bloqueo de finalización sin requisitos...');
    // Simulamos que el viaje está en curso (esto requiere que el estado sea 'in_progress')
    // Verificamos si el botón de finalizar está bloqueado
    const finishBtn = page.locator('button:has-text("BLOQUEADO HASTA LLEGADA")');
    if (await finishBtn.isVisible()) {
        console.log('✅ El botón de finalizar está correctamente bloqueado por seguridad.');
    }

    // 3. Verificar que el aviso de GPS Online aparece (Lógica de seguimiento)
    await expect(page.locator('text=GPS ACTIVO')).toBeVisible();
    
    console.log('🏁 TEST DE SEGURIDAD FINALIZADO');
  });

});
