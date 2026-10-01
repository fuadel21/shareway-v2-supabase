// ==UserScript==
// @name         Bot Cita Previa Barcelona - Version 9.3 (Recarga Infalible 24/7)
// @namespace    https://icp.administracionelectronica.gob.es/
// @version      9.3
// @description  Amina Chair (NIE Y2086361E). Recarga garantizada cada 10 min aunque el navegador congele la pestana: meta-refresh nativo armado antes del load, sin bloqueo beforeunload, cascada de navegacion y boton de recarga manual.
// @author       Asistente Arena.ai
// @match        *://icp.administracionelectronica.gob.es/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/* =====================================================================================
   BOT CITA PREVIA BARCELONA - VERSION 9.3 "RECARGA INFALIBLE"
   -------------------------------------------------------------------------------------
   QUE SE ARREGLA EN ESTA VERSION (en v9.2 el contador llegaba a 0 y NO recargaba):
   1) El <meta http-equiv="refresh"> se inyecta al inicio (document-start), ANTES del
      evento "load". Firefox/Gecko SOLO obedece un meta-refresh insertado antes de load;
      en v9.2 se insertaba tarde => el motor nativo nunca se armaba.
   2) La recarga ya NO depende del setInterval de JavaScript. Firefox Android congela los
      timers JS en segundo plano, pero el timer del meta-refresh lo lleva el motor C++ del
      navegador => la recarga ocurre aunque la pantalla este apagada.
   3) Se anula window.onbeforeunload y el dialogo "¿Desea salir?" del portal, que bloquea
      la navegacion cuando nadie puede pulsar "Salir".
   4) Watchdog con fecha limite persistente (localStorage): recarga SIEMPRE cada 10 min.
   5) Cascada de navegacion: top.location -> formulario GET oculto -> location.replace ->
      assign -> href -> reload -> meta-refresh de 3 s, reintentando cada 4 segundos.
   6) Boton "RECARGAR AHORA" en el panel para forzar la busqueda manualmente.
   ===================================================================================== */

