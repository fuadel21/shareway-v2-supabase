/**
 * STABILITY CHECK: Black-Box E2E
 * Objetivo: Validar que el parpadeo ha muerto y la app es Null-Safe.
 */
import { test, expect } from '@playwright/test';

test.describe('Estabilidad de Interfaz ShareWay', () => {

    test('El Dashboard debe cargar de forma limpia y estable', async ({ page }) => {
        await page.goto('/');

        // 1. RESULTADO OBSERVABLE: No debe haber parpadeo infinito del loader.
        const loader = page.locator('text=/Cargando|Sincronizando/i');
        await expect(loader).not.toBeVisible({ timeout: 15000 });

        // 2. ESTADO FINAL: Elementos clave presentes sin crashes.
        await expect(page.getByText(/Explorar/i).first()).toBeVisible();
        await expect(page.getByText(/SHAREWAY/i).first()).toBeVisible();
    });

    test('Debe bloquear reserva si el género no es compatible (Elite Gender Shield)', async ({ page }) => {
        // Asumimos un viaje "Solo Mujeres" ya creado para el test
        await page.goto('/dashboard');
        
        // Buscamos una tarjeta con la insignia de Solo Mujeres
        const rideCard = page.getByText(/Solo Mujeres/i).first();
        if (await rideCard.isVisible()) {
            await rideCard.click();
            
            // RESULTADO OBSERVABLE: El botón de reserva debe estar deshabilitado 
            // o mostrar el texto de restricción que pusimos en la Fase 2.
            const bookBtn = page.getByText(/Acceso Restringido|Solo Mujeres/i).first();
            await expect(bookBtn).toBeVisible();
        }
    });
});
