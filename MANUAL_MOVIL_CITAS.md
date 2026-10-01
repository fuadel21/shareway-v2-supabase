# 📱 Manual MÓVIL — Bot de Citas Barcelona para Amina Chair (v9.4 "Automático Total")

**Gestor de usuarioscripts: TAMPERMONKEY** · Navegador: **Firefox Android** (también vale Kiwi/Lemur con Tampermonkey).

- 👤 Nombre y apellidos: **AMINA CHAIR** · NIE: **Y2086361E** · Nacionalidad: **MARRUECOS**
- 📍 Provincia: **BARCELONA** · Trámite: **POLICIA - TOMA DE HUELLAS (RENOVACIÓN DE TARJETA)**
- 📱 Teléfono: **698233413** · ✉️ Email del justificante: **fuadel21@hotmail.com**
- 🔁 Búsqueda **cada 7 minutos, 24 h, los 7 días de la semana** (recarga 100% automática)
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

## 2. Permisos en el móvil (para que funcione 24/7)

1. **Notificaciones**: al abrir la web, el panel del bot muestra un botón rojo **"🔔 ACTIVAR AVISOS"** → púlsalo y acepta *Permitir*. Si sale el candado 🔒 en la barra de direcciones, entra ahí y activa las notificaciones del sitio.
2. **Android → Ajustes → Aplicaciones → Firefox → Batería → "Sin restricciones" / "No optimizar"**. Si Android mata Firefox, ninguna página puede recargarse.
3. Deja **Firefox abierto en segundo plano** con la pestaña del bot (no la cierres). El motor nativo del navegador recarga la página aunque la pantalla esté apagada.
4. **Ajustes recomendados de Tampermonkey**: Configuración → *Config mode: Advanced* → **Inject Mode: Instantáneo**, si notas que el bot no arranca al instante en algún arranque del navegador.

---

## 3. Qué debe verse en el panel del bot

Al entrar en `https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect` verás un recuadro azul abajo:

```
🤖 BOT BARCELONA v9.4 · Tampermonkey 🟢        [INTENTO #N]
👤 AMINA CHAIR (Y2086361E) · 📍 BARCELONA · TOMA DE HUELLAS
📱 698233413 · ✉️ fuadel21@hotmail.com
(paso actual: provincia → trámite → Entrar → datos → solicitar cita)
⏱️ Próxima recarga en: 04:12 · motor nativo armado ✅ (420s)
```
*(El único botón que puede aparecer es 🔔 ACTIVAR AVISOS, y solo hasta que concedas las notificaciones.)*

- El contador **baja de 07:00 a 00:00** y al llegar a cero la página **se recarga sola** para volver a buscar (aunque estés en otra app o con la pantalla apagada).
- **No hay ningún botón de recarga ni nada que pulsar**: el ciclo de 7 minutos es totalmente automático, 24 h, los 7 días.
- Si detecta una cita: fondo verde, **alarma sonora + vibración VIP**, notificación Android y el panel muestra *"🎉 ¡CITA DETECTADA EN BARCELONA!"*. La recarga se pausa automáticamente para **no perder la reserva** y se envían los datos de contacto (teléfono/email) al formulario oficial para que llegue el justificante a **fuadel21@hotmail.com**.

---

## 4. Si algún día el contador se quedara parado

1. Recarga la pestaña a mano (menú de Firefox → **Recargar**): el bot reanudará el ciclo de 7 minutos él solo.
2. Si sigue igual: comprueba que la pestaña no la haya matado Android (batería sin restricciones, punto 2.2).
3. Comprueba en el panel del bot la etiqueta del motor: debe decir **"motor nativo armado ✅ (420s)"**. Si se queda en *"motor nativo re-armándose..."*, revisa el **Inject Mode: Instantáneo** de Tampermonkey (punto 2.4) y recarga la página una vez.
4. Comprueba que Tampermonkey tiene el script **activado** (interruptor verde en el Dashboard) y que solo hay **un** script para este sitio.
5. Diagnóstico avanzado (ordenador con Firefox de escritorio sobre la misma página, o depuración remota): el bot expone el objeto `__BOT_BARCELONA` con `segundosRestantes()`, `metaRefreshArmado()`, `recargarAhora()`, `pausar()` y `reanudar()`.

*Versión del documento: v9.4 — Automático Total (búsqueda cada 7 minutos, recarga 100% automática al terminar el contador y sin botones; meta-refresh nativo armado antes de `load`, watchdog con fecha límite persistente y cascada de navegación con reintentos).*
