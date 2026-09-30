import fetch from 'node-fetch';
import { CookieJar } from 'tough-cookie';
import fetchCookie from 'fetch-cookie';

// CONFIGURACIÓN DE AMINA CHAIR - BARCELONA
const CONFIG = {
  nombre: "AMINA CHAIR",
  nie: "Y2086361E",
  pais: "248", // MARRUECOS
  provincia: "8", // BARCELONA
  tramite: "4036", // POLICIA - TOMA DE HUELLAS (RENOVACIÓN DE TARJETA)
  intervaloMinutos: 10,
  telegramToken: "", // OPCIONAL: Token de Bot de Telegram para avisarte al móvil
  telegramChatId: "" // OPCIONAL: Tu ID de Telegram
};

const BASE_URL = "https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect";

console.log("==================================================");
console.log("🤖 BOT DE CITAS PREVIAS BARCELONA - SERVIDOR / TERMUX");
console.log(`👤 Citado: ${CONFIG.nombre} (NIE: ${CONFIG.nie})`);
console.log(`📍 Provincia: BARCELONA | Trámite: TOMA DE HUELLAS`);
console.log(`⏱️ Frecuencia: Cada ${CONFIG.intervaloMinutos} minutos (24/7 sin fallos)`);
console.log("==================================================\n");

let intento = 0;

async function checkCitas() {
  intento++;
  const hora = new Date().toLocaleTimeString();
  console.log(`[${hora}] Intento #${intento}: Revisando citas disponibles en Barcelona...`);

  const jar = new CookieJar();
  const client = fetchCookie(fetch, jar);

  try {
    // 1. Cargar página principal
    let res = await client(BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      }
    });

    // 2. Enviar Formulario Provincia Barcelona
    res = await client("https://icp.administracionelectronica.gob.es/icpplustieb/acProvincias", {
      method: "POST",
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      },
      body: new URLSearchParams({
        'form': 'form',
        'form:provincia': CONFIG.provincia,
        'form:btnAceptar': 'Aceptar'
      })
    });

    let html = await res.text();

    if (html.includes("En este momento no hay citas disponibles")) {
      console.log(`[${hora}] ❌ Sin citas libres en Barcelona. Próximo intento en ${CONFIG.intervaloMinutos} min.\n`);
      return;
    }

    if (html.includes("Se ha producido un error") || html.includes("0301")) {
      console.log(`[${hora}] ⚠️ Error de sesión de Extranjería. Reintentando...\n`);
      return;
    }

    console.log(`[${hora}] 🎉 ¡¡¡ATENCIÓN: CITA DISPONIBLE DETECTADA EN BARCELONA!!! 🎉`);
    
    // Enviar notificación Telegram si está configurado
    if (CONFIG.telegramToken && CONFIG.telegramChatId) {
      await fetch(`https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CONFIG.telegramChatId,
          text: `🎉 ¡¡¡CITA DISPONIBLE EN BARCELONA PARA AMINA CHAIR!!!\n\nEntra inmediatamente a:\n${BASE_URL}`
        })
      });
    }

  } catch (e) {
    console.log(`[${hora}] ⚠️ Error de conexión: ${e.message}. Se reintentará en el próximo ciclo.\n`);
  }
}

// Ejecutar inmediatamente
checkCitas();

// Programar cada N minutos
setInterval(checkCitas, CONFIG.intervaloMinutos * 60 * 1000);
