# 📱 Manual MÓVIL — Bot de Citas Barcelona para Amina Chair (v9.6 "Anti-Congelamiento")

**Gestor de usuarioscripts: TAMPERMONKEY** · Navegador: **Firefox Android** (también vale Kiwi/Lemur con Tampermonkey).

- 👤 Nombre y apellidos: **AMINA CHAIR** · NIE: **Y2086361E** · Nacionalidad: **MARRUECOS**
- 📍 Provincia: **BARCELONA** · Trámite: **POLICIA - TOMA DE HUELLAS (RENOVACIÓN DE TARJETA)**
- 📱 Teléfono: **698233413** · ✉️ Email del justificante: **fuadel21@hotmail.com**
- 🔁 Búsqueda **cada 7 minutos, 24 h, los 7 días de la semana** (recarga 100% automática)
- 🔊 **Funciona con Firefox en segundo plano** (audio silencioso anti-congelamiento de Android)
- ⚡ Reserva **instantánea** en la primera oficina y hora disponibles

---

## 1. Instalar / Actualizar el script en Tampermonkey (Firefox Android)

### Método A — "Install from URL" (el más fiable en el móvil) ⭐

1. Abre **Firefox** y entra en una pestaña nueva: `about:blank`.
2. Menú **⋮ → Extensiones → Tampermonkey** (se abre el panel del gestor).
3. Ve a **Utilidades (Utilities)**.
4. En el campo **"Install from URL"** pega esta dirección y pulsa **Instalar**:

```
https://raw.githubusercontent.com/fuadel21/shareway-v2-supabase/arena/01a025e6-shareway-v2-supabase/cita_barcelona_amina.user.js
```

5. Tampermonkey mostrará la pantalla de instalación/actualización: revisa que **Version: 9.4** y pulsa **Reinstalar / Actualizar**.

### Método B — Abrir el enlace directamente

Pega la dirección anterior en la barra de Firefox. Tampermonkey la intercepta y abre su pantalla de instalación → pulsa el botón **Instalar/Actualizar**.

### Método C — Pégalo a mano (si los anteriores fallan)

1. Tampermonkey → **Panel / Dashboard** → toca el script **"Bot Cita Previa Barcelona..."** → se abre el editor.
2. Selecciona todo el código antiguo y bórralo.
3. Pega el **código completo de la v9.3** (el de la URL de arriba) y pulsa el icono **💾 Guardar** (arriba a la derecha del editor).

> ⚠️ **MUY IMPORTANTE — el `@name` no se toca.** Este archivo mantiene **el mismo `@name` y `@namespace` que la v9.2** a propósito: así Tampermonkey lo reconoce como **actualización del mismo script** y no crea uno nuevo. Si lo renombras tendrás **dos bots a la vez**.
> Tampoco cambies `@grant none` (es lo que permite anular el diálogo *"¿Desea salir?"* del portal).

### Comprobar que NO hay duplicados

En el **Dashboard** de Tampermonkey busca scripts que actúen sobre `icp.administracionelectronica.gob.es`. **Debe haber solo uno**. Si ves dos (por ejemplo uno con versión 9.2 y otro 9.3), **borra el de la 9.2** y deja la 9.3. (Aun así, la v9.3 lleva una guardia anti-duplicados: si quedara la 9.2 instalada, arranca antes y la desactiva sola, pero mejor déjalo limpio.)

---

## 2. Permisos y ajustes en el móvil (IMPRESCINDIBLES para 24/7) ⚠️

> **Por qué hace falta esto:** Android **congela** las apps en segundo plano y Firefox suspende las pestañas inactivas. Con la app congelada, **ningún** script (ni el meta-refresh) puede ejecutarse. La v9.6 lo resuelve reproduciendo un **tono de 60 Hz prácticamente inaudible**: mientras hay audio en marcha, Android trata a Firefox como "reproductor" y **no lo congela**, así que la recarga de los 7 minutos sigue funcionando con la pantalla apagada.

