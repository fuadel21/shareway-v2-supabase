import urllib.request
import urllib.parse
import time
import http.cookiejar
import ssl
import re
from datetime import datetime

ssl._create_default_https_context = ssl._create_unverified_context

CONFIG = {
    "nombre": "AMINA CHAIR",
    "nie": "Y2086361E",
    "pais": "248", // MARRUECOS
    "provincia": "8", // BARCELONA
    "telefono": "698233413",
    "email": "fuadel21@hotmail.com",
    "intervaloMinutos": 10
}

BASE_URL = "https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect"

print("==================================================")
print("🤖 BOT DE CITAS PREVIAS BARCELONA - TERMUX FULL AUTO 24/7")
print(f"👤 Citado: {CONFIG['nombre']} (NIE: {CONFIG['nie']})")
print("📍 Provincia: BARCELONA | Trámite: TOMA DE HUELLAS")
print(f"📱 Teléfono: {CONFIG['telefono']} | ✉️ Email: {CONFIG['email']}")
print(f"⏱️ Frecuencia: Cada {CONFIG['intervaloMinutos']} minutos (Sin fallos de batería)")
print("==================================================\n")

intento = 0

def extract_vs(html):
    m = re.search(r'javax\.faces\.ViewState[^\">]+value=\"([^\"]+)\"', html)
    if not m:
        m = re.search(r'value=\"([^\"]+)\"[^\">]+javax\.faces\.ViewState', html)
    return m.group(1) if m else ""

def check_citas():
    global intento
    intento += 1
    hora = datetime.now().strftime("%H:%M:%S")
    print(f"[{hora}] Intento #{intento}: Revisando citas disponibles en Barcelona...")

    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    opener.addheaders = [
        ('User-Agent', 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'),
        ('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
        ('Accept-Language', 'es-ES,es;q=0.9')
    ]

    try:
        # Paso 1: GET Inicial
        req1 = urllib.request.Request(BASE_URL)
        resp1 = opener.open(req1)
        html1 = resp1.read().decode('utf-8', errors='ignore')
        vs1 = extract_vs(html1)

        # Paso 2: Seleccionar Provincia Barcelona (8)
        p1 = urllib.parse.urlencode({
            'form': 'form',
            'form:provincia': CONFIG['provincia'],
            'form:btnAceptar': 'Aceptar',
            'javax.faces.ViewState': vs1
        }).encode('utf-8')

        req2 = urllib.request.Request("https://icp.administracionelectronica.gob.es/icpplustieb/acProvincias", data=p1)
        resp2 = opener.open(req2)
        html2 = resp2.read().decode('utf-8', errors='ignore')
        vs2 = extract_vs(html2)

        # Paso 3: Seleccionar Trámite TOMA DE HUELLAS
        m_tramite = re.search(r'select name=\"([^\"]+)\"', html2)
        tramite_sel_name = m_tramite.group(1) if m_tramite else "form:tramiteGrupo[0]"

        m_opt = re.search(r'<option value=\"([^\"]+)\"[^>]*>[^<]*TOMA DE HUELLAS[^<]*</option>', html2, re.IGNORECASE)
        tramite_val = m_opt.group(1) if m_opt else "4036"

        p2 = urllib.parse.urlencode({
            'form': 'form',
            tramite_sel_name: tramite_val,
            'form:btnAceptar': 'Aceptar',
            'javax.faces.ViewState': vs2
        }).encode('utf-8')

        req3 = urllib.request.Request("https://icp.administracionelectronica.gob.es/icpplustieb/acInfo", data=p2)
        resp3 = opener.open(req3)
        html3 = resp3.read().decode('utf-8', errors='ignore')
        vs3 = extract_vs(html3)

        # Paso 4: Pulsar Entrar
        p3 = urllib.parse.urlencode({
            'form': 'form',
            'btnEntrar': 'Entrar',
            'javax.faces.ViewState': vs3
        }).encode('utf-8')

        req4 = urllib.request.Request("https://icp.administracionelectronica.gob.es/icpplustieb/acEntrar", data=p3)
        resp4 = opener.open(req4)
        html4 = resp4.read().decode('utf-8', errors='ignore')
        vs4 = extract_vs(html4)

        # Paso 5: Introducir Datos Personales (Amina Chair, NIE, Marruecos)
        p4 = urllib.parse.urlencode({
            'form': 'form',
            'rdbTipoDoc': 'NIE',
            'txtIdCitado': CONFIG['nie'],
            'txtDesCitado': CONFIG['nombre'],
            'txtPaisNac': CONFIG['pais'],
            'btnEnviar': 'Aceptar',
            'javax.faces.ViewState': vs4
        }).encode('utf-8')

        req5 = urllib.request.Request("https://icp.administracionelectronica.gob.es/icpplustieb/acValidar", data=p4)
        resp5 = opener.open(req5)
        html5 = resp5.read().decode('utf-8', errors='ignore')
        vs5 = extract_vs(html5)

        # Paso 6: Solicitar Cita
        p5 = urllib.parse.urlencode({
            'form': 'form',
            'btnEnviar': 'Solicitar Cita',
            'javax.faces.ViewState': vs5
        }).encode('utf-8')

        req6 = urllib.request.Request("https://icp.administracionelectronica.gob.es/icpplustieb/acCitaPrv", data=p5)
        resp6 = opener.open(req6)
        html6 = resp6.read().decode('utf-8', errors='ignore')

        if "En este momento no hay citas disponibles" in html6 or "No hay citas disponibles" in html6:
            print(f"[{hora}] ❌ Comprobados los 6 pasos. Sin citas libres en Barcelona. Próximo intento en {CONFIG['intervaloMinutos']} min.\n")
            return

        if "Se ha producido un error" in html6 or "0301" in html6:
            print(f"[{hora}] ⚠️ Respuesta del servidor de Extranjería. Se reintentará en el próximo ciclo.\n")
            return

        print(f"\n🎉🎉🎉 ¡¡¡ATENCIÓN: CITA DISPONIBLE DETECTADA Y RESERVADA EN BARCELONA FOR AMINA CHAIR!!! 🎉🎉🎉\n")
        print(f"Comprueba inmediatamente tu correo electrónico: {CONFIG['email']}\n")

    except Exception as e:
        print(f"[{hora}] ⚠️ Respuesta del servidor: {e}. Reintentando en el próximo ciclo.\n")

while True:
    check_citas()
    time.sleep(CONFIG['intervaloMinutos'] * 60)
