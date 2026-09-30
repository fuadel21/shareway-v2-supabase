import https from 'https';

const CONFIG = {
  nombre: "AMINA CHAIR",
  nie: "Y2086361E",
  pais: "248", // MARRUECOS
  provincia: "8", // BARCELONA
  intervaloMinutos: 10
};

const BASE_URL = "https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect";

console.log("==================================================");
console.log("🤖 BOT DE CITAS PREVIAS BARCELONA - TERMUX / NODE.JS");
console.log(`👤 Citado: ${CONFIG.nombre} (NIE: ${CONFIG.nie})`);
console.log(`📍 Provincia: BARCELONA | Trámite: TOMA DE HUELLAS`);
console.log(`⏱️ Frecuencia: Cada ${CONFIG.intervaloMinutos} minutos (24/7 sin fallos)`);
console.log("==================================================\n");

let intento = 0;

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

    if (cookie) {
      options.headers['Cookie'] = cookie;
    }

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

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function checkCitas() {
  intento++;
  const hora = new Date().toLocaleTimeString();
  console.log(`[${hora}] Intento #${intento}: Revisando citas disponibles en Barcelona...`);

  try {
    // 1. Obtener la página inicial y cookies de sesión
    const step1 = await makeRequest(BASE_URL);
    const sessionCookie = step1.cookie;

    // 2. Seleccionar Provincia Barcelona
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

    console.log(`\n🎉🎉🎉 ¡¡¡ATENCIÓN: CITA DISPONIBLE DETECTADA EN BARCELONA PARA AMINA CHAIR!!! 🎉🎉🎉\n`);
    console.log("Entra inmediatamente a la web para confirmar:");
    console.log(BASE_URL + "\n");

  } catch (e) {
    console.log(`[${hora}] ⚠️ Error de conexión: ${e.message}. Reintentando en el próximo ciclo.\n`);
  }
}

// Ejecutar inmediatamente
checkCitas();

// Programar cada N minutos
setInterval(checkCitas, CONFIG.intervaloMinutos * 60 * 1000);
