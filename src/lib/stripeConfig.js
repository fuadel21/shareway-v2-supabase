/**
 * @fileoverview Archivo de configuración para centralizar los IDs de productos y precios de Stripe.
 * 
 * BENEFICIOS:
 * 1. Mantenimiento Sencillo: Todos los IDs en un solo lugar. Si cambian, solo se edita este archivo.
 * 2. Claridad: Evita tener IDs "mágicos" repartidos por el código.
 * 3. Coherencia: Asegura que tanto el frontend como (potencialmente) el backend usen los mismos IDs.
 */

// --- IDs de Precios para la Compra de Créditos ---
// --- ¡CORRECCIÓN CRÍTICA! ---
// Estos deben ser los IDs de los PRECIOS (empiezan con `price_...`), no los IDs de los Productos.
export const CREDIT_PACK_PRICES = {
    // Paquete de 5 Créditos
    CREDITS_5: 'price_1SNNQhPYWrbguaYvw0dO0DPF',
    
    // Paquete de 10 Créditos
    CREDITS_10: 'price_1SNNRLPYWrbguaYvT7awzvk8',

    // Paquete de 25 Créditos
    CREDITS_25: 'price_1SNNS1PYWrbguaYvxJB1QrRb',

    // Paquete de 50 Créditos
    CREDITS_50: 'price_1SNNSUPYWrbguaYv3z5mYVkZ',
};

// --- IDs de Productos (Opcional, pero buena práctica) ---
// Este ID sí es el del producto general (empieza con `prod_...`).
export const CREDIT_PRODUCT_ID = 'prod_TK1T6zYEg9ZC5R'; // Producto "Créditos"
