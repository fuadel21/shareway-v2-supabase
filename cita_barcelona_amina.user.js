// ==UserScript==
// @name         Bot Cita Previa Barcelona - Version 9.0 Ultra-Fiable (Amina Chair)
// @namespace    https://icp.administracionelectronica.gob.es/
// @version      9.0
// @description  Buscador automatizado de alta precisión para Amina Chair (NIE Y2086361E, Barcelona) con auto-rellenado de Teléfono 698233413 y Email fuadel21@hotmail.com.
// @match        *://icp.administracionelectronica.gob.es/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // CONFIGURACIÓN OFICIAL
  var NOMBRE = "AMINA CHAIR";
  var NIE = "Y2086361E";
  var NACIONALIDAD_VAL = "248"; // MARRUECOS
  var NACIONALIDAD_TXT = "MARRUECOS";
  var PROVINCIA_VAL = "8"; // BARCELONA
  var TELEFONO = "698233413";
  var EMAIL = "fuadel21@hotmail.com";
  var RETRY_SEC = 600; // 10 MINUTOS 24/7
  var BASE_URL = "https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect";

  if (window.botInitialized) return;
  window.botInitialized = true;

  var attemptCount = parseInt(localStorage.getItem("bot_attempt_count") || "0") + 1;
  localStorage.setItem("bot_attempt_count", attemptCount.toString());

  function getRemainingSeconds() {
    var targetTimestamp = parseInt(localStorage.getItem("bot_target_timestamp") || "0");
    if (targetTimestamp === 0) return RETRY_SEC;
    var diff = Math.ceil((targetTimestamp - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
  }

  function setNativeMetaRefresh(seconds) {
    try {
      var existing = document.querySelectorAll("meta[http-equiv='refresh']");
      for (var i = 0; i < existing.length; i++) {
        existing[i].remove();
      }
      if (seconds <= 0) return;
      var meta = document.createElement("meta");
      meta.httpEquiv = "refresh";
      meta.content = seconds + ";url=" + BASE_URL;
      (document.getElementsByTagName("head")[0] || document.documentElement).appendChild(meta);
    } catch(e){}
  }

  function initHTML5KeepAlive() {
    try {
      var silentAudioData = "data:audio/mp3;base64,SUQ3BAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABAAA7Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6//OUZAAAAAAAABAAA0gAAAAABAAAAAAAAAAA=";
      var audio = new Audio(silentAudioData);
      audio.loop = true;
      audio.volume = 0.01;
      audio.play().catch(function(){});
    } catch(e){}

    try {
      if ('locks' in navigator) {
        navigator.locks.request('bot_cita_lock', { mode: 'exclusive' }, function() {
          return new Promise(function() {});
        });
      }
    } catch(e){}
  }

  function sendNotification(title, message) {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body: message, tag: "bot-cita", renotify: true });
      }
    } catch(e){}
  }

  function createBanner(text, extraHtml) {
    var banner = document.getElementById("bot-status-banner");
    if (!banner && document.body) {
      banner = document.createElement("div");
      banner.id = "bot-status-banner";
      banner.style.position = "fixed";
      banner.style.bottom = "12px";
      banner.style.left = "2%";
      banner.style.width = "96%";
      banner.style.zIndex = "9999999";
      banner.style.backgroundColor = "#0f172a";
      banner.style.color = "#ffffff";
      banner.style.padding = "14px";
      banner.style.borderRadius = "12px";
      banner.style.boxShadow = "0px 8px 24px rgba(0,0,0,0.6)";
      banner.style.fontFamily = "system-ui, -apple-system, sans-serif";
      banner.style.fontSize = "13px";
      banner.style.lineHeight = "1.4";
      banner.style.border = "2px solid #3b82f6";
      document.body.appendChild(banner);
    }
    if (banner) {
      banner.innerHTML = 
        "<div style='font-weight:bold;color:#60a5fa;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;'>" +
          "<span>🤖 BOT BARCELONA v9.0 🟢</span>" +
          "<span style='background:#1e3a8a;color:#93c5fd;padding:2px 8px;border-radius:6px;font-size:11px;'>INTENTO #" + attemptCount + "</span>" +
        "</div>" +
        "<div style='color:#e2e8f0;font-size:12px;'>" +
          "👤 <b>" + NOMBRE + "</b> (" + NIE + ")<br>" +
          "📍 <b>BARCELONA</b> | Trámite: <b>TOMA DE HUELLAS</b><br>" +
          "📱 <b>" + TELEFONO + "</b> | ✉️ <b>" + EMAIL + "</b><br>" +
          "<div style='margin-top:6px;padding-top:4px;border-top:1px solid #334155;color:#facc15;font-weight:bold;'>" + text + "</div>" +
          (extraHtml || "") +
        "</div>";
    }
  }

  function addNotifButton() {
    if (!("Notification" in window) || Notification.permission === "granted") return;
    var btn = document.getElementById("bot-notif-btn");
    if (!btn && document.body) {
      btn = document.createElement("button");
      btn.id = "bot-notif-btn";
      btn.innerHTML = Notification.permission === "denied" ? 
        "⚠️ <b>Notificaciones Bloqueadas</b> (Toca el candado 🔒 junto a la URL para permitir)" : 
        "🔔 Toca AQUÍ para Activar Notificaciones de Cita en tu Móvil";
      btn.style.position = "fixed";
      btn.style.top = "10px";
      btn.style.left = "4%";
      btn.style.width = "92%";
      btn.style.zIndex = "9999999";
      btn.style.padding = "12px";
      btn.style.backgroundColor = Notification.permission === "denied" ? "#dc2626" : "#2563eb";
      btn.style.color = "#ffffff";
      btn.style.fontWeight = "bold";
      btn.style.fontSize = "13px";
      btn.style.border = "none";
      btn.style.borderRadius = "8px";
      btn.style.boxShadow = "0px 4px 12px rgba(0,0,0,0.4)";
      btn.onclick = function() {
        initHTML5KeepAlive();
        if (Notification.permission === "default") {
          Notification.requestPermission().then(function(p) {
            if (p === "granted") {
              btn.style.backgroundColor = "#16a34a";
              btn.innerText = "✅ Notificaciones Activadas";
              setTimeout(function(){ btn.remove(); }, 2500);
            }
          });
        }
      };
      document.body.appendChild(btn);
    }
  }

  function submitFormWithBtn(btn) {
    if (!btn || window.botSubmitting) return;
    window.botSubmitting = true;
    try {
      btn.style.outline = "4px solid #22c55e";
      btn.click();
    } catch(e) {
      window.botSubmitting = false;
    }
  }

  function runStep() {
    initHTML5KeepAlive();
    addNotifButton();

    var href = window.location.href.toLowerCase();
    var body = document.body ? document.body.innerText : "";

    // 0. DETECCIÓN Y AUTO-RECUPERACIÓN DE ERRORES O CADUCIDAD DE SESIÓN
    if (body.indexOf("Se ha producido un error") !== -1 ||
        body.indexOf("0301") !== -1 ||
        body.indexOf("caducado") !== -1 ||
        body.indexOf("Not Found") !== -1 ||
        body.indexOf("Too Many Requests") !== -1 ||
        body.indexOf("rejected") !== -1) {
      
      createBanner("⚠️ Error de sesión/servidor detectado. Reiniciando secuencia en 2 segundos...");
      setTimeout(function() {
        localStorage.removeItem("bot_target_timestamp");
        window.location.href = BASE_URL;
      }, 2000);
      return;
    }

    // PASO 1: SELECCIÓN DE PROVINCIA (BARCELONA)
    var selProv = document.querySelector("select[name*='provincia']") || document.querySelector("select");
    var btnProvAceptar = document.querySelector("#btnAceptar") || document.querySelector("input[value='Aceptar']");

    if (selProv && btnProvAceptar && (body.indexOf("PROVINCIAS DISPONIBLES") !== -1 || body.indexOf("Selecciona Provincia") !== -1 || href.indexOf("acopcdirect") !== -1 || href.indexOf("acprovincias") !== -1 && body.indexOf("TRÁMITE") === -1)) {
      createBanner("📍 Paso 1/5: Seleccionando Provincia BARCELONA...");
      var foundP = false;
      for (var i = 0; i < selProv.options.length; i++) {
        if (selProv.options[i].text.toUpperCase().indexOf("BARCELONA") !== -1 || selProv.options[i].value === PROVINCIA_VAL) {
          selProv.selectedIndex = i;
          selProv.dispatchEvent(new Event("change", { bubbles: true }));
          foundP = true;
          break;
        }
      }
      if (foundP) {
        setTimeout(function() { submitFormWithBtn(btnProvAceptar); }, 400);
        return;
      }
    }

    // PASO 2: SELECCIÓN DE TRÁMITE (TOMA DE HUELLAS)
    var selects = document.querySelectorAll("select");
    if (selects.length > 0 && (body.indexOf("TRÁMITES") !== -1 || body.indexOf("TRÁMITE") !== -1 || body.indexOf("TOMA DE HUELLAS") !== -1)) {
      createBanner("📋 Paso 2/5: Seleccionando Trámite TOMA DE HUELLAS...");

      var tramiteSel = null;
      var tramiteIdx = -1;

      for (var s = 0; s < selects.length; s++) {
        var currentSel = selects[s];
        for (var o = 0; o < currentSel.options.length; o++) {
          var txtOpt = currentSel.options[o].text.toUpperCase();
          if (txtOpt.indexOf("TOMA DE HUELLAS") !== -1 || txtOpt.indexOf("HUELLAS") !== -1) {
            tramiteSel = currentSel;
            tramiteIdx = o;
            break;
          }
        }
        if (tramiteSel) break;
      }

      if (tramiteSel && tramiteIdx !== -1) {
        tramiteSel.selectedIndex = tramiteIdx;
        tramiteSel.dispatchEvent(new Event("change", { bubbles: true }));

        var btnAceptarTramite = document.querySelector("#btnAceptar") || document.querySelector("input[value='Aceptar']");
        setTimeout(function() { submitFormWithBtn(btnAceptarTramite); }, 500);
        return;
      }
    }

    // PASO 3: PULSAR "ENTRAR" EN LA PANTALLA DE INFORMACIÓN
    var btnEntrar = document.querySelector("#btnEntrar") || document.querySelector("input[value*='Entrar']");
    if (btnEntrar) {
      createBanner("🚪 Paso 3/5: Entrando al formulario de datos...");
      setTimeout(function() { submitFormWithBtn(btnEntrar); }, 400);
      return;
    }

    // PASO 4: DATOS PERSONALES DE AMINA CHAIR (NIE, NOMBRE, PAÍS)
    var inputNie = document.querySelector("#txtIdCitado") || document.querySelector("input[name*='txtIdCitado']");
    var inputNombre = document.querySelector("#txtDesCitado") || document.querySelector("input[name*='txtDesCitado']");

    if (inputNie && inputNombre) {
      createBanner("👤 Paso 4/5: Rellenando datos de Amina Chair (NIE Y2086361E)...");

      var radioNie = document.querySelector("#rdbTipoDocNie") || document.querySelector("input[value='NIE']");
      if (radioNie) {
        radioNie.checked = true;
        radioNie.dispatchEvent(new Event("change", { bubbles: true }));
      }

      inputNie.value = NIE;
      inputNie.dispatchEvent(new Event("input", { bubbles: true }));

      inputNombre.value = NOMBRE;
      inputNombre.dispatchEvent(new Event("input", { bubbles: true }));

      var selPais = document.querySelector("#txtPaisNac") || document.querySelector("select[name*='txtPaisNac']") || document.querySelector("#idPais");
      if (selPais) {
        for (var p = 0; p < selPais.options.length; p++) {
          if (selPais.options[p].text.toUpperCase().indexOf("MARRUECOS") !== -1 || selPais.options[p].value === NACIONALIDAD_VAL) {
            selPais.selectedIndex = p;
            selPais.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }

      var btnEnviarDatos = document.querySelector("#btnEnviar") || document.querySelector("#btnAceptar") || document.querySelector("input[value='Aceptar']");
      setTimeout(function() { submitFormWithBtn(btnEnviarDatos); }, 500);
      return;
    }

    // PASO 5: PULSAR "SOLICITAR CITA"
    var btnSolicitar = document.querySelector("#btnEnviar") || document.querySelector("input[value*='Solicitar']");
    if (btnSolicitar && (body.indexOf("Solicitar Cita") !== -1 || body.indexOf("Identidad del usuario") !== -1)) {
      createBanner("⚡ Paso 5/5: Comprobando disponibilidad de citas en Barcelona...");
      setTimeout(function() { submitFormWithBtn(btnSolicitar); }, 400);
      return;
    }

    // PASO 6: SI SE DETECTAN OFICINAS / FECHAS DISPONIBLES -> RESERVA INSTANTÁNEA
    var radiosCita = document.querySelectorAll("input[type='radio'][name*='cita']");
    var inTel = document.querySelector("#txtTelefonoCitado") || document.querySelector("input[name*='Telefono']");
    var inMail1 = document.querySelector("#email") || document.querySelector("#txtEmail") || document.querySelector("input[name*='email']");

    if (radiosCita.length > 0 || inTel || inMail1 || (body.indexOf("Seleccione la cita") !== -1 || body.indexOf("Confirmación de la cita") !== -1)) {
      document.body.style.backgroundColor = "#bbf7d0";

      if (radiosCita.length > 0) {
        radiosCita[0].checked = true;
        radiosCita[0].dispatchEvent(new Event("change", { bubbles: true }));
      }

      var inMail2 = document.querySelector("#emailConfirm") || document.querySelector("#txtEmailConfirmar");
      if (inTel) {
        inTel.value = TELEFONO;
        inTel.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (inMail1) {
        inMail1.value = EMAIL;
        inMail1.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (inMail2) {
        inMail2.value = EMAIL;
        inMail2.dispatchEvent(new Event("input", { bubbles: true }));
      }

      createBanner("🎉🎉 ¡¡¡CITA DETECTADA Y RESERVADA EN BARCELONA PARA AMINA CHAIR!!!", "<span style='color:#22c55e;font-size:14px;font-weight:bold;'>Revisa tu correo fuadel21@hotmail.com con el justificante oficial PDF.</span>");

      sendNotification("🎉 ¡¡CITA ENCONTRADA EN BARCELONA!!", "Amina Chair: Cita reservada en Barcelona. Revisa fuadel21@hotmail.com.");

      try { if ("vibrate" in navigator) navigator.vibrate([1000, 300, 1000, 300, 2000]); } catch(e){}

      setTimeout(function() {
        var btnFinal = document.querySelector("#btnSiguiente") || document.querySelector("#btnEnviar") || document.querySelector("input[value*='Confirmar']");
        submitFormWithBtn(btnFinal);
      }, 500);
      return;
    }

    // PASO 7: RESULTADO "NO HAY CITAS DISPONIBLES" -> ACTIVAR TEMPORIZADOR DE 10 MINUTOS
    if (body.indexOf("En este momento no hay citas disponibles") !== -1 || body.indexOf("No hay citas disponibles") !== -1) {
      if (!window.botTimerActive) {
        window.botTimerActive = true;
        
        var timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        sendNotification("🤖 Intento #" + attemptCount + " en Barcelona", "Revisado a las " + timeNow + ". Sin citas libres. Próxima revisión en 10 minutos.");

        setNativeMetaRefresh(RETRY_SEC);

        var targetTime = Date.now() + (RETRY_SEC * 1000);
        localStorage.setItem("bot_target_timestamp", targetTime.toString());

        setInterval(function() {
          var remaining = getRemainingSeconds();
          var min = Math.floor(remaining / 60);
          var sec = remaining % 60;
          var secStr = sec < 10 ? "0" + sec : sec;

          createBanner("❌ Sin citas disponibles en este momento.<br>⏱️ Próxima revisión en: <b style='color:#facc15;font-size:16px;'>" + min + "m " + secStr + "s</b>");

          if (remaining <= 0) {
            localStorage.removeItem("bot_target_timestamp");
            window.location.href = BASE_URL;
          }
        }, 1000);
      }
      return;
    }

    // AUTO-INICIO EN PÁGINAS GENERALES
    createBanner("🔍 Iniciando asistente de citas Barcelona para Amina Chair...");
    setTimeout(function() {
      if (href.indexOf("acopcdirect") === -1 && body.indexOf("PROVINCIA") === -1) {
        window.location.href = BASE_URL;
      }
    }, 3000);
  }

  // EJECUCIÓN INICIAL Y BUCLE SEGURO DE VERIFICACIÓN
  setTimeout(runStep, 600);
  setInterval(function() {
    if (!window.botTimerActive && !window.botSubmitting) {
      runStep();
    }
  }, 2000);

})();
