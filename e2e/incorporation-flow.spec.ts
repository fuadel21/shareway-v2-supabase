
import { test, expect } from '@playwright/test';

// Aumentamos el tiempo de espera global para este test
test.setTimeout(60000); 

test.describe('Shareway V2 - Flujo de Incorporación (Matching)', () => {

  test('Un conductor debe poder incorporar a un pasajero aceptando su solicitud', async ({ page }) => {
    // 1. LOGIN PASAJERO - Crea una solicitud
    console.log('👤 Pasajero creando solicitud...');
    
    // Intentamos cargar la página con un reintento si falla
    try {
      await page.goto('/', { waitUntil: 'networkidle', timeout: 45000 });
    } catch (e) {
      console.log('⚠️ Localhost no responde, ¿está ejecutando "npm run dev"?');
      throw e;
    }

    await page.locator('input[type="email"]').fill('test_passenger@shareway.com');
    await page.locator('input[type="password"]').fill('Password123!');
    await page.click('button:has-text("Iniciar sesión")');
    
    // Esperar a que el dashboard cargue
    await expect(page.locator('nav')).toBeVisible();

    await page.click('[aria-label="Solicitar"], text=Solicitar');
    await page.getByPlaceholder('¿Desde dónde sales?').fill('Barcelona');
    await page.getByPlaceholder('¿A dónde vas?').fill('Madrid');
    await page.locator('input[type="number"]').fill('15');
    await page.click('button:has-text("Publicar Solicitud")');
    
    // Verificar éxito
    await expect(page.locator('text=Solicitud publicada, text=éxito')).toBeVisible();
    
    console.log('✅ Solicitud creada. Cambiando a Conductor...');

    // Logout
    await page.goto('/settings');
    await page.click('text=Cerrar Sesión');

    // 2. LOGIN CONDUCTOR - Acepta la incorporación
    await page.locator('input[type="email"]').fill('test_driver@shareway.com');
    await page.locator('input[type="password"]').fill('Password123!');
    await page.click('button:has-text("Iniciar sesión")');

    await page.click('text=Explorar');
    await page.click('button:has-text("Solicitudes")');
    
    // Verificamos si aparece la solicitud
    const requestItem = page.locator('text=Barcelona → Madrid').first();
    await expect(requestItem).toBeVisible({ timeout: 10000 });
    await requestItem.click();
    
    // Acepta al pasajero
    await page.click('button:has-text("Aceptar Solicitud"), button:has-text("Incorporar")');
    
    // El sistema debe confirmar
    await expect(page.locator('text=Viaje creado, text=Pasajero incorporado')).toBeVisible();
    
    console.log('✅ Flujo de incorporación verificado exitosamente');
  });

});