1. **🔊 Activa el modo segundo plano en la web**: al abrir la página, toca el botón morado **"🔊 ACTIVAR SEGUNDO PLANO"** (o simplemente toca una vez en cualquier parte de la página). El panel debe pasar a **"🔊 Segundo plano: ACTIVO ✅ / ESPERANDO TOQUE 🔑"**. Verás una notificación de reproducción de Firefox: es normal, es el tono silencioso.
2. **Permite el autoplay (muy recomendable)**: Firefox → **Ajustes → Permisos del sitio → Reproducción automática → "Permitir audio y vídeo"**. Así el modo segundo plano se reactiva **solo** después de cada recarga, sin tener que tocar nada.
3. **Notificaciones**: pulsa **"🔔 ACTIVAR AVISOS"** y acepta *Permitir*. Si aparece el candado 🔒 en la barra de direcciones, activa ahí las notificaciones del sitio.
4. **Android → Ajustes → Aplicaciones → Firefox → Batería → "Sin restricciones" / "No optimizar"**, y activa **"Permitir actividad en segundo plano"** si tu móvil lo muestra.
5. **No cierres la pestaña ni deslices Firefox fuera de las apps recientes.** Puedes apagar la pantalla y cambiar de app sin problema.
6. **Ajustes de Tampermonkey**: Configuración → *Config mode: Advanced* → **Inject Mode: Instantáneo**, si notas que el bot no arranca al instante en algún arranque del navegador.

### Opción 100 % garantizada (si tu móvil es muy agresivo matando apps)

Android → **Ajustes → Opciones de desarrollo → "Mantener pantalla activada mientras está cargando"** (o "Stay awake") → conecta el cargador y deja Firefox **en primer plano** con la página del bot. La pantalla no se apagará nunca y el bot trabaja sin interrupciones (baja el brillo al mínimo para no dañar la pantalla).

---

## 3. Qué debe verse en el panel del bot

Al entrar en `https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect` verás un recuadro azul abajo:

```
🤖 BOT BARCELONA v9.6 · Tampermonkey 🟢        [INTENTO #N]
👤 AMINA CHAIR (Y2086361E) · 📍 BARCELONA · TOMA DE HUELLAS
📱 698233413 · ✉️ fuadel21@hotmail.com
(paso actual: provincia → trámite → Entrar → datos → solicitar cita)
⏱️ Próxima recarga en: 04:12 · motor nativo armado ✅ (420s)
🔊 Segundo plano: ACTIVO ✅ / ESPERANDO TOQUE 🔑 (Android no congelará Firefox)
```
*(Botones que pueden aparecer: 🔊 ACTIVAR SEGUNDO PLANO, 🔔 ACTIVAR AVISOS —ambos desaparecen cuando ya están activos— y 🔁 REANUDAR BÚSQUEDA solo si el bot encontró cita.)*

- El contador **baja de 07:00 a 00:00** y al llegar a cero la página **se recarga sola** para volver a buscar (aunque estés en otra app o con la pantalla apagada).
- **No hay ningún botón de recarga ni nada que pulsar**: el ciclo de 7 minutos es totalmente automático, 24 h, los 7 días.
- Si detecta una cita: fondo verde, **alarma sonora + vibración VIP**, notificación Android y el panel muestra *"🎉 ¡CITA DETECTADA EN BARCELONA!"*. La recarga se pausa automáticamente para **no perder la reserva** y se envían los datos de contacto (teléfono/email) al formulario oficial para que llegue el justificante a **fuadel21@hotmail.com**.

---

## 4. Si algún día el contador se quedara parado

1. **Si el panel dice "⚠️ congelado N min la última vez"**: es el aviso de que Android congeló Firefox mientras estaba en segundo plano. El bot **ya se reanudó solo** con el primer ciclo nuevo; asegúrate de que el punto 2.1 (🔊 segundo plano ACTIVO ✅) y el autoplay estén configurados.
2. Si el panel dice "🔊 Segundo plano: INACTIVO", toca el botón morado. Si sigue inactivo, activa el autoplay de Firefox (punto 2.2).
3. Recarga la pestaña a mano (menú de Firefox → **Recargar**): el bot reanudará el ciclo de 7 minutos él solo.
4. Comprueba en el panel del bot que dice **"motor nativo armado ✅ (420s)"** y **"🔊 Segundo plano: ACTIVO ✅ / ESPERANDO TOQUE 🔑"**. Si el segundo plano aparece INACTIVO revisa los puntos 2.1 y 2.2; si el motor se queda en *"re-armándose..."*, revisa el Inject Mode: Instantáneo (punto 2.6) y recarga la página una vez.
4. Comprueba que Tampermonkey tiene el script **activado** (interruptor verde en el Dashboard) y que solo hay **un** script para este sitio.
5. Diagnóstico avanzado (ordenador con Firefox de escritorio sobre la misma página, o depuración remota): el bot expone el objeto `__BOT_BARCELONA` con `segundosRestantes()`, `metaRefreshArmado()`, `recargarAhora()`, `pausar()` y `reanudar()`.

*Versión del documento: v9.6 — Anti-Congelamiento (búsqueda cada 7 minutos, recarga 100% automática sin botones, modo segundo plano con audio de 60 Hz + wake lock, latido de actividad y reanudación inmediata al volver del congelamiento).*
