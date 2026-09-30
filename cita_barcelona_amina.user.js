// ==UserScript==
// @name         Bot Cita Previa Barcelona - Version 8.4 (Reserva Automática + Envío de Email Justificante)
// @namespace    https://icp.administracionelectronica.gob.es/
// @version      8.4
// @description  Buscador automático para Amina Chair con auto-rellenado de Teléfono/Email para confirmación oficial y envío de correo.
// @match        *://icp.administracionelectronica.gob.es/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  var NOMBRE = "AMINA CHAIR";
  var NIE = "Y2086361E";
  var NACIONALIDAD = "MARRUECOS";
  var TELEFONO = localStorage.getItem("bot_telefono") || "";
  var EMAIL = localStorage.getItem("bot_email") || "";
  var RETRY_SEC = 600; // BÚSQUEDA CADA 10 MINUTOS (600 segundos) TODA LA SEMANA (24/7)
  var BASE_URL = "https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect";

  var attemptCount = parseInt(localStorage.getItem("bot_attempt_count") || "0") + 1;
  localStorage.setItem("bot_attempt_count", attemptCount.toString());

  function getRemainingSeconds() {
    var targetTimestamp = parseInt(localStorage.getItem("bot_target_timestamp") || "0");
    if (targetTimestamp === 0) return RETRY_SEC;
    var diff = Math.ceil((targetTimestamp - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
  }

  // INYECCIÓN DE META-REFRESH NATIVO DEL NAVEGADOR
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
      
      var head = document.getElementsByTagName("head")[0] || document.documentElement;
      head.appendChild(meta);
    } catch(e){}
  }

  // REPRODUCTOR DE AUDIO SILENCIOSO HTML5 BASE64
  function initHTML5KeepAlive() {
    if (window.html5KeepAliveStarted) return;
    window.html5KeepAliveStarted = true;

    try {
      var silentAudioData = "data:audio/mp3;base64,SUQ3BAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABAAA7Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6//OUZAAAAAAAABAAA0gAAAAABAAAAAAAAAAA=";
      var audio = new Audio(silentAudioData);
      audio.loop = true;
      audio.volume = 0.01;
      audio.play().catch(function(){});
    } catch(e){}

    try {
      if ('locks' in navigator) {
        navigator.locks.request('bot_cita_barcelona_lock', { mode: 'exclusive' }, function() {
          return new Promise(function() {});
        });
      }
    } catch(e){}
  }

  function sendMobileNotification(title, message) {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, {
          body: message,
          tag: "bot-cita-barcelona",
          renotify: true
        });
      }
    } catch(e){}
  }

  // BANNER DE ESTADO FLOTANTE PERMANENTE EN PANTALLA
  function createStatusBanner(countdownSeconds) {
    var banner = document.getElementById("bot-status-banner");
    if (!banner && document.body) {
      banner = document.createElement("div");
      banner.id = "bot-status-banner";
      banner.style.position = "fixed";
      banner.style.bottom = "10px";
      banner.style.left = "3%";
      banner.style.width = "94%";
      banner.style.zIndex = "9999999";
      banner.style.backgroundColor = "#0f172a";
      banner.style.color = "#f8fafc";
      banner.style.padding = "12px";
      banner.style.borderRadius = "12px";
      banner.style.boxShadow = "0px 6px 20px rgba(0,0,0,0.5)";
      banner.style.fontFamily = "sans-serif";
      banner.style.fontSize = "13px";
      banner.style.lineHeight = "1.4";
      banner.style.border = "2px solid #3b82f6";
      document.body.appendChild(banner);
    }

    if (banner) {
      var min = Math.floor(countdownSeconds / 60);
      var sec = countdownSeconds % 60;
      var secStr = sec < 10 ? "0" + sec : sec;

      banner.style.borderColor = "#3b82f6";
      banner.innerHTML = 
        "<div style='font-weight:bold;color:#60a5fa;display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;'>" +
          "<span>🤖 BOT BARCELONA v8.4 🟢 (Reserva + Email)</span>" +
          "<span style='background:#1e3a8a;color:#93c5fd;padding:2px 8px;border-radius:6px;font-size:11px;'>INTENTO #" + attemptCount + "</span>" +
        "</div>" +
        "<div style='font-size:12px;color:#cbd5e1;'>" +
          "👤 <b>Amina Chair</b> | 📍 <b>Barcelona</b> (Toma Huellas)<br>" +
          "⚡ <b>Reserva auto e integración de email justificante</b><br>" +
          "⏱️ Próxima revisión en: <b style='color:#facc15;font-size:15px;'>" + min + "m " + secStr + "s</b>" +
        "</div>";
    }
  }

  function addNotificationPermissionButton() {
    if (!("Notification" in window)) return;

    var btn = document.getElementById("bot-notif-btn");

    if (Notification.permission === "denied") {
      if (!btn && document.body) {
        btn = document.createElement("button");
        btn.id = "bot-notif-btn";
        btn.innerHTML = "⚠️ <b>Notificaciones bloqueadas en el navegador</b><br><span style='font-size:11px;font-weight:normal;'>Toca el candado 🔒 a la izquierda de la URL (arriba) ➔ Permisos ➔ Notificaciones ➔ PERMITIR</span>";
        btn.style.position = "fixed";
        btn.style.top = "10px";
        btn.style.left = "3%";
        btn.style.width = "94%";
        btn.style.zIndex = "9999999";
        btn.style.padding = "10px 14px";
        btn.style.backgroundColor = "#dc2626";
        btn.style.color = "#ffffff";
        btn.style.border = "none";
        btn.style.borderRadius = "10px";
        btn.style.boxShadow = "0px 4px 14px rgba(0,0,0,0.4)";
        btn.style.textAlign = "center";
        btn.style.lineHeight = "1.3";

        btn.onclick = function() {
          alert("Para activar las notificaciones:\n1. Toca el icono de Candado/Escudo 🔒 a la izquierda de la dirección web (URL arriba).\n2. Selecciona 'Configuración del sitio' o 'Permisos'.\n3. Busca 'Notificaciones' y cámbialo a 'Permitir'.\n4. Recarga esta página.");
        };
        document.body.appendChild(btn);
      }
      return;
    }

    if (Notification.permission === "default") {
      if (!btn && document.body) {
        btn = document.createElement("button");
        btn.id = "bot-notif-btn";
        btn.innerText = "🔔 Toca AQUÍ para Activar Notificaciones en tu Móvil";
        btn.style.position = "fixed";
        btn.style.top = "10px";
        btn.style.left = "5%";
        btn.style.width = "90%";
        btn.style.zIndex = "9999999";
        btn.style.padding = "12px 16px";
        btn.style.backgroundColor = "#2563eb";
        btn.style.color = "#ffffff";
        btn.style.fontWeight = "bold";
        btn.style.fontSize = "14px";
        btn.style.border = "none";
        btn.style.borderRadius = "8px";
        btn.style.boxShadow = "0px 4px 12px rgba(0,0,0,0.3)";
        btn.style.cursor = "pointer";

        btn.onclick = function() {
          initHTML5KeepAlive();
          Notification.requestPermission().then(function(permission) {
            if (permission === "granted") {
              btn.style.backgroundColor = "#16a34a";
              btn.innerText = "✅ ¡Notificaciones de Android Activadas!";
              sendMobileNotification("🤖 Bot Cita Barcelona", "¡Notificaciones activadas correctamente en tu móvil!");
              setTimeout(function() { btn.remove(); }, 3000);
            } else {
              btn.style.backgroundColor = "#dc2626";
              btn.innerHTML = "⚠️ <b>Notificaciones Bloqueadas</b><br><span style='font-size:11px;'>Toca el candado 🔒 junto a la URL arriba ➔ Permisos ➔ Notificaciones ➔ Permitir</span>";
            }
          });
        };
        document.body.appendChild(btn);
      }
    }
  }

  function findButtonByKeywords(keywords) {
    var elements = document.querySelectorAll("input[type='submit'], input[type='button'], button, a, .btn");
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var txt = (el.value || el.innerText || el.textContent || "").toUpperCase().trim();
      for (var k = 0; k < keywords.length; k++) {
        if (txt.indexOf(keywords[k].toUpperCase()) !== -1) {
          return el;
        }
      }
    }
    return null;
  }

  function clickBtn(btn) {
    if (!btn) return false;
    try {
      btn.style.outline = "4px solid #22c55e";
      btn.click();
      return true;
    } catch(e) {
      return false;
    }
  }

  function fixOficinaSelect(sel) {
    if (!sel || !sel.options || sel.options.length === 0) return;

    for (var i = 0; i < sel.options.length; i++) {
      var t = sel.options[i].text.toUpperCase();
      if (t.indexOf("CUALQUIER") !== -1 || t.indexOf("TODAS") !== -1 || t.indexOf("TODOS") !== -1) {
        if (sel.selectedIndex !== i) {
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
    }

    var currentText = (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "").toUpperCase();
    if (currentText.indexOf("GUADALAJARA") !== -1 || currentText === "") {
      for (var j = 0; j < sel.options.length; j++) {
        var optText = sel.options[j].text.toUpperCase();
        if (optText.indexOf("GUADALAJARA") === -1 && optText.indexOf("DESPLIEGA") === -1 && optText.indexOf("SELECCION") === -1 && optText.trim() !== "") {
          sel.selectedIndex = j;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
      }
      if (sel.options.length > 1) {
        sel.selectedIndex = 1;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }

  document.addEventListener("visibilitychange", function() {
    if (!document.hidden) {
      var rem = getRemainingSeconds();
      if (rem <= 0) {
        localStorage.removeItem("bot_target_timestamp");
        window.location.href = BASE_URL;
      } else {
        createStatusBanner(rem);
      }
    }
  });

  function run() {
    initHTML5KeepAlive();
    addNotificationPermissionButton();

    // AUTO-RECUPERACIÓN POR RELOJ REAL
    var remSeconds = getRemainingSeconds();
    var targetTimestamp = parseInt(localStorage.getItem("bot_target_timestamp") || "0");
    if (targetTimestamp > 0 && remSeconds <= 0) {
      localStorage.removeItem("bot_target_timestamp");
      window.location.href = BASE_URL;
      return;
    }

    var body = document.body ? document.body.innerText : "";

    var btnCookie = document.querySelector("input[value*='Acepto']") || document.querySelector("button[id*='cookie']") || findButtonByKeywords(["Acepto"]);
    if (btnCookie && btnCookie.offsetParent !== null) {
      try { btnCookie.click(); } catch(e){}
    }

    // 0. AUTO-RECUPERACIÓN DE ERRORES
    if (body.indexOf("Se ha producido un error") !== -1 ||
        body.indexOf("0301") !== -1 ||
        body.indexOf("Su sesión ha caducado") !== -1 ||
        body.indexOf("caducado por permanecer") !== -1 ||
        body.indexOf("requested URL was rejected") !== -1 ||
        body.indexOf("Not Found") !== -1 ||
        body.indexOf("Too Many Requests") !== -1) {
      
      var btnResetError = document.querySelector("input[value='Aceptar']") ||
                          document.querySelector("button[value='Aceptar']") ||
                          document.querySelector("#btnAceptar");
      if (btnResetError) {
        try { btnResetError.click(); } catch(e){}
      }
      setTimeout(function() {
        window.location.href = BASE_URL;
      }, 1000);
      return;
    }

    var selects = document.querySelectorAll("select");

    // PASO 1: Seleccionar Provincia (Barcelona)
    if (selects.length > 0 && (body.indexOf("PROVINCIAS DISPONIBLES") !== -1 || body.indexOf("Selecciona Provincia") !== -1 || body.indexOf("PROVINCIA SELECCIONADA") === -1 && body.indexOf("PROVINCIA") !== -1)) {
      var selP = selects[0];
      for (var i = 0; i < selP.options.length; i++) {
        if (selP.options[i].text.toUpperCase().indexOf("BARCELONA") !== -1 || selP.options[i].value === "8") {
          selP.value = selP.options[i].value;
          selP.dispatchEvent(new Event("change", { bubbles: true }));
          setTimeout(function() {
            var btnNext = document.querySelector("#btnAceptar") || document.querySelector("input[value='Aceptar']") || findButtonByKeywords(["Aceptar"]);
            clickBtn(btnNext);
          }, 600);
          return;
        }
      }
    }

    // PASO 2: SELECCIONAR CUALQUIER OFICINA EN BARCELONA Y TRÁMITE "TOMA DE HUELLAS"
    if (selects.length > 0 && (body.indexOf("TRÁMITES") !== -1 || body.indexOf("TRÁMITE") !== -1 || body.indexOf("Selecciona Oficina") !== -1)) {
      for (var s = 0; s < selects.length; s++) {
        var currentSel = selects[s];
        var isOficinaSelect = false;
        for (var o = 0; o < currentSel.options.length; o++) {
          var txtO = currentSel.options[o].text.toUpperCase();
          if (txtO.indexOf("GUADALAJARA") !== -1 || txtO.indexOf("BALMES") !== -1 || txtO.indexOf("MALLORCA") !== -1 || txtO.indexOf("CUALQUIER") !== -1) {
            isOficinaSelect = true;
            break;
          }
        }
        if (isOficinaSelect) {
          fixOficinaSelect(currentSel);
        }
      }

      var targetSelect = null;
      var foundIndex = -1;

      for (var s2 = 0; s2 < selects.length; s2++) {
        var selT = selects[s2];
        for (var o2 = 0; o2 < selT.options.length; o2++) {
          var optText = selT.options[o2].text.toUpperCase();
          if (optText.indexOf("TOMA DE HUELLAS") !== -1 || optText.indexOf("HUELLAS") !== -1 || optText.indexOf("RENOVACIÓN DE TARJETA") !== -1) {
            targetSelect = selT;
            foundIndex = o2;
            break;
          }
        }
        if (targetSelect) break;
      }

      if (targetSelect && foundIndex !== -1) {
        targetSelect.selectedIndex = foundIndex;
        targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }

      setTimeout(function() {
        var btnNext = document.querySelector("#btnAceptar") || document.querySelector("input[value='Aceptar']") || findButtonByKeywords(["Aceptar"]);
        clickBtn(btnNext);
      }, 600);
      return;
    }

    // PASO 3: PULSAR "ENTRAR" EN PANTALLA DE AVISO
    var btnEntrar = document.querySelector("#btnEntrar") ||
                    document.querySelector("input[value*='Entrar']") ||
                    document.querySelector("button[id*='Entrar']") ||
                    findButtonByKeywords(["Entrar"]);
    if (btnEntrar) {
      setTimeout(function() { clickBtn(btnEntrar); }, 500);
      return;
    }

    // PASO 4: Datos Personales (NIE Y2086361E, AMINA CHAIR, MARRUECOS)
    var inNie = document.querySelector("#txtIdCitado") || document.querySelector("input[name='txtIdCitado']");
    var inNom = document.querySelector("#txtDesCitado") || document.querySelector("input[name='txtDesCitado']");
    if (inNie && inNom) {
      var rNie = document.querySelector("#rdbTipoDocNie") || document.querySelector("input[value='NIE']");
      if (rNie) rNie.checked = true;

      inNie.value = NIE;
      inNie.dispatchEvent(new Event("input", { bubbles: true }));

      inNom.value = NOMBRE;
      inNom.dispatchEvent(new Event("input", { bubbles: true }));

      var selPais = document.querySelector("#txtPaisNac") || document.querySelector("select[name='txtPaisNac']") || document.querySelector("#idPais");
      if (selPais) {
        for (var p = 0; p < selPais.options.length; p++) {
          if (selPais.options[p].text.toUpperCase().indexOf("MARRUECOS") !== -1 || selPais.options[p].value === "248") {
            selPais.value = selPais.options[p].value;
            selPais.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }

      setTimeout(function() {
        var btnAcc = document.querySelector("#btnEnviar") || document.querySelector("#btnAceptar") || findButtonByKeywords(["Aceptar", "Enviar", "Continuar"]);
        clickBtn(btnAcc);
      }, 600);
      return;
    }

    // PASO 5: Pulsar "Solicitar Cita"
    var btnSol = document.querySelector("#btnEnviar") ||
                 document.querySelector("#btnSolicitar") ||
                 document.querySelector("input[value*='Solicitar']") ||
                 findButtonByKeywords(["SOLICITAR CITA", "SOLICITAR"]);
    if (btnSol && (body.indexOf("Identidad del usuario de cita") !== -1 || body.indexOf("Solicitar Cita") !== -1)) {
      setTimeout(function() { clickBtn(btnSol); }, 500);
      return;
    }

    // PASO 6: RESERVA AUTOMÁTICA INSTANTÁNEA DE LA PRIMERA OFICINA EN BARCELONA
    if (selects.length > 0 && (body.indexOf("Seleccione la oficina") !== -1 || body.indexOf("OFICINA") !== -1)) {
      var selOficina = selects[0];
      if (selOficina.options.length > 1) {
        selOficina.selectedIndex = 1;
        selOficina.dispatchEvent(new Event("change", { bubbles: true }));
      }
      setTimeout(function() {
        var btnNext = document.querySelector("#btnSiguiente") || document.querySelector("#btnEnviar") || findButtonByKeywords(["Siguiente", "Enviar", "Aceptar"]);
        clickBtn(btnNext);
      }, 300);
      return;
    }

    // PASO 7: RESERVA AUTOMÁTICA INSTANTÁNEA DE LA PRIMERA FECHA Y HORA DISPONIBLE
    var radiosCita = document.querySelectorAll("input[type='radio'][name*='cita']");
    if (radiosCita.length > 0 || body.indexOf("Seleccione la cita") !== -1) {
      if (radiosCita.length > 0) {
        radiosCita[0].checked = true;
        radiosCita[0].dispatchEvent(new Event("change", { bubbles: true }));
      }
      setTimeout(function() {
        var btnNext = document.querySelector("#btnSiguiente") || document.querySelector("#btnEnviar") || findButtonByKeywords(["Siguiente", "Enviar", "Aceptar"]);
        clickBtn(btnNext);
      }, 300);
      return;
    }

    // PASO 8: Si no hay citas disponibles -> ACTIVAR META-REFRESH NATIVO + NOTIFICACIÓN + TEMPORIZADOR DE 10 MIN
    if (body.indexOf("En este momento no hay citas disponibles") !== -1 || body.indexOf("No hay citas disponibles") !== -1) {
      if (!window.countdownStarted) {
        window.countdownStarted = true;
        var nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        sendMobileNotification(
          "🤖 Intento #" + attemptCount + " realizado",
          "Revisado Barcelona a las " + nowTime + ". Sin citas libres. Próximo intento en 10 min."
        );

        // INYECCIÓN DE REFRESH NATIVO DEL NAVEGADOR (C++) CADA 10 MINUTOS (600s)
        setNativeMetaRefresh(RETRY_SEC);

        var targetTime = Date.now() + (RETRY_SEC * 1000);
        localStorage.setItem("bot_target_timestamp", targetTime.toString());

        var timerInterval = setInterval(function() {
          var remaining = getRemainingSeconds();
          createStatusBanner(remaining);

          if (remaining <= 0) {
            clearInterval(timerInterval);
            localStorage.removeItem("bot_target_timestamp");
            window.location.href = BASE_URL;
          }
        }, 1000);
      }
      return;
    }

    // PASO 9: CITA RESERVADA -> AUTO-RELLENAR TELÉFONO Y EMAIL PARA ENVIAR EL JUSTIFICANTE OFICIAL POR CORREO
    var inTel = document.querySelector("#txtTelefonoCitado") || document.querySelector("input[name*='Telefono']");
    var inMail1 = document.querySelector("#email") || document.querySelector("#txtEmail") || document.querySelector("input[name*='email']");
    var inMail2 = document.querySelector("#emailConfirm") || document.querySelector("#txtEmailConfirmar") || document.querySelector("input[name*='Confirm']");

    if (inTel || inMail1) {
      document.body.style.backgroundColor = "#86efac";

      if (TELEFONO && inTel) {
        inTel.value = TELEFONO;
        inTel.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (EMAIL && inMail1) {
        inMail1.value = EMAIL;
        inMail1.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (EMAIL && inMail2) {
        inMail2.value = EMAIL;
        inMail2.dispatchEvent(new Event("input", { bubbles: true }));
      }

      sendMobileNotification(
        "🎉 ¡¡¡CITA RESERVADA EN BARCELONA!!!",
        "¡Atención Amina Chair! Cita localizada en Barcelona. Revisa el correo electrónico para ver el justificante."
      );

      // VIBRACIÓN INTENSA
      try {
        if ("vibrate" in navigator) {
          navigator.vibrate([1000, 300, 1000, 300, 1000, 300, 2000]);
        }
      } catch(e){}

      // ALARMA SONORA
      try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        function playBeep(freq, dur, delay) {
          setTimeout(function() {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = "square";
            osc.frequency.value = 880;
            gain.gain.value = 0.5;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + dur);
          }, delay);
        }
        for (var b = 0; b < 50; b++) {
          playBeep(880, 0.3, b * 600);
          playBeep(1300, 0.3, b * 600 + 300);
        }
      } catch(e){}

      alert("🎉 ¡¡¡CITA LOCALIZADA Y RESERVADA EN BARCELONA PARA AMINA CHAIR!!! EXTRANJERÍA ENVIARÁ EL JUSTIFICANTE OFICIAL A TU CORREO ELECTRÓNICO.");
    }
  }

  setTimeout(run, 500);
  setInterval(run, 1200);

})();
