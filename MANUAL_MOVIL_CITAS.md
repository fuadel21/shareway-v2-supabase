# Manual móvil — Bot de citas Barcelona para Amina Chair (v9.7 «Estable»)

**Gestor:** Tampermonkey · **Navegador previsto:** Firefox Android.

- Nombre: **AMINA CHAIR** · NIE: **Y2086361E** · Nacionalidad: **MARRUECOS**
- Provincia: **BARCELONA** · Trámite: **POLICIA - TOMA DE HUELLAS (RENOVACIÓN DE TARJETA)**
- Revisión programada cada **7 minutos (420 s)** y recarga automática, sin botón de recarga.
- El script automatiza los pasos del formulario que puede reconocer y muestra en el panel qué paso ha detectado.

> **Límite importante:** ningún userscript puede garantizar funcionamiento 24/7 en Firefox Android. Android puede suspender o cerrar Firefox, y el audio/meta-refresh pueden ser bloqueados por permisos, batería, versión del navegador o por el propio portal. El modo de audio ayuda en algunos móviles, pero no es una garantía ni evita las protecciones del sitio.

---

## 1. Instalar o actualizar

1. Abre Firefox y pega esta URL en Tampermonkey → **Utilidades / Install from URL**:

   ```
   https://raw.githubusercontent.com/fuadel21/shareway-v2-supabase/arena/01a025e6-shareway-v2-supabase/cita_barcelona_amina.user.js
   ```

2. Comprueba que la pantalla indique **versión 9.7** y confirma **Actualizar/Reinstalar**.
3. En el Dashboard de Tampermonkey, comprueba que el script está activado y que hay **un solo** userscript para `icp.administracionelectronica.gob.es`.

No cambies `@name`, `@namespace` ni `@grant none`: se conservan para que Tampermonkey actualice el mismo script.

---

## 2. Permisos y funcionamiento en segundo plano

1. En la página del portal, usa el botón morado **ACTIVAR SEGUNDO PLANO** o toca una vez cualquier zona de la página. Si Firefox bloquea el audio, el panel dirá **ESPERANDO TOQUE** o **INACTIVO**.
2. Para que Firefox pueda intentar reactivar el audio tras una recarga, revisa **Ajustes de Firefox → Permisos del sitio → Reproducción automática** y permite audio para el portal, si esa opción está disponible en tu versión.
3. Si quieres avisos emergentes, pulsa **ACTIVAR AVISOS** y acepta el permiso de notificaciones.
4. En Android, configura Firefox con uso de batería **Sin restricciones / No optimizar** y permite actividad en segundo plano si el dispositivo ofrece esa opción.
5. No cierres la pestaña ni fuerces el cierre de Firefox. Si el sistema congela o termina el proceso, el bot no puede ejecutarse hasta que Firefox vuelva a abrirse.

El tono de fondo puede oírse dependiendo del móvil. El usuario puede desactivarlo desde los controles de reproducción de Firefox o retirando el permiso correspondiente.

---

## 3. Qué muestra el panel

El panel de estado debe permanecer estable; el contador se actualiza sin reconstruir el panel en cada sondeo. Puede indicar, por ejemplo:

- **Paso 1/5**: detectó la provincia y está enviando la selección.
- **Paso 2/5**: detectó el trámite y está enviando la selección.
- **Formulario de identidad detectado**: rellenando o esperando el botón del portal.
- **Sin citas disponibles**: la recarga automática queda programada para el final del ciclo.
- **No encuentro Barcelona / botón Aceptar / opción Toma de Huellas**: el HTML que recibió el móvil no coincide con los controles que el script espera; el bot no debe seguir haciendo clics a ciegas.
- **El portal no confirmó el envío**: el script deja de repetir ese clic para evitar solicitudes duplicadas y mantiene la recarga programada.

El contador busca recargar al llegar a **00:00**. No hay un botón de recarga manual en el panel. Si aparece una cita, verifica el resultado en la propia página oficial y sigue las indicaciones del portal; el script no puede garantizar que el servidor acepte o confirme una reserva.

---

## 4. Si vuelve a quedarse parpadeando o sin avanzar

1. Comprueba que el panel indique **v9.7**. Si indica otra versión, actualiza desde la URL de arriba.
2. Haz una captura donde se vea el texto del panel y el contenido de la página (oculta datos personales si aparecen). Envíala para identificar el control exacto que el portal está mostrando.
3. No instales una segunda copia ni dejes dos bots activos: pueden competir entre sí y provocar envíos duplicados.
4. Si el panel dice **ESPERANDO TOQUE**, toca una vez la página para reintentar activar el audio. Si dice que el envío no se confirmó, deja que actúe el ciclo automático y comprueba si el portal presenta un error.

Para diagnóstico avanzado, el script expone `window.__BOT_BARCELONA` en la consola de Firefox de escritorio/depuración remota, con el número de intento, segundos restantes y estado del meta-refresh.

*Documento actualizado para v9.7.*
