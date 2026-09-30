import https from 'https';

// CONFIGURACIÓN CON TELEGRAM
const CONFIG = {
  nombre: "AMINA CHAIR",
  nie: "Y2086361E",
  pais: "248", // MARRUECOS
  provincia: "8", // BARCELONA
  intervaloMinutos: 10,
  telegramToken: "AQUÍ_TU_BOT_TOKEN", // Poner tu Token de Telegram
  telegramChatId: "AQUÍ_TU_CHAT_ID"    // Poner tu Chat ID de Telegram
};

const BASE_URL = "https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect";

console.log("==================================================");
console.log("🤖 BOT CITA BARCELONA + NOTIFICACIONES TELEGRAM 24/7");
console.log(`👤 Citado: ${CONFIG.nombre} (NIE: ${CONFIG.nie})`);
console.log(`📍 Provincia: BARCELONA | Trámite: TOMA DE HUELLAS`);
console.log(`⏱️ Frecuencia: Cada ${CONFIG.intervaloMinutos} minutos`);
console.log("==================================================\n");

function sendTelegramMessage(text) {
  if (!CONFIG.telegramToken || CONFIG.telegramToken.includes("AQUÍ_TU")) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      chat_id: CONFIG.telegramChatId,
      text: text,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${CONFIG.telegramToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });

    req.on('error', (e) => resolve());
    req.write(postData);
    req.end();
  });
}

function makeRequest(url, method = "GET", postData = null, cookie = "") {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9'
      }
    };

    if (cookie) options.headers['Cookie'] = cookie;
    if (postData) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let body = '';
      let setCookies = res.headers['set-cookie'] || [];
      let newCookie = setCookies.map(c => c.split(';')[0]).join('; ');

      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body,
          cookie: newCookie || cookie
        });
      });
    });

    req.on('error', (e) => reject(e));
    if (postData) req.write(postData);
    req.end();
  });
}

let intento = 0;

async function checkCitas() {
  intento++;
  const hora = new Date().toLocaleTimeString();
  console.log(`[${hora}] Intento #${intento}: Revisando citas disponibles en Barcelona...`);

  try {
    const step1 = await makeRequest(BASE_URL);
    const sessionCookie = step1.cookie;

    const postDataP1 = new URLSearchParams({
      'form': 'form',
      'form:provincia': CONFIG.provincia,
      'form:btnAceptar': 'Aceptar'
    }).toString();

    const step2 = await makeRequest("https://icp.administracionelectronica.gob.es/icpplustieb/acProvincias", "POST", postDataP1, sessionCookie);
    const html = step2.body;

    if (html.includes("En este momento no hay citas disponibles") || html.includes("No hay citas disponibles")) {
      console.log(`[${hora}] ❌ Sin citas libres en Barcelona. Próximo intento en ${CONFIG.intervaloMinutos} min.\n`);
      return;
    }

    if (html.includes("Se ha producido un error") || html.includes("0301")) {
      console.log(`[${hora}] ⚠️ Respuesta del servidor. Se reintentará en el próximo ciclo.\n`);
      return;
    }

    const msg = `🎉 <b>¡¡¡ATENCIÓN: CITA DETECTADA EN BARCELONA!!!</b> 🎉\n\n👤 <b>Amina Chair</b> (NIE: Y2086361E)\n📍 <b>Provincia</b>: Barcelona (Toma Huellas)\n\n👉 <b>Entra inmediatamente aquí:</b>\n${BASE_URL}`;
    
    console.log(`\n${msg}\n`);
    await sendTelegramMessage(msg);

  } catch (e) {
    console.log(`[${hora}] ⚠️ Error de conexión: ${e.message}. Reintentando en el próximo ciclo.\n`);
  }
}

// Mensaje inicial de confirmación
sendTelegramMessage(`🤖 <b>Bot Cita Barcelona Activado</b>\nBuscando citas cada 10 minutos para <b>Amina Chair</b>.`);

checkCitas();
setInterval(checkCitas, CONFIG.intervaloMinutos * 60 * 1000);