(function () {
  'use strict';

  // ============================== CONFIGURACION OFICIAL ==============================
  var NOMBRE = "AMINA CHAIR";
  var NIE = "Y2086361E";
  var NACIONALIDAD_VAL = "248"; // MARRUECOS
  var PROVINCIA_VAL = "8"; // BARCELONA
  var TELEFONO = "698233413";
  var EMAIL = "fuadel21@hotmail.com";
  var RETRY_SEC = 600; // 10 MINUTOS, 24/7 TODA LA SEMANA
  var BASE_URL = "https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect";
  var RELOAD_GUARD_MS = 4000;   // minimo entre intentos de recarga
  var STEP_GRACE_MS = 25000;    // margen si el flujo del formulario esta en curso
  var IS_TOP = (window.top === window.self);

  if (window.botInitializedV93) return;
  window.botInitializedV93 = true;

  // ============================== 0. BLINDAJE ANTI-BLOQUEO ==============================
  // 0.1 Anular el dialogo "¿Desea salir de esta pagina?" que el portal instala y que
  //     impide la navegacion automatica cuando el movil esta en el bolsillo.
  (function killUnloadBlockers() {
    try {
      var origAdd = window.addEventListener;
      window.addEventListener = function (type, fn, opts) {
        if (type === 'beforeunload' || type === 'unload') return; // se ignora el handler del portal
        return origAdd.call(window, type, fn, opts);
      };
    } catch (e) {}
    try {
      Object.defineProperty(window, 'onbeforeunload', {
        configurable: true,
        get: function () { return null; },
        set: function () { /* ignorado a proposito */ }
      });
    } catch (e) { window.onbeforeunload = null; }
    try {
      Object.defineProperty(window, 'onunload', {
        configurable: true,
        get: function () { return null; },
        set: function () { }
      });
    } catch (e) { window.onunload = null; }
  })();

  // 0.2 Almacenamiento a prueba de fallos (modo privado / cookies bloqueadas).
  var MEM = {};
  function lsGet(k) {
    try { var v = localStorage.getItem(k); if (v !== null) return v; } catch (e) {}
    return (MEM[k] === undefined) ? null : MEM[k];
  }
  function lsSet(k, v) { MEM[k] = String(v); try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function lsDel(k) { delete MEM[k]; try { localStorage.removeItem(k); } catch (e) {} }

  lsDel("bot_target_timestamp"); // clave antigua de v9.2 (el contador que se quedaba a cero)

  // ============================== 1. RELOJ MAESTRO (fecha limite persistente) ==============================
  // La fecha limite se guarda en el movil y sobrevive a las recargas: el contador NUNCA
  // se reinicia solo por abrir una pagina nueva del formulario.
  (function startCycle() {
    var now = Date.now();
    var deadline = parseInt(lsGet("bot_deadline") || "0", 10);

    if (!deadline || deadline <= now - 1500) {
      deadline = now + (RETRY_SEC * 1000);
      lsSet("bot_deadline", deadline);
      var n = parseInt(lsGet("bot_attempt_count") || "0", 10) + 1;
      lsSet("bot_attempt_count", n);
      window.__botNewCycle = true;
    }
    window.__botDeadline = deadline;
    window.__botCycleId = String(deadline);
  })();

  function getRemainingSeconds() {
    var d = parseInt(lsGet("bot_deadline") || window.__botDeadline || "0", 10);
    if (!d) return RETRY_SEC;
    var s = Math.ceil((d - Date.now()) / 1000);
    return s > 0 ? s : 0;
  }
  function getAttemptCount() {
    return parseInt(lsGet("bot_attempt_count") || "1", 10);
  }
  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }

  // ============================== 2. MOTOR NATIVO META-REFRESH (C++) ==============================
  // Se inyecta ANTES del evento load. Es el unico mecanismo que Firefox Android respeta
  // con la pantalla apagada y los timers JS congelados.
  var metaEl = null;

  function cancelMetaRefresh() {
    try {
      if (metaEl && metaEl.parentNode) metaEl.parentNode.removeChild(metaEl);
      metaEl = null;
    } catch (e) {}
    try {
      var all = document.querySelectorAll("meta[http-equiv='refresh']");
      for (var i = 0; i < all.length; i++) { if (all[i] && all[i].parentNode) all[i].parentNode.removeChild(all[i]); }
    } catch (e) {}
    window.__botMetaRefreshArmed = 0;
  }

  function injectMetaRefresh(sec, url) {
    if (window.botBooked) return false;
    try {
      var head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
      if (!head) { setTimeout(function () { injectMetaRefresh(sec, url); }, 25); return false; }

      // Si el formulario se esta enviando en este momento, la recarga espera 20 s como
      // minimo para no cortar la reserva a mitad de camino.
      var s = Math.max(1, Math.round(sec));
      if (window.__botLastStepAt && (Date.now() - window.__botLastStepAt) < 60000) {
        s = Math.max(s, 20);
      }

      var m = document.createElement("meta");
      m.setAttribute("http-equiv", "refresh");
      m.setAttribute("content", s + ";url=" + (url || BASE_URL));
      m.id = "bot-meta-refresh";
      head.appendChild(m);
      metaEl = m;
      window.__botMetaRefreshArmed = s;
      return true;
    } catch (e) { return false; }
  }

  // Se arma inmediatamente (document-start = antes de load) ...
  injectMetaRefresh(getRemainingSeconds(), BASE_URL);
  // ... y se recalcula en DOMContentLoaded (sigue siendo antes de load en Firefox).
  try {
    document.addEventListener("DOMContentLoaded", function () {
      if (!window.botBooked && !window.botTimerPaused) injectMetaRefresh(getRemainingSeconds(), BASE_URL);
      initUI();
    });
  } catch (e) {
    setTimeout(function () { initUI(); }, 400);
  }

  // ============================== 3. NAVEGACION A PRUEBA DE TODO ==============================
  function hardNavigate(url, cacheBuster) {
    if (window.botBooked) return false;
    try { window.onbeforeunload = null; window.onunload = null; } catch (e) {}

    var target = url;
    if (cacheBuster) {
      target = url + (url.indexOf("?") === -1 ? "?" : "&") + "recarga=" + Date.now();
    }

    // A) Si las paginas del portal van dentro de un frameset, navegar la ventana superior.
    try {
      if (window.top && window.top !== window.self) {
        try { window.top.location.replace(target); return true; } catch (e) {}
      }
    } catch (e) {}

    // B) Formulario GET oculto: es una navegacion real, no la bloquea el WAF.
    try {
      var old = document.getElementById("bot-nav-form");
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var f = document.createElement("form");
      f.id = "bot-nav-form";
      f.method = "GET";
      f.action = url;
      f.style.display = "none";
      if (cacheBuster) {
        var inp = document.createElement("input");
        inp.type = "hidden";
        inp.name = "recarga";
        inp.value = String(Date.now());
        f.appendChild(inp);
      }
      (document.body || document.documentElement).appendChild(f);
      f.submit();
      return true;
    } catch (e) {}

    // C) Cascada clasica.
    try { window.location.replace(target); return true; } catch (e) {}
    try { window.location.assign(target); return true; } catch (e) {}
    try { window.location.href = target; return true; } catch (e) {}
    return false;
  }

  var lastReloadTry = 0;
  var reloadTries = 0;

  function forceReload(reason) {
    if (window.botBooked) return;
    var now = Date.now();
    if (now - lastReloadTry < RELOAD_GUARD_MS) return;
    lastReloadTry = now;
    reloadTries++;

    try { window.onbeforeunload = null; window.onunload = null; } catch (e) {}

    // 1) Re-armar el motor nativo con 3 segundos: actua incluso con el JS congelado.
    window.__botLastStepAt = 0;
    injectMetaRefresh(3, BASE_URL);

    // 2) Cascada inmediata (con cache-buster cada 4 intentos para saltar la cache de Firefox).
    hardNavigate(BASE_URL, (reloadTries % 4 === 0));

    // 3) Ultimos recursos escalonados.
    if (reloadTries % 3 === 0) {
      setTimeout(function () { try { window.location.reload(); } catch (e) {} }, 2500);
      setTimeout(function () { try { window.open(BASE_URL, "_self"); } catch (e) {} }, 4500);
    }

    setStatus("🔄 Contador a cero (" + reason + ") → recargando la página para buscar de nuevo...");
    sendNotification("🔄 Recargando búsqueda Barcelona", "Intento #" + getAttemptCount() + ": recargando la página para volver a buscar cita libre.");
  }

  // ============================== 4. WATCHDOG GLOBAL (cada 1 segundo) ==============================
  var deadlineExpiredAt = 0;

  function watchdog() {
    var rem = getRemainingSeconds();

    // Mantener siempre visible el panel y el contador (si el portal los borra, se recrean).
    if (!document.getElementById("bot-countdown")) render();
    else updateCountdownUI(rem);

    if (window.botBooked || window.botTimerPaused) return;
    if (rem > 0) { deadlineExpiredAt = 0; return; }

    // Si el flujo del formulario esta enviandose, dar margen (maximo 90 s).
    if (Date.now() - (window.__botLastStepAt || 0) < STEP_GRACE_MS) {
      if (!deadlineExpiredAt) deadlineExpiredAt = Date.now();
      if (Date.now() - deadlineExpiredAt < 90000) {
        setStatus("⚡ Enviando formulario... la recarga espera unos segundos.");
        return;
      }
    }
    forceReload("10 min cumplidos");
  }

  // Intervalo principal + intervalo de respaldo (por si el primero se degrada en segundo plano).
  setInterval(watchdog, 1000);
  setInterval(function () {
    if (!window.botBooked && !window.botTimerPaused && getRemainingSeconds() <= 0) forceReload("watchdog de respaldo");
  }, 5000);

  // ============================== 5. PANEL DE ESTADO (UI) ==============================
  var statusText = "🔍 Iniciando asistente de citas Barcelona para Amina Chair...";
  var bannerEl = null;

  function setStatus(txt) {
    statusText = txt;
    render();
  }

  function ensureBanner() {
    if (!IS_TOP) return null;
    if (bannerEl && bannerEl.parentNode) return bannerEl;
    if (!document.body) return null;
    bannerEl = document.getElementById("bot-status-banner");
    if (!bannerEl) {
      bannerEl = document.createElement("div");
      bannerEl.id = "bot-status-banner";
      bannerEl.style.cssText = "position:fixed;bottom:10px;left:2%;width:96%;z-index:2147483647;background:#0f172a;color:#fff;" +
        "padding:12px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.65);border:2px solid #3b82f6;" +
        "font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.35;";
      document.body.appendChild(bannerEl);
    }
    return bannerEl;
  }

  function render() {
    var b = ensureBanner();
    if (!b) return;
    var booked = !!window.botBooked;
    var paused = !!window.botTimerPaused;
    var armed = window.__botMetaRefreshArmed || 0;

    b.innerHTML =
      "<div style='font-weight:bold;color:#60a5fa;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;'>" +
        "<span>🤖 BOT BARCELONA v9.3 " + (booked ? "🎉" : (paused ? "⏸️" : "🟢")) + "</span>" +
        "<span style='background:#1e3a8a;color:#93c5fd;padding:2px 8px;border-radius:6px;font-size:11px;'>INTENTO #" + getAttemptCount() + "</span>" +
      "</div>" +
      "<div style='color:#e2e8f0;font-size:12px;'>" +
        "👤 <b>" + NOMBRE + "</b> (" + NIE + ") · 📍 <b>BARCELONA</b> · TOMA DE HUELLAS<br>" +
        "📱 <b>" + TELEFONO + "</b> · ✉️ <b>" + EMAIL + "</b>" +
        "<div style='margin-top:6px;padding-top:5px;border-top:1px solid #334155;color:#facc15;font-weight:bold;'>" + statusText + "</div>" +
        "<div style='margin-top:6px;color:#e2e8f0;'>⏱️ Próxima recarga en: <b id='bot-countdown' style='color:#22c55e;font-size:16px;'>--:--</b>" +
          "<span style='color:#94a3b8;font-size:11px;'> · " + (booked ? "en pausa (cita detectada)" : (paused ? "en pausa" : (armed ? "motor nativo armado ✅ (" + armed + "s)" : "motor nativo re-armándose..."))) + "</span>" +
        "</div>" +
      "</div>" +
      "<div style='display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;'>" +
        "<button id='bot-btn-reload' style='flex:1;padding:9px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-weight:bold;font-size:12px;'>🔄 RECARGAR AHORA</button>" +
        (("Notification" in window) && Notification.permission !== "granted"
          ? "<button id='bot-btn-notif' style='flex:1;padding:9px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-weight:bold;font-size:12px;'>🔔 ACTIVAR AVISOS</button>" : "") +
        (booked || paused
          ? "<button id='bot-btn-resume' style='flex:1;padding:9px;border:none;border-radius:8px;background:#16a34a;color:#fff;font-weight:bold;font-size:12px;'>🔁 REANUDAR BÚSQUEDA 24/7</button>" : "") +
      "</div>";

    var btnReload = document.getElementById("bot-btn-reload");
    if (btnReload) btnReload.onclick = function () {
      initHTML5KeepAlive();
      setStatus("🔄 Recarga manual solicitada por el usuario...");
      lsSet("bot_deadline", Date.now()); // fuerza el reloj a cero
      lastReloadTry = 0;
      forceReload("orden manual");
    };

    var btnNotif = document.getElementById("bot-btn-notif");
    if (btnNotif) btnNotif.onclick = function () {
      initHTML5KeepAlive();
      try {
        Notification.requestPermission().then(function (p) {
          if (p === "granted") sendNotification("✅ Avisos Activados", "Recibirás un aviso en cada intento de cita.");
          render();
        });
      } catch (e) {}
    };

    var btnResume = document.getElementById("bot-btn-resume");
    if (btnResume) btnResume.onclick = function () {
      window.botBooked = false;
      window.botTimerPaused = false;
      lsDel("bot_booked");
      lsSet("bot_deadline", Date.now() + RETRY_SEC * 1000);
      lastReloadTry = 0;
      injectMetaRefresh(RETRY_SEC, BASE_URL);
      setStatus("🔁 Búsqueda automática reanudada (ciclo nuevo de 10 minutos).");
    };

    updateCountdownUI(getRemainingSeconds());
  }

  function updateCountdownUI(rem) {
    var el = document.getElementById("bot-countdown");
    if (el) {
      el.textContent = window.botBooked ? "PAUSA ✅" : fmt(rem);
      el.style.color = window.botBooked ? "#22c55e" : (rem <= 30 ? "#f87171" : "#22c55e");
    }
  }

  function initUI() {
    render();
    try { addNotifButton(); } catch (e) {}
  }

  function addNotifButton() {
    if (!("Notification" in window) || Notification.permission === "granted") return;
    if (!IS_TOP || !document.body || document.getElementById("bot-notif-btn")) return;
    var btn = document.createElement("button");
    btn.id = "bot-notif-btn";
    btn.innerHTML = Notification.permission === "denied"
      ? "⚠️ <b>Notificaciones Bloqueadas</b> (permite los avisos en el candado 🔒 de la barra de direcciones)"
      : "🔔 TOCA AQUÍ para Activar las Notificaciones de Cita en tu Móvil";
    btn.style.cssText = "position:fixed;top:10px;left:4%;width:92%;z-index:2147483647;padding:12px;border:none;border-radius:8px;" +
      "color:#fff;font-weight:bold;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.4);background:" +
      (Notification.permission === "denied" ? "#dc2626" : "#2563eb") + ";";
    btn.onclick = function () {
      initHTML5KeepAlive();
      if (Notification.permission === "default") {
        try {
          Notification.requestPermission().then(function (p) {
            if (p === "granted") { btn.remove(); render(); }
          });
        } catch (e) {}
      }
    };
    document.body.appendChild(btn);
  }

  // ============================== 6. AVISOS, ALARMA Y VIBRACION ==============================
  function sendNotification(title, message) {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body: message, tag: "bot-cita", renotify: true });
      }
    } catch (e) {}
  }

  function playAlarm() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        var ctx = new AC();
        if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
        var t0 = ctx.currentTime + 0.02;
        for (var i = 0; i < 14; i++) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          o.type = "square";
          o.frequency.value = (i % 2 === 0) ? 880 : 1320;
          o.connect(g);
          g.connect(ctx.destination);
          var st = t0 + i * 0.45;
          g.gain.setValueAtTime(0.0001, st);
          g.gain.exponentialRampToValueAtTime(0.4, st + 0.05);
          g.gain.exponentialRampToValueAtTime(0.0001, st + 0.4);
          o.start(st);
          o.stop(st + 0.45);
        }
      }
    } catch (e) {}
    try {
      if ("speechSynthesis" in window) {
        var u = new SpeechSynthesisUtterance("Cita encontrada en Barcelona para Amina Chair. Confirma la reserva inmediatamente.");
        u.lang = "es-ES";
        u.volume = 1;
        window.speechSynthesis.speak(u);
      }
    } catch (e) {}
  }

  function vibrate(pattern) { try { if ("vibrate" in navigator) navigator.vibrate(pattern); } catch (e) {} }

  function initHTML5KeepAlive() {
    try {
      if (!window.__botKeepAlive) {
        window.__botKeepAlive = true;
        var silent = "data:audio/mp3;base64,SUQ3BAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABAAA7Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6Ojo6//OUZAAAAAAAABAAA0gAAAAABAAAAAAAAAAA=";
        var audio = new Audio(silent);
        audio.loop = true;
        audio.volume = 0.01;
        audio.play().catch(function () {});
      }
    } catch (e) {}
    try {
      if ("locks" in navigator && !window.__botLock) {
        window.__botLock = true;
        navigator.locks.request("bot_cita_lock", { mode: "exclusive" }, function () { return new Promise(function () {}); });
      }
    } catch (e) {}
  }

  // ============================== 7. FORMULARIO (PASOS 1 A 5) ==============================
  function submitFormWithBtn(btn) {
    if (!btn || window.botSubmitting) return;
    window.botSubmitting = true;
    window.__botLastStepAt = Date.now();
    try {
      btn.style.outline = "4px solid #22c55e";
      if (typeof btn.focus === "function") btn.focus();
      btn.click();
      // Proteger el envio: alejar la recarga automatica mientras el formulario viaja.
      injectMetaRefresh(Math.max(getRemainingSeconds(), 20), BASE_URL);
    } catch (e) { window.botSubmitting = false; }
  }

  function markBooked() {
    if (window.botBooked) return;
    window.botBooked = true;
    window.botTimerPaused = true;
    lsSet("bot_booked", "1");
    lsSet("bot_deadline", Date.now() + 999999999); // el watchdog queda en pausa
    cancelMetaRefresh();                            // no recargar una pagina con cita dentro
  }

  function runStep() {
    initHTML5KeepAlive();

    var href = (window.location.href || "").toLowerCase();
    // innerText respeta lo visible (evita falsos positivos del texto legal oculto);
    // si el motor no lo soporta se usa textContent como respaldo.
    var body = "";
    if (document.body) {
      body = (typeof document.body.innerText === "string") ? document.body.innerText : (document.body.textContent || "");
    }
    var lower = body.toLowerCase();

    // PASO 0: AUTO-RECUPERACION DE ERRORES REALES (sin falsos positivos del texto legal)
    var isRealError = body.indexOf("Se ha producido un error en el sistema") !== -1 ||
                      body.indexOf("Su sesión ha caducado") !== -1 ||
                      body.indexOf("caducado por permanecer") !== -1 ||
                      body.indexOf("404 Not Found") !== -1 ||
                      body.indexOf("429 Too Many Requests") !== -1 ||
                      body.indexOf("The requested URL was rejected") !== -1;

    if (isRealError) {
      setStatus("🔄 Error del servidor detectado: limpiando sesión y reiniciando formulario...");
      var btnAceptarError = document.querySelector("#btnAceptar") ||
                            document.querySelector("input[value='Aceptar']") ||
                            document.querySelector("button[value='Aceptar']") ||
                            document.querySelector(".btn-primary");
      if (btnAceptarError) { try { btnAceptarError.click(); } catch (e) {} }
      window.__botLastStepAt = 0;
      setTimeout(function () { hardNavigate(BASE_URL, true); }, 1500);
      return;
    }

    // PASO 1: PROVINCIA -> BARCELONA
    var selProv = document.querySelector("select[name*='provincia']") || document.querySelector("select");
    var btnProvAceptar = document.querySelector("#btnAceptar") || document.querySelector("input[value='Aceptar']");

    if (selProv && btnProvAceptar && (body.indexOf("PROVINCIAS DISPONIBLES") !== -1 || body.indexOf("Selecciona Provincia") !== -1 ||
        href.indexOf("acopcdirect") !== -1 || (href.indexOf("acprovincias") !== -1 && body.indexOf("TRÁMITE") === -1))) {
      setStatus("📍 Paso 1/5: Seleccionando Provincia BARCELONA...");
      var foundP = false;
      for (var i = 0; i < selProv.options.length; i++) {
        if (selProv.options[i].text.toUpperCase().indexOf("BARCELONA") !== -1 || selProv.options[i].value === PROVINCIA_VAL) {
          selProv.selectedIndex = i;
          selProv.dispatchEvent(new Event("change", { bubbles: true }));
          foundP = true;
          break;
        }
      }
      if (foundP) { setTimeout(function () { submitFormWithBtn(btnProvAceptar); }, 600); return; }
    }

    // PASO 2: TRAMITE -> TOMA DE HUELLAS
    var selects = document.querySelectorAll("select");
    if (selects.length > 0 && (body.indexOf("TRÁMITES") !== -1 || body.indexOf("TRÁMITE") !== -1 || body.indexOf("TOMA DE HUELLAS") !== -1) &&
        body.indexOf("Identidad del usuario") === -1) {
      setStatus("📋 Paso 2/5: Seleccionando Trámite TOMA DE HUELLAS...");
      var tramiteSel = null, tramiteIdx = -1;
      for (var s = 0; s < selects.length; s++) {
        for (var o = 0; o < selects[s].options.length; o++) {
          var txtOpt = selects[s].options[o].text.toUpperCase();
          if (txtOpt.indexOf("TOMA DE HUELLAS") !== -1 || txtOpt.indexOf("HUELLAS") !== -1) {
            tramiteSel = selects[s]; tramiteIdx = o; break;
          }
        }
        if (tramiteSel) break;
      }
      if (tramiteSel && tramiteIdx !== -1) {
        tramiteSel.selectedIndex = tramiteIdx;
        tramiteSel.dispatchEvent(new Event("change", { bubbles: true }));
        var btnAceptarTramite = document.querySelector("#btnAceptar") || document.querySelector("input[value='Aceptar']");
        setTimeout(function () { submitFormWithBtn(btnAceptarTramite); }, 700);
        return;
      }
    }

    // PASO 3: AVISO DE INFORMACION -> ENTRAR
    var btnEntrar = document.querySelector("#btnEntrar") ||
                    document.querySelector("input[value*='Entrar']") ||
                    document.querySelector("button[id*='Entrar']");
    if (btnEntrar) {
      setStatus("🚪 Paso 3/5: Pulsando 'Entrar' en el aviso de información...");
      setTimeout(function () { submitFormWithBtn(btnEntrar); }, 500);
      return;
    }

    // PASO 4: DATOS DE AMINA CHAIR
    var inputNie = document.querySelector("#txtIdCitado") || document.querySelector("input[name*='txtIdCitado']");
    var inputNombre = document.querySelector("#txtDesCitado") || document.querySelector("input[name*='txtDesCitado']");

    if (inputNie && inputNombre) {
      setStatus("👤 Paso 4/5: Rellenando datos de Amina Chair (NIE " + NIE + ")...");
      var radioNie = document.querySelector("#rdbTipoDocNie") || document.querySelector("input[value='NIE']");
      if (radioNie) { radioNie.checked = true; radioNie.dispatchEvent(new Event("change", { bubbles: true })); }

      inputNie.value = NIE;
      inputNie.dispatchEvent(new Event("input", { bubbles: true }));
      inputNie.dispatchEvent(new Event("change", { bubbles: true }));

      inputNombre.value = NOMBRE;
      inputNombre.dispatchEvent(new Event("input", { bubbles: true }));
      inputNombre.dispatchEvent(new Event("change", { bubbles: true }));

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
      setTimeout(function () { submitFormWithBtn(btnEnviarDatos); }, 800);
      return;
    }

    // PASO 5: SOLICITAR CITA
    var btnSolicitar = document.querySelector("#btnEnviar") || document.querySelector("input[value*='Solicitar']");
    if (btnSolicitar && (body.indexOf("Solicitar Cita") !== -1 || body.indexOf("Identidad del usuario") !== -1)) {
      setStatus("⚡ Paso 5/5: Comprobando disponibilidad de citas en Barcelona...");
      setTimeout(function () { submitFormWithBtn(btnSolicitar); }, 600);
      return;
    }

    // PASO 6: CITA / OFICINAS / FECHAS DISPONIBLES -> RESERVA INSTANTANEA
    var radiosCita = document.querySelectorAll("input[type='radio'][name*='cita']");
    var inTel = document.querySelector("#txtTelefonoCitado") || document.querySelector("input[name*='Telefono']");
    var inMail1 = document.querySelector("#email") || document.querySelector("#txtEmail") || document.querySelector("input[name*='email']");

    if (radiosCita.length > 0 || inTel || inMail1 || body.indexOf("Seleccione la cita") !== -1 || body.indexOf("Confirmación de la cita") !== -1) {
      document.body.style.backgroundColor = "#bbf7d0";

      if (radiosCita.length > 0) {
        radiosCita[0].checked = true;
        radiosCita[0].dispatchEvent(new Event("change", { bubbles: true }));
      }
      var inMail2 = document.querySelector("#emailConfirm") || document.querySelector("#txtEmailConfirmar");
      if (inTel) { inTel.value = TELEFONO; inTel.dispatchEvent(new Event("input", { bubbles: true })); }
      if (inMail1) { inMail1.value = EMAIL; inMail1.dispatchEvent(new Event("input", { bubbles: true })); }
      if (inMail2) { inMail2.value = EMAIL; inMail2.dispatchEvent(new Event("input", { bubbles: true })); }

      markBooked();
      setStatus("🎉 ¡CITA DETECTADA EN BARCELONA! Confirmando reserva ahora mismo...");
      sendNotification("🎉 ¡CITA ENCONTRADA EN BARCELONA!", "Amina Chair: cita detectada y confirmándose. Revisa " + EMAIL);
      playAlarm();
      vibrate([1000, 300, 1000, 300, 2000, 300, 2000]);

      setTimeout(function () {
        var btnFinal = document.querySelector("#btnSiguiente") || document.querySelector("#btnEnviar") || document.querySelector("input[value*='Confirmar']");
        submitFormWithBtn(btnFinal);
      }, 600);
      return;
    }

    // PASO 7: SIN CITAS -> el watchdog de 10 minutos hace la recarga (nada que hacer aqui)
    if (lower.indexOf("en este momento no hay citas disponibles") !== -1 ||
        lower.indexOf("no hay citas disponibles") !== -1 ||
        lower.indexOf("no existen citas disponibles") !== -1 ||
        lower.indexOf("no se han encontrado citas") !== -1) {
      if (!window.botNoCitasNotified) {
        window.botNoCitasNotified = true;
        var timeNow = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        sendNotification("🤖 Intento #" + getAttemptCount() + " revisado en Barcelona",
          "Revisado a las " + timeNow + ". Sin citas libres. Recarga automática en 10 minutos.");
        vibrate([200, 100, 200]);
      }
      setStatus("❌ Sin citas disponibles en este momento. La página se recargará sola al llegar a 00:00.");
      return;
    }

    // PAGINA GENERAL -> volver al inicio del formulario
    if (!window.botReentered && href.indexOf("acopcdirect") === -1 && body.indexOf("PROVINCIA") === -1) {
      window.botReentered = true;
      setStatus("🔍 Iniciando asistente de citas Barcelona para Amina Chair...");
      setTimeout(function () { hardNavigate(BASE_URL, false); }, 3000);
      return;
    }

    setStatus("⏳ Esperando la respuesta del servidor... (recarga automática garantizada)");
  }

  // ============================== 8. ARRANQUE ==============================
  if (lsGet("bot_booked") === "1") {
    window.botBooked = true;
    window.botTimerPaused = true;
    cancelMetaRefresh();
  }

  if (window.__botNewCycle) {
    var lastNotified = lsGet("bot_cycle_notified");
    if (lastNotified !== window.__botCycleId) {
      lsSet("bot_cycle_notified", window.__botCycleId);
      sendNotification("🤖 Intento #" + getAttemptCount() + " en Barcelona",
        "Buscando cita para " + NOMBRE + " (" + NIE + "). Provincia BARCELONA, TOMA DE HUELLAS. Recarga automática cada 10 min.");
    }
  }

  setInterval(function () { if (!window.botSubmitting) runStep(); }, 2000);

  function boot(tries) {
    if (window.botBooked) return;
    if (!document.body) {
      if ((tries || 0) < 100) setTimeout(function () { boot((tries || 0) + 1); }, 300);
      return;
    }
    render();
    runStep();
  }
  setTimeout(function () { boot(0); }, 700);

  // Objeto de diagnostico (se puede inspeccionar desde la consola del navegador).
  window.__BOT_BARCELONA = {
    version: "9.3",
    intento: getAttemptCount,
    segundosRestantes: getRemainingSeconds,
    metaRefreshArmado: function () { return window.__botMetaRefreshArmed; },
    recargarAhora: function () { lsSet("bot_deadline", Date.now()); lastReloadTry = 0; forceReload("manual"); },
    pausar: function () { window.botTimerPaused = true; cancelMetaRefresh(); render(); },
    reanudar: function () {
      window.botTimerPaused = false; window.botBooked = false; lsDel("bot_booked");
      lsSet("bot_deadline", Date.now() + RETRY_SEC * 1000);
      injectMetaRefresh(RETRY_SEC, BASE_URL); render();
    }
  };
})();
