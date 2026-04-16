
import { test, expect } from '@playwright/test';

test.describe('Shareway V2 - Blindaje de Creación y Reserva', () => {

  test.beforeEach(async ({ page }) => {
    // Login inicial para todas las pruebas
    await page.goto('/');
    await page.locator('input[type="email"]').fill('test_driver@shareway.com');
    await page.locator('input[type="password"]').fill('Password123!');
    await page.click('button:has-text("Iniciar sesión")');
    await expect(page.locator('nav')).toBeVisible();
  });

  test('Escenario A: Crear Viaje con Éxito y Bloquear Duplicado por Horario', async ({ page }) => {
    console.log('🚀 Probando creación de viaje y restricción de 2h...');
    
    // 1. Ir a Crear Viaje
    await page.click('[aria-label="Publicar"], text=Publicar');
    
    // 2. Rellenar Origen y Destino (Simulando selección de AddressAutocomplete)
    // Nota: En un test real, estos selectores deben ser precisos según tu AddressAutocomplete
    await page.getByPlaceholder('¿Desde dónde sales?').fill('Barcelona');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    
    await page.getByPlaceholder('¿A dónde vas?').fill('Madrid');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // 3. Configurar Precio y Asientos
    await page.locator('input[type="number"]').fill('20'); // Precio
    
    // 4. Publicar
    await page.click('button:has-text("Publicar Viaje")');
    await page.click('button:has-text("Confirmar")'); // AlertDialog

    // 5. Verificar Éxito
    await expect(page.locator('text=Viaje publicado con éxito')).toBeVisible();

    // 6. INTENTAR CREAR OTRO VIAJE EN LA MISMA HORA (Debe fallar)
    console.log('🛡️ Verificando bloqueo de solapamiento (±2h)...');
    await page.click('[aria-label="Publicar"]');
    await page.getByPlaceholder('¿Desde dónde sales?').fill('Barcelona');
    await page.getByPlaceholder('¿A dónde vas?').fill('Valencia');
    await page.click('button:has-text("Publicar Viaje")');
    await page.click('button:has-text("Confirmar")');

    // Debe aparecer el error de conflicto de horario que pusimos en el SQL
    await expect(page.locator('text=Conflicto de horario')).toBeVisible();
    console.log('✅ Bloqueo de solapamiento verificado.');
  });

  test('Escenario B: Bloqueo de Precio Abusivo (> 0.60€/km)', async ({ page }) => {
    console.log('💰 Probando política de Precio Justo...');
    
    await page.click('[aria-label="Publicar"]');
    await page.getByPlaceholder('¿Desde dónde sales?').fill('Barcelona');
    await page.getByPlaceholder('¿A dónde vas?').fill('Sitges'); // Distancia corta (~40km)
    
    // Intentamos poner 100€ por un viaje de 40km (claramente > 0.60€/km)
    await page.locator('input[type="number"]').fill('100'); 
    
    await page.click('button:has-text("Publicar Viaje")');
    
    // El sistema debe mostrar el error de "Política de Precio Justo"
    await expect(page.locator('text=Política de Precio Justo')).toBeVisible();
    console.log('✅ Política de precio justo verificada.');
  });

});
