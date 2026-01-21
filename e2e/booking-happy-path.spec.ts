import { test, expect } from '@playwright/test';

test.describe('Authenticated User Flow', () => {

    test.beforeEach(async ({ page }) => {
        console.log(`🔍 [${test.info().title}] Goto / and wait for load...`);
        await page.goto('/', { waitUntil: 'load' });

        // Esperamos a que desaparezca cualquier loader (Cargando..., Validando...)
        console.log('⏳ Waiting for loaders to clear...');
        const loaders = page.locator('text=/Cargando|Validando/i');
        try {
            await expect(loaders).not.toBeVisible({ timeout: 30000 });
        } catch (e) {
            console.warn('⚠️ Loaders still visible or not found, continuing...');
        }

        // Buscamos un elemento ancla del dashboard
        console.log('⏳ Waiting for "Ofrecer" button...');
        await expect(page.getByText(/Ofrecer/i).first()).toBeVisible({ timeout: 30000 });
        console.log('✅ Dashboard Ready');
    });

    test('should allow user to navigate to Publish Ride', async ({ page }) => {
        const publishBtn = page.getByText(/Ofrecer/i).first();
        await publishBtn.click();

        await expect(page).toHaveURL(/.*publish/);
        await expect(page.getByText(/¿A dónde vas?/i).first()).toBeVisible({ timeout: 15000 });
    });

    test('should allow user to interact with Search in Dashboard', async ({ page }) => {
        const searchInput = page.getByPlaceholder(/destino/i);
        await expect(searchInput).toBeVisible({ timeout: 15000 });
        await searchInput.fill('Madrid');
    });

    test('should navigate to settings', async ({ page }) => {
        const settingsLink = page.getByText(/Ajustes/i).first();
        await expect(settingsLink).toBeVisible({ timeout: 15000 });
        await settingsLink.click();

        await expect(page).toHaveURL(/.*settings/);
        await expect(page.getByText(/Test Driver/i).first()).toBeVisible({ timeout: 15000 });
    });
});
