# 📱 Guía de Automatización en el MÓVIL (Android e iPhone)

Si solo dispones de **teléfono móvil**, ¡sí es posible buscar la cita de forma automática! A continuación te explicamos exactamente cómo hacerlo para **Android** e **iPhone**.

---

## 📱 SI TIENES UN MÓVIL ANDROID

Tienes dos excelentes opciones en Android:

### Método A: Usar Python en el móvil (Opción 2) 🐍

Para ejecutar el script de Python directamente en tu teléfono Android sin ordenador:

1. Ve a **Google Play Store** y descarga la aplicación **Pydroid 3 - IDE for Python 3**.
2. Abre la app **Pydroid 3**.
3. Copia el código del archivo **`cita_automation_mobile.py`** que hemos preparado.
4. Pégalo dentro de **Pydroid 3**.
5. Pulsa el botón amarillo de **PLAY (Ejecutar)** abajo a la derecha.
6. El bot empezará a buscar la cita en bucle. Cuando encuentre una disponible, te avisará en la pantalla para que abras el navegador de tu móvil.

---

### Método B: Usar el Bot directamente en tu Navegador del Móvil ⭐ (¡El más fácil!)

En Android puedes usar navegadores que admiten la extensión **Tampermonkey**:

1. Ve a **Google Play Store** e instala **Kiwi Browser** (o **Lemur Browser**).
2. Abre **Kiwi Browser** y entra en la Chrome Web Store:
   👉 Busca **Tampermonkey** e instálalo.
3. Abre Tampermonkey en Kiwi Browser, crea un nuevo script y pega todo el código del archivo **`cita_barcelona_automation.user.js`**.
4. Entra desde Kiwi Browser a la web oficial:
   👉 **`https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect`**
5. ¡Listo! El bot rellenará los datos de **Amina Chair** y buscará la cita automáticamente en tu móvil.

---

## 🍎 SI TIENES UN IPHONE (iOS)

En iPhone, los sistemas restringidos no permiten instalar Python/Playwright fácilmente sin consola, pero **puedes usar el bot en Safari**:

1. Ve a la **App Store** en tu iPhone y descarga la app gratuita **Userscripts** (o **Stay - Userscript Extension**).
2. Abre **Ajustes** en tu iPhone -> **Safari** -> **Extensiones** -> Activa **Userscripts**.
3. Pega el código de `cita_barcelona_automation.user.js`.
4. Abre **Safari** y entra en:
   👉 **`https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect`**
5. El bot rellenará los datos de **Amina Chair** y te avisará con sonido cuando haya cita libre.

---

## 💡 Resumen y Recomendación

- Si quieres **Opción 2 (Python)** en Android: usa la app **Pydroid 3**.
- Si quieres la solución **más cómoda y visual en móvil**: usa **Kiwi Browser** + **Tampermonkey** en Android (o Safari + Userscripts en iPhone).
