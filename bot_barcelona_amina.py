import urllib.request
import urllib.parse
import time
import http.cookiejar
import ssl
from datetime import datetime

# DESACTIVAR VERIFICACIÓN SSL PARA EVITAR ERRORES DE CERTIFICADOS EN TERMUX
ssl._create_default_https_context = ssl._create_unverified_context

CONFIG = {
    "nombre": "AMINA CHAIR",
    "nie": "Y2086361E",
    "provincia": "8",
    "intervaloMinutos": 10
}

BASE_URL = "https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect"

print("==================================================")
print("🤖 BOT DE CITAS PREVIAS BARCELONA - PYTHON TERMUX")
print(f"👤 Citado: {CONFIG['nombre']} (NIE: {CONFIG['nie']})")
print("📍 Provincia: BARCELONA | Trámite: TOMA DE HUELLAS")
print(f"⏱️ Frecuencia: Cada {CONFIG['intervaloMinutos']} minutos (24/7 sin fallos)")
print("==================================================\n")

intento = 0

def check_citas():
    global intento
    intento += 1
    hora = datetime.now().strftime("%H:%M:%S")
    print(f"[{hora}] Intento #{intento}: Revisando citas disponibles en Barcelona...")

    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    opener.addheaders = [
        ('User-Agent', 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'),
        ('Accept-Language', 'es-ES,es;q=0.9')
    ]

    try:
        req1 = urllib.request.Request(BASE_URL)
        resp1 = opener.open(req1)

        post_data = urllib.parse.urlencode({
            'form': 'form',
            'form:provincia': CONFIG['provincia'],
            'form:btnAceptar': 'Aceptar'
        }).encode('utf-8')

        req2 = urllib.request.Request("https://icp.administracionelectronica.gob.es/icpplustieb/acProvincias", data=post_data)
        resp2 = opener.open(req2)
        html = resp2.read().decode('utf-8', errors='ignore')

        if "En este momento no hay citas disponibles" in html or "No hay citas disponibles" in html:
            print(f"[{hora}] ❌ Sin citas libres en Barcelona. Próximo intento en {CONFIG['intervaloMinutos']} min.\n")
            return

        if "Se ha producido un error" in html or "0301" in html:
            print(f"[{hora}] ⚠️ Respuesta del servidor. Se reintentará en el próximo ciclo.\n")
            return

        print(f"\n🎉🎉🎉 ¡¡¡ATENCIÓN: CITA DISPONIBLE DETECTADA EN BARCELONA PARA AMINA CHAIR!!! 🎉🎉🎉\n")
        print("Entra inmediatamente a la web para confirmar:")
        print(BASE_URL + "\n")

    except Exception as e:
        print(f"[{hora}] ⚠️ Error de conexión: {e}. Reintentando en el próximo ciclo.\n")

while True:
    check_citas()
    time.sleep(CONFIG['intervaloMinutos'] * 60)
