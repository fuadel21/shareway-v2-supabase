import { test as setup, expect } from '@playwright/test';

const authFile = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
    setup.setTimeout(60000);

    console.log('🔐 Authenticating as Test Driver...');

    await page.goto('/login', { waitUntil: 'load' });

    // Esperar a que el botón de login sea visible para asegurar que la página cargó
    const loginBtn = page.getByRole('button', { name: /Iniciar Sesión/i });
    await expect(loginBtn).toBeVisible({ timeout: 20000 });

    console.log('📝 Filling login form...');
    await page.getByPlaceholder('hola@shareway.com').fill('driver.elite@shareway.test');
    await page.getByPlaceholder('••••••••').fill('ShareWayTest2026!');

    await loginBtn.click();
    console.log('🚀 Login button clicked, waiting for redirect...');

    // Esperamos a ver un elemento del Dashboard/MainLayout que confirme el login
    // "Explorar" es el primer item del nav inferior.
    try {
        await expect(page.getByText(/Explorar/i).first()).toBeVisible({ timeout: 40000 });
        console.log('✅ Authentication successful - Dashboard reached');

        // Protector: esperar un momento para que el session stay se estabilice en storage
        await page.waitForTimeout(2000);

        await page.context().storageState({ path: authFile });
    } catch (e) {
        console.error('❌ Authentication Failed or Timeout waiting for Dashboard');

        // Capturar estado de la URL y contenido para debug
        console.log('Current URL:', page.url());
        const bodyText = await page.innerText('body');
        console.log('Body snippet:', bodyText.substring(0, 500));

        await page.screenshot({ path: 'auth-failure-debug.png' });
        throw e;
    }
});
