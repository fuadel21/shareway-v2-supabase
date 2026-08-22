#!/usr/bin/env python3
"""
Bot Ligero de Cita Previa Extranjería para MÓVIL (Android con Pydroid 3 / Termux)
Sin necesidad de navegadores pesados ni Playwright.
Soporta bypass SSL para Android/Pydroid 3.

Datos:
  Nombre: AMINA CHAIR
  NIE: Y2086361E
  Nacionalidad: MARRUECOS
  Provincia: BARCELONA
"""

import time
import urllib.request
import urllib.parse
import ssl
from http.cookiejar import CookieJar

# Configuración de tus datos
CONFIG = {
    "provincia_id": "8", # 8 = Barcelona
    "nombre": "AMINA CHAIR",
    "nie": "Y2086361E",
    "nacionalidad": "248", # 248 = Marruecos
    "intervalo_segundos": 15
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9",
}

def main():
    print("=== BOT CITA EXTRANJERÍA BARCELONA (OPCIÓN MÓVIL) ===")
    print(f"👤 Nombre: {CONFIG['nombre']}")
    print(f"🆔 NIE: {CONFIG['nie']}")
    print(f"📍 Provincia: Barcelona\n")

    # Configuración de SSL sin verificación para Android / Pydroid 3
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    cookie_jar = CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=ctx),
        urllib.request.HTTPCookieProcessor(cookie_jar)
    )

    intentos = 0

    while True:
        intentos += 1
        print(f"🔄 Intento #{intentos} - Comprobando disponibilidad de citas...")

        try:
            # 1. Cargar la página inicial
            req1 = urllib.request.Request("https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect", headers=HEADERS)
            resp1 = opener.open(req1, timeout=15).read().decode('utf-8', errors='ignore')

            # 2. Enviar Provincia (Barcelona)
            post_data_prov = urllib.parse.urlencode({"form": CONFIG["provincia_id"], "btnAceptar": "Aceptar"}).encode('utf-8')
            req2 = urllib.request.Request("https://icp.administracionelectronica.gob.es/icpplustieb/acProvincia", data=post_data_prov, headers=HEADERS)
            resp2 = opener.open(req2, timeout=15).read().decode('utf-8', errors='ignore')

            # 3. Comprobar texto de la respuesta
            if "En este momento no hay citas disponibles" in resp2 or "No hay citas disponibles" in resp2:
                print(f"❌ Intento #{intentos}: No hay citas en este momento. Reintentando en {CONFIG['intervalo_segundos']}s...")
            elif "Seleccione" in resp2 or "Teléfono" in resp2 or "Solicitar Cita" in resp2:
                print("\n🎉🎉🎉 ¡¡¡ATENCIÓN: CITA DISPONIBLE DETECTADA EN BARCELONA!!! 🎉🎉🎉")
                print("¡Abre tu navegador web en el móvil inmediatamente para completar la reserva!")
                break
            else:
                print(f"ℹ️ Respuesta del servidor procesada (Intento #{intentos}). Esperando...")

        except Exception as e:
            print(f"⚠️ Aviso en intento #{intentos}: {e}")

        time.sleep(CONFIG["intervalo_segundos"])

if __name__ == "__main__":
    main()
