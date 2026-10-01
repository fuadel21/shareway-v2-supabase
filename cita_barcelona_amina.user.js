// ==UserScript==
// @name         Bot Cita Previa Barcelona - Version 9.2 (Amina Chair - Precisión Absoluta)
// @namespace    https://icp.administracionelectronica.gob.es/
// @version      9.8
// @description  v9.8 - Amina Chair (NIE Y2086361E). Ciclo de 7 minutos, panel estable y reintento inmediato al volver del segundo plano si la página indica que no hay citas.
// @author       Asistente Arena.ai
// @match        *://icp.administracionelectronica.gob.es/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/fuadel21/shareway-v2-supabase/arena/01a025e6-shareway-v2-supabase/cita_barcelona_amina.user.js
// @downloadURL  https://raw.githubusercontent.com/fuadel21/shareway-v2-supabase/arena/01a025e6-shareway-v2-supabase/cita_barcelona_amina.user.js
// ==/UserScript==

/* =====================================================================================
   IMPORTANTE PARA TAMPERMONKEY (no cambiar estas dos lineas):
   - El @name se mantiene EXACTAMENTE igual que en la version 9.2 a proposito: asi
     Tampermonkey reconoce este archivo como ACTUALIZACION del mismo script (mismo
     @name + @namespace) y NO crea uno nuevo. Si cambias el @name tendrias DOS bots
     instalados a la vez. La version real se ve en @version y dentro del panel del bot.
   - @grant debe seguir siendo "none": asi el script se ejecuta en el contexto de la
     pagina y puede neutralizar el dialogo "Desea salir?" del portal.
   ===================================================================================== */

/* =====================================================================================
   BOT CITA PREVIA BARCELONA - VERSION 9.8 "RECUPERACION AL VOLVER"
   -------------------------------------------------------------------------------------
   NOVEDADES v9.8 (reintenta al volver si Android congeló Firefox):
   1) Conserva las correcciones de estabilidad del panel, selectores y envíos de v9.7.
   2) Al volver de un congelamiento, si la página muestra "no hay citas disponibles",
      inicia un nuevo ciclo inmediatamente en vez de esperar el contador restante.
   3) Si el formulario sigue en otro paso, reanuda su análisis y rearma el meta-refresh.
   4) El audio de fondo ayuda solo cuando el navegador y Android permiten mantenerlo;
      esta versión no puede impedir que el sistema suspenda Firefox.
   -------------------------------------------------------------------------------------
   HISTORIAL v9.6 (persistencia de la intención del modo segundo plano):
   1) MODO SEGUNDO PLANO: intenta reproducir un tono bajo de 60 Hz para ayudar a mantener
      Firefox activo. El sistema operativo todavía puede suspender o cerrar la aplicación.
   2) WAKE LOCK (si el navegador lo soporta): intenta mantener la pantalla activa mientras
      la pestaña está visible; Android puede liberarlo al cambiar de aplicación.
   3) LATIDO + DETECCION DE CONGELAMIENTO: registra un latido cada segundo mientras el
      script puede ejecutarse. Al volver a Firefox, intenta detectar la pausa y reanudar.
   -------------------------------------------------------------------------------------
   v9.4: la busqueda se repite CADA 7 MINUTOS (RETRY_SEC = 420) y la pagina se recarga
   SOLA al llegar el contador a 00:00, sin ningun boton.
   -------------------------------------------------------------------------------------
   HISTORIAL v9.3-v9.6 (cambios previos de recarga y segundo plano):
   - El script usa una fecha límite persistente y combina watchdog de JavaScript con un
     meta-refresh de respaldo. El comportamiento real depende del navegador y de Android.
   - Se neutralizan los handlers beforeunload del portal para evitar un diálogo al navegar.
   - Las versiones anteriores probaron audio/wake lock para el segundo plano; eso no puede
     impedir que Android suspenda o cierre Firefox.
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
  var RETRY_SEC = 420; // ciclo solicitado: 7 min; depende de que navegador y portal sigan activos
  var BASE_URL = "https://icp.administracionelectronica.gob.es/icpplustieb/acOpcDirect";
  var RELOAD_GUARD_MS = 10000;  // reintentos espaciados para evitar parpadeo/cascada
  var STEP_GRACE_MS = 25000;    // margen si el flujo del formulario esta en curso
  var SUBMIT_TIMEOUT_MS = 30000; // no dejar el bot bloqueado si el portal no responde
  var FREEZE_GAP_MS = 90000;    // mas de 90 s sin latido = Firefox congelado en 2o plano
  var IS_TOP = (window.top === window.self);

  // Guardia anti-duplicados: si por lo que sea quedase instalada tambien la 9.2, esta
  // version arranca antes (document-start) y la otra se desactiva sola al ver la marca.
  if (window.botInitializedV96 || window.botInitializedV95 || window.botInitializedV94 || window.botInitializedV93 || window.botInitialized) return;
  window.botInitializedV96 = true;
  window.botInitializedV95 = true;
  window.botInitializedV94 = true;
  window.botInitializedV93 = true;
  window.botInitialized = true;

  // Nombre del gestor de usuarioscripts (Tampermonkey / Violentmonkey) si lo expone.
  var MANAGER = "";
  try {
    if (typeof GM_info !== "undefined" && GM_info && GM_info.scriptHandler) MANAGER = String(GM_info.scriptHandler);
  } catch (e) {}

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
  // Se intenta inyectar antes de load como respaldo nativo. Firefox/Android puede
  // suspender una pestaña aun con meta-refresh y audio; no existe garantía 24/7 del navegador.
  var metaEl = null;
  var pendingMetaRefresh = null;
  var metaRetryTimer = null;
  var metaRetryCount = 0;

  function removeOwnedMetaRefresh() {
    try {
      var owned = document.querySelectorAll("meta#bot-meta-refresh[data-bot-owner='shareway-v97'], meta#bot-meta-refresh[data-bot-owner='shareway-v98']");
      for (var i = 0; i < owned.length; i++) {
        if (owned[i] && owned[i].parentNode) owned[i].parentNode.removeChild(owned[i]);
      }
      if (metaEl && metaEl.parentNode) metaEl.parentNode.removeChild(metaEl);
    } catch (e) {}
    metaEl = null;
  }

  function scheduleMetaRefreshRetry() {
    if (metaRetryTimer || metaRetryCount >= 100 || window.botBooked) return;
    metaRetryTimer = setTimeout(function () {
      metaRetryTimer = null;
      if (!pendingMetaRefresh || window.botBooked) return;
      metaRetryCount++;
      var pending = pendingMetaRefresh;
      pendingMetaRefresh = null;
      injectMetaRefresh(pending.sec, pending.url);
    }, 50);
  }

  function cancelMetaRefresh() {
    pendingMetaRefresh = null;
    if (metaRetryTimer) { clearTimeout(metaRetryTimer); metaRetryTimer = null; }
    metaRetryCount = 0;
    removeOwnedMetaRefresh();
    window.__botMetaRefreshArmed = 0;
  }

  function injectMetaRefresh(sec, url) {
    if (window.botBooked) return false;
    try {
      // Una meta-refresh en <html> o <body> no es fiable. Esperar a que exista <head>.
      var head = document.head || document.getElementsByTagName("head")[0];
      var s = Math.max(1, Math.round(sec));
      var target = url || BASE_URL;

      // Si el formulario se esta enviando, no cortar el paso en curso.
      if (window.__botLastStepAt && (Date.now() - window.__botLastStepAt) < 60000) {
        s = Math.max(s, 20);
      }

      if (!head) {
        pendingMetaRefresh = { sec: s, url: target };
        scheduleMetaRefreshRetry();
        window.__botMetaRefreshArmed = 0;
        return false;
      }

      if (metaRetryTimer) { clearTimeout(metaRetryTimer); metaRetryTimer = null; }
      pendingMetaRefresh = null;
      metaRetryCount = 0;
      removeOwnedMetaRefresh();

      var m = document.createElement("meta");
      m.setAttribute("http-equiv", "refresh");
      m.setAttribute("content", s + ";url=" + target);
      m.setAttribute("data-bot-owner", "shareway-v98");
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
    var backoff = Math.min(60000, RELOAD_GUARD_MS * Math.pow(2, Math.min(reloadTries, 3)));
    if (now - lastReloadTry < backoff) return;
    lastReloadTry = now;
    reloadTries++;
    window.__botReloadStarted = true;

    try { window.onbeforeunload = null; window.onunload = null; } catch (e) {}

    // No reiniciar el timer en cada tick: se deja un único respaldo nativo de 5 s.
    window.__botLastStepAt = 0;
    injectMetaRefresh(5, BASE_URL);
    hardNavigate(BASE_URL, false);

    if (reloadTries === 1) {
      setStatus("🔄 Contador a cero (" + reason + "): intentando abrir de nuevo el formulario...");
      sendNotification("🔄 Reiniciando búsqueda Barcelona", "Intento #" + getAttemptCount() + ": el portal está tardando en responder.");
    } else {
      setStatus("⚠️ El portal no ha navegado todavía. Nuevo intento espaciado; el temporizador sigue activo.");
    }
  }

  // ============================== 4. WATCHDOG GLOBAL (cada 1 segundo) ==============================
  var deadlineExpiredAt = 0;

  function watchdog() {
    lsSet("bot_hb", Date.now()); // latido: permite detectar congelamientos en segundo plano
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
    forceReload("7 min cumplidos");
  }

  // Intervalo principal + intervalo de respaldo (por si el primero se degrada en segundo plano).
  setInterval(watchdog, 1000);
  setInterval(function () {
    if (!window.botBooked && !window.botTimerPaused && !window.botSubmitting && getRemainingSeconds() <= 0) forceReload("watchdog de respaldo");
  }, 5000);

  // ============================== 5. PANEL DE ESTADO (UI) ==============================
  var statusText = "🔍 Iniciando asistente de citas Barcelona para Amina Chair...";
  var bannerEl = null;

  function setStatus(txt) {
    if (statusText === txt) return; // no reconstruir el panel en cada sondeo idéntico
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
        "<span>🤖 BOT BARCELONA v9.8" + (MANAGER ? " · " + MANAGER : "") + " " + (booked ? "🎉" : (paused ? "⏸️" : "🟢")) + "</span>" +
        "<span style='background:#1e3a8a;color:#93c5fd;padding:2px 8px;border-radius:6px;font-size:11px;'>INTENTO #" + getAttemptCount() + "</span>" +
      "</div>" +
      "<div style='color:#e2e8f0;font-size:12px;'>" +
        "👤 <b>" + NOMBRE + "</b> (" + NIE + ") · 📍 <b>BARCELONA</b> · TOMA DE HUELLAS<br>" +
        "📱 <b>" + TELEFONO + "</b> · ✉️ <b>" + EMAIL + "</b>" +
        "<div style='margin-top:6px;padding-top:5px;border-top:1px solid #334155;color:#facc15;font-weight:bold;'>" + statusText + "</div>" +
        "<div style='margin-top:6px;color:#e2e8f0;'>⏱️ Próxima recarga en: <b id='bot-countdown' style='color:#22c55e;font-size:16px;'>--:--</b>" +
          "<span style='color:#94a3b8;font-size:11px;'> · " + (booked ? "en pausa (cita detectada)" : (paused ? "en pausa" : (armed ? "motor nativo armado ✅ (" + armed + "s)" : "motor nativo re-armándose..."))) + "</span>" +
        "</div>" +
        "<div style='margin-top:4px;font-size:11px;color:#94a3b8;'>🔊 Segundo plano: " +
          (window.__botBgMode ? "<b style='color:#22c55e;'>ACTIVO ✅</b> (audio en marcha; Android aún puede suspender Firefox)" : (lsGet("bot_bg_intent") === "1" ? "<b style='color:#facc15;'>ESPERANDO TOQUE 🔑</b> (toca cualquier parte)" : "<b style='color:#f87171;'>INACTIVO</b> (toca el botón morado 🔊)")) +
          (window.__botLastFreeze ? " · ⚠️ congelado " + window.__botLastFreeze + " min la última vez" : "") +
        "</div>" +
      "</div>" +
      (("Notification" in window) && Notification.permission !== "granted" || booked || paused || !isBackgroundModeActive()
        ? "<div style='display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;'>" +
            (("Notification" in window) && Notification.permission !== "granted"
              ? "<button id='bot-btn-notif' style='flex:1;padding:9px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-weight:bold;font-size:12px;'>🔔 ACTIVAR AVISOS</button>" : "") +
            (!isBackgroundModeActive()
              ? "<button id='bot-btn-bg' style='flex:1;padding:9px;border:none;border-radius:8px;background:#7c3aed;color:#fff;font-weight:bold;font-size:12px;'>🔊 ACTIVAR SEGUNDO PLANO</button>" : "") +
            (booked || paused
              ? "<button id='bot-btn-resume' style='flex:1;padding:9px;border:none;border-radius:8px;background:#16a34a;color:#fff;font-weight:bold;font-size:12px;'>🔁 REANUDAR BÚSQUEDA 24/7</button>" : "") +
          "</div>"
        : "");

    var btnNotif = document.getElementById("bot-btn-notif");
    if (btnNotif) btnNotif.onclick = function () {
      initHTML5KeepAlive();
      activateBackgroundMode();
      try {
        Notification.requestPermission().then(function (p) {
          if (p === "granted") sendNotification("✅ Avisos Activados", "Recibirás un aviso en cada intento de cita.");
          render();
        });
      } catch (e) {}
    };

    var btnBg = document.getElementById("bot-btn-bg");
    if (btnBg) btnBg.onclick = function () { initHTML5KeepAlive(); activateBackgroundMode(); };

    var btnResume = document.getElementById("bot-btn-resume");
    if (btnResume) btnResume.onclick = function () {
      window.botBooked = false;
      window.botTimerPaused = false;
      lsDel("bot_booked");
      lsSet("bot_deadline", Date.now() + RETRY_SEC * 1000);
      lastReloadTry = 0;
      injectMetaRefresh(RETRY_SEC, BASE_URL);
      setStatus("🔁 Búsqueda automática reanudada (ciclo nuevo de 7 minutos).");
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

  // ============================== 6b. MODO SEGUNDO PLANO (ANTI-CONGELAMIENTO) ==============================
  // Android puede congelar las apps en segundo plano y Firefox puede suspender pestañas.
  // El audio de fondo puede ayudar a mantener Firefox activo, pero depende de la versión,
  // permisos, batería y fabricante del móvil; no garantiza ejecución continua. El tono es
  // un zumbido a 60 Hz de amplitud baja y puede oírse según el dispositivo.
  var wakeLockObj = null;

  function isBackgroundModeActive() { return !!window.__botBgMode; }

  function buildToneURL() {
    try {
      var sr = 8000, n = sr; // 1 segundo
      var buf = new ArrayBuffer(44 + n * 2);
      var v = new DataView(buf);
      function wstr(off, str) { for (var i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); }
      wstr(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); wstr(8, "WAVE"); wstr(12, "fmt ");
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      wstr(36, "data"); v.setUint32(40, n * 2, true);
      for (var i2 = 0; i2 < n; i2++) {
        v.setInt16(44 + i2 * 2, Math.round(Math.sin(2 * Math.PI * 60 * i2 / sr) * 0.06 * 32767), true);
      }
      var bytes = new Uint8Array(buf), bin = "";
      for (var i3 = 0; i3 < bytes.length; i3++) bin += String.fromCharCode(bytes[i3]);
      return "data:audio/wav;base64," + btoa(bin);
    } catch (e) { return ""; }
  }

  function requestWakeLock() {
    try {
      if (!navigator.wakeLock || !navigator.wakeLock.request || wakeLockObj) return;
      navigator.wakeLock.request("screen").then(function (wl) {
        wakeLockObj = wl;
        if (wl && wl.addEventListener) {
          wl.addEventListener("release", function () {
            wakeLockObj = null;
            if (!document.hidden) setTimeout(requestWakeLock, 5000);
          });
        }
      }).catch(function () {});
    } catch (e) {}
  }

  // Necesita un toque del usuario si Firefox tiene el autoplay bloqueado.
  function activateBackgroundMode() {
    lsSet("bot_bg_intent", "1");
    if (window.__botBgMode) { requestWakeLock(); return true; }
    var url = "";
    try { url = buildToneURL(); } catch (e) { url = ""; }
    if (!url) return false;
    try {
      var audio = new Audio(url);
      audio.loop = true;
      audio.volume = 0.05;
      audio.setAttribute("playsinline", "");
      var p = null;
      try { p = audio.play(); } catch (e) { p = null; }
      var finish = function (ok) {
        window.__botBgMode = ok;
        if (ok) {
          window.__botBgAudio = audio;
          setStatus("🔊 Audio de fondo activo ✅ (el navegador aún puede suspender la pestaña)");
          sendNotification("🔊 Audio de fondo activado", "Firefox intentará mantener la pestaña activa; Android todavía puede suspenderla.");
        } else {
          setStatus("⚠️ Audio bloqueado: toca el botón morado 🔊 y elige 'Permitir audio' (o activa Autoplay en Firefox).");
        }
        render();
      };
      if (p && typeof p.then === "function") {
        p.then(function () { finish(true); }).catch(function () { finish(false); });
      } else {
        finish(!audio.paused);
      }
    } catch (e) {
      setStatus("⚠️ Este navegador no permite el modo segundo plano con audio.");
      render();
      return false;
    }
    requestWakeLock();
    return true;
  }

  function initHTML5KeepAlive() {
    requestWakeLock();
    try {
      if ("locks" in navigator && !window.__botLock) {
        window.__botLock = true;
        navigator.locks.request("bot_cita_lock", { mode: "exclusive" }, function () { return new Promise(function () {}); });
      }
    } catch (e) {}
  }

  // El primer toque en cualquier parte de la pagina activa el modo segundo plano.
  try {
    var armBgOnce = function () {
      try {
        if (lsGet("bot_bg_intent") === "1" && !window.__botBgMode) activateBackgroundMode();
      } catch (e) {}
    };
    document.addEventListener("pointerdown", armBgOnce, { capture: true, passive: true });
    document.addEventListener("touchstart", armBgOnce, { capture: true, passive: true });
  } catch (e) {}

  // ============================== 6c. RECUPERACION AL VOLVER (DETECCION DE CONGELAMIENTO) ==============================
  var resumeCheck = function () {
    try {
      var hb = parseInt(lsGet("bot_hb") || "0", 10);
      var gap = hb ? (Date.now() - hb) : 0;

      if (!window.botBooked) {
        if (gap > FREEZE_GAP_MS && !window.__botReloadStarted) {
          var mins = Math.max(1, Math.round(gap / 60000));
          window.__botLastFreeze = mins;
          setStatus("▶️ Firefox estuvo congelado " + mins + " min en segundo plano. Comprobando la página al volver...");
          sendNotification("▶️ Bot reanudado", "Firefox estuvo " + mins + " min congelado en segundo plano. Comprobando de nuevo la página de citas.");

          var resumeBody = "";
          try { resumeBody = getPortalBodyText(); } catch (e) {}
          var resumeText = resumeBody.normalize ? resumeBody.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase() : resumeBody.toUpperCase();
          var noAppointments = resumeText.indexOf("EN ESTE MOMENTO NO HAY CITAS DISPONIBLES") !== -1 ||
                               resumeText.indexOf("NO HAY CITAS DISPONIBLES") !== -1 ||
                               resumeText.indexOf("NO EXISTEN CITAS DISPONIBLES") !== -1 ||
                               resumeText.indexOf("NO SE HAN ENCONTRADO CITAS") !== -1;

          if (getRemainingSeconds() <= 0 || noAppointments) {
            // Al volver tras una pausa larga no esperar varios minutos en una pantalla
            // que ya confirmó que no hay citas: empezar ahora un ciclo nuevo.
            if (noAppointments) lsSet("bot_deadline", Date.now() - 2000);
            lastReloadTry = 0;
            deadlineExpiredAt = 0;
            forceReload(noAppointments ? "reintento inmediato al volver: sin citas" : "al volver del segundo plano");
          } else {
            cancelMetaRefresh();
            injectMetaRefresh(getRemainingSeconds(), BASE_URL);
            setTimeout(function () {
              if (!window.botBooked && !window.botSubmitting && !window.__botReloadStarted) runStep();
            }, 0);
          }
        } else if (!window.botTimerPaused && !(window.__botMetaRefreshArmed > 0)) {
          // El navegador pudo cancelar el meta-refresh al congelar la pestana: se re-arma.
          injectMetaRefresh(Math.max(getRemainingSeconds(), 1), BASE_URL);
        }
      }

      // Si el audio de fondo se paro (p.ej. tras una recarga), se intenta reanudar.
      if (lsGet("bot_bg_intent") === "1" && (!window.__botBgMode || (window.__botBgAudio && window.__botBgAudio.paused))) {
        try { activateBackgroundMode(); } catch (e) {}
      }
      if (window.__botBgMode && window.__botBgAudio && window.__botBgAudio.paused) {
        try { var pp = window.__botBgAudio.play(); if (pp && pp.catch) pp.catch(function () {}); } catch (e) {}
      }
      if (!window.__botBgMode) { try { activateBackgroundMode(); } catch (e) {} }
      requestWakeLock();

      lsSet("bot_hb", Date.now());
      render();
    } catch (e) {}
  };
  try { document.addEventListener("visibilitychange", function () { if (!document.hidden) resumeCheck(); }); } catch (e) {}
  try { window.addEventListener("focus", resumeCheck); } catch (e) {}
  try { window.addEventListener("pageshow", resumeCheck); } catch (e) {}

  // ============================== 7. FORMULARIO (PASOS 1 A 5) ==============================
  function getPortalBodyText() {
    try {
      if (!document.body) return "";
      var clone = document.body.cloneNode(true);
      var botUi = clone.querySelectorAll("#bot-status-banner, #bot-notif-btn, #bot-nav-form");
      for (var i = 0; i < botUi.length; i++) { if (botUi[i].parentNode) botUi[i].parentNode.removeChild(botUi[i]); }
      return (typeof clone.innerText === "string") ? clone.innerText : (clone.textContent || "");
    } catch (e) {
      return document.body ? (document.body.textContent || "") : "";
    }
  }

  function pageFingerprint() {
    try {
      var text = getPortalBodyText().replace(/\s+/g, " ").trim();
      return String(window.location.pathname || "") + "|" + text.slice(0, 4000);
    } catch (e) { return String(window.location.pathname || ""); }
  }

  function submitFormWithBtn(btn) {
    if (!btn || window.botSubmitting || window.__botSubmitStalled) return false;
    if (btn.disabled || (btn.isConnected === false)) {
      setStatus("⚠️ El botón del formulario está desactivado o ya no está en la página; esperando al portal.");
      return false;
    }

    window.botSubmitting = true;
    window.__botLastStepAt = Date.now();
    var before = pageFingerprint();
    try {
      btn.style.outline = "4px solid #22c55e";
      if (typeof btn.focus === "function") btn.focus();
      btn.click();
      // El tiempo restante es el margen principal; el meta-refresh evita cortar un POST.
      injectMetaRefresh(Math.max(getRemainingSeconds(), 30), BASE_URL);
      var submitWatchStartedAt = Date.now();
      var inspectSubmitResult = function () {
        if (!window.botSubmitting) return;
        var after = pageFingerprint();
        if (after !== before) {
          window.botSubmitting = false;
          setStatus(window.botBooked
            ? "✅ El portal respondió a la confirmación. Comprueba el resultado que muestra la página oficial."
            : "✅ El portal respondió al envío; comprobando el siguiente paso...");
          return;
        }
        if (Date.now() - submitWatchStartedAt >= SUBMIT_TIMEOUT_MS) {
          window.botSubmitting = false;
          if (window.botBooked) {
            setStatus("⚠️ Detecté una cita, pero el portal no confirmó el último envío. Dejo la página abierta para verificarla.");
            return;
          }
          // No repetir clics ciegos: puede duplicar una operación o provocar un bloqueo.
          window.__botSubmitStalled = true;
          window.__botSubmitFingerprint = after;
          setStatus("⚠️ El portal no confirmó el envío. No repetiré clics; la recarga automática sigue armada.");
          return;
        }
        setTimeout(inspectSubmitResult, 1000);
      };
      setTimeout(inspectSubmitResult, 1000);
      return true;
    } catch (e) {
      window.botSubmitting = false;
      setStatus("⚠️ No se pudo pulsar el botón del portal; se volverá a comprobar la página.");
      return false;
    }
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
    if (window.botSubmitting || window.botBooked || window.botTimerPaused || window.__botReloadStarted) return;

    // Si un POST no cambió el documento, no repetir el clic a ciegas. Si cambia el
    // contenido más tarde, se reanuda el análisis automáticamente.
    if (window.__botSubmitStalled) {
      var currentFingerprint = pageFingerprint();
      if (currentFingerprint === window.__botSubmitFingerprint) return;
      window.__botSubmitStalled = false;
      setStatus("✅ Ha llegado una respuesta nueva del portal; retomando la búsqueda.");
    }

    var href = (window.location.href || "").toLowerCase();
    // Leer el texto del portal sin el panel del bot, para no confundir sus etiquetas
    // (p. ej. "TOMA DE HUELLAS") con el contenido real del formulario.
    var body = getPortalBodyText();
    var normalizedBody = body.normalize ? body.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase() : body.toUpperCase();
    var pageHint = "";

    // PASO 0: AUTO-RECUPERACION DE ERRORES REALES (sin falsos positivos del texto legal)
    var isRealError = normalizedBody.indexOf("SE HA PRODUCIDO UN ERROR EN EL SISTEMA") !== -1 ||
                      normalizedBody.indexOf("SU SESION HA CADUCADO") !== -1 ||
                      normalizedBody.indexOf("CADUCADO POR PERMANECER") !== -1 ||
                      normalizedBody.indexOf("404 NOT FOUND") !== -1 ||
                      normalizedBody.indexOf("429 TOO MANY REQUESTS") !== -1 ||
                      normalizedBody.indexOf("THE REQUESTED URL WAS REJECTED") !== -1;

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

    // PASO 1: PROVINCIA -> BARCELONA. Elegir el SELECT que realmente contiene Barcelona,
    // no el primer select de la página (que podía ser otro control y dejar el bot girando).
    var allSelects = document.querySelectorAll("select");
    var selProv = null, provIdx = -1;
    for (var ps = 0; ps < allSelects.length; ps++) {
      for (var po = 0; po < allSelects[ps].options.length; po++) {
        var provOpt = allSelects[ps].options[po];
        var provText = provOpt.text.normalize ? provOpt.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase() : provOpt.text.toUpperCase();
        var isProvSelect = ((allSelects[ps].id || "") + " " + (allSelects[ps].name || "")).toLowerCase().indexOf("prov") !== -1;
        if (provText.indexOf("BARCELONA") !== -1 || (isProvSelect && (provOpt.value === PROVINCIA_VAL || provOpt.value === "08"))) {
          selProv = allSelects[ps]; provIdx = po; break;
        }
      }
      if (selProv) break;
    }
    var btnProvAceptar = document.querySelector("#btnAceptar") || document.querySelector("input[value='Aceptar']") ||
                         document.querySelector("button[value='Aceptar']");
    var isDirectEntry = href.indexOf("acopcdirect") !== -1;
    var isProvincePage = normalizedBody.indexOf("PROVINCIAS DISPONIBLES") !== -1 ||
                         normalizedBody.indexOf("SELECCIONA PROVINCIA") !== -1 ||
                         normalizedBody.indexOf("SELECCIONE PROVINCIA") !== -1 ||
                         (isDirectEntry && normalizedBody.indexOf("TRAMITE") === -1 && normalizedBody.indexOf("IDENTIDAD DEL USUARIO") === -1);

    if (isProvincePage) {
      if (selProv && btnProvAceptar && provIdx !== -1) {
        setStatus("📍 Paso 1/5: Provincia Barcelona detectada; enviando selección...");
        selProv.selectedIndex = provIdx;
        selProv.dispatchEvent(new Event("change", { bubbles: true }));
        setTimeout(function () { submitFormWithBtn(btnProvAceptar); }, 600);
        return;
      }
      if (!selProv) pageHint = "El portal está abierto, pero no encuentro Barcelona en ningún selector de provincia.";
      else if (!btnProvAceptar) pageHint = "Provincia Barcelona detectada, pero no encuentro el botón Aceptar del portal.";
    }

    // PASO 2: TRAMITE -> TOMA DE HUELLAS (normaliza tildes/mayúsculas).
    var isTramitePage = normalizedBody.indexOf("TRAMITE") !== -1 || normalizedBody.indexOf("TOMA DE HUELLAS") !== -1;
    if (allSelects.length > 0 && isTramitePage && normalizedBody.indexOf("IDENTIDAD DEL USUARIO") === -1) {
      var tramiteSel = null, tramiteIdx = -1;
      for (var ts = 0; ts < allSelects.length; ts++) {
        for (var to = 0; to < allSelects[ts].options.length; to++) {
          var txtOpt = allSelects[ts].options[to].text.normalize ? allSelects[ts].options[to].text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase() : allSelects[ts].options[to].text.toUpperCase();
          if (txtOpt.indexOf("TOMA DE HUELLAS") !== -1 || txtOpt.indexOf("HUELLAS") !== -1) {
            tramiteSel = allSelects[ts]; tramiteIdx = to; break;
          }
        }
        if (tramiteSel) break;
      }
      var btnAceptarTramite = document.querySelector("#btnAceptar") || document.querySelector("input[value='Aceptar']") ||
                              document.querySelector("button[value='Aceptar']");
      if (tramiteSel && tramiteIdx !== -1 && btnAceptarTramite) {
        setStatus("📋 Paso 2/5: Trámite Toma de Huellas detectado; enviando selección...");
        tramiteSel.selectedIndex = tramiteIdx;
        tramiteSel.dispatchEvent(new Event("change", { bubbles: true }));
        setTimeout(function () { submitFormWithBtn(btnAceptarTramite); }, 700);
        return;
      }
      if (isTramitePage) {
        if (!tramiteSel) pageHint = "Página de trámites detectada, pero no encuentro la opción Toma de Huellas.";
        else if (!btnAceptarTramite) pageHint = "Trámite detectado, pero no encuentro el botón Aceptar.";
      }
    }

    // PASO 3: AVISO DE INFORMACION -> ENTRAR
    var btnEntrar = document.querySelector("#btnEntrar") ||
                    document.querySelector("input[value*='Entrar' i]") ||
                    document.querySelector("button[id*='Entrar' i]");
    if (btnEntrar) {
      setStatus("🚪 Paso 3/5: Pulsando 'Entrar' en el aviso de información...");
      setTimeout(function () { submitFormWithBtn(btnEntrar); }, 500);
      return;
    }

    // PASO 4: DATOS DE AMINA CHAIR
    var inputNie = document.querySelector("#txtIdCitado") || document.querySelector("input[name*='txtIdCitado']");
    var inputNombre = document.querySelector("#txtDesCitado") || document.querySelector("input[name*='txtDesCitado']");

    if (inputNie && inputNombre) {
      var btnEnviarDatos = document.querySelector("#btnEnviar") || document.querySelector("#btnAceptar") ||
                           document.querySelector("input[value='Aceptar']") || document.querySelector("button[value='Aceptar']");
      if (!btnEnviarDatos) {
        setStatus("👤 Formulario de identidad detectado, pero no encuentro el botón para continuar.");
        return;
      }
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
      setTimeout(function () { submitFormWithBtn(btnEnviarDatos); }, 800);
      return;
    }

    // PASO 5: SOLICITAR CITA
    var btnSolicitar = document.querySelector("#btnEnviar") || document.querySelector("input[value*='Solicitar' i]");
    if (btnSolicitar && (normalizedBody.indexOf("SOLICITAR CITA") !== -1 || normalizedBody.indexOf("IDENTIDAD DEL USUARIO") !== -1)) {
      setStatus("⚡ Paso 5/5: Comprobando disponibilidad de citas en Barcelona...");
      setTimeout(function () { submitFormWithBtn(btnSolicitar); }, 600);
      return;
    }

    // PASO 6: CITA / OFICINAS / FECHAS DISPONIBLES -> RESERVA INSTANTANEA
    var radiosCita = document.querySelectorAll("input[type='radio'][name*='cita']");
    var inTel = document.querySelector("#txtTelefonoCitado") || document.querySelector("input[name*='Telefono']");
    var inMail1 = document.querySelector("#email") || document.querySelector("#txtEmail") || document.querySelector("input[name*='email']");

    var isAppointmentPage = radiosCita.length > 0 || normalizedBody.indexOf("SELECCIONE LA CITA") !== -1 ||
                            normalizedBody.indexOf("CONFIRMACION DE LA CITA") !== -1 ||
                            (normalizedBody.indexOf("FECHA Y HORA") !== -1 && (inTel || inMail1));
    if (isAppointmentPage) {
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
        var btnFinal = document.querySelector("#btnSiguiente") || document.querySelector("#btnEnviar") || document.querySelector("input[value*='Confirmar' i]");
        if (!btnFinal) {
          setStatus("🎉 Cita detectada, pero el portal no muestra un botón final reconocible. Dejo la página abierta para comprobar la confirmación.");
          return;
        }
        submitFormWithBtn(btnFinal);
      }, 600);
      return;
    }

    // PASO 7: SIN CITAS -> el watchdog de 7 minutos hace la recarga automatica (nada que hacer aqui)
    if (normalizedBody.indexOf("EN ESTE MOMENTO NO HAY CITAS DISPONIBLES") !== -1 ||
        normalizedBody.indexOf("NO HAY CITAS DISPONIBLES") !== -1 ||
        normalizedBody.indexOf("NO EXISTEN CITAS DISPONIBLES") !== -1 ||
        normalizedBody.indexOf("NO SE HAN ENCONTRADO CITAS") !== -1) {
      if (!window.botNoCitasNotified) {
        window.botNoCitasNotified = true;
        var timeNow = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        sendNotification("🤖 Intento #" + getAttemptCount() + " revisado en Barcelona",
          "Revisado a las " + timeNow + ". Sin citas libres. Recarga automática en 7 minutos.");
        vibrate([200, 100, 200]);
      }
      setStatus("❌ Sin citas disponibles en este momento. La página se recargará sola al llegar a 00:00.");
      return;
    }

    // PAGINA GENERAL -> volver al inicio del formulario
    if (!window.botReentered && href.indexOf("acopcdirect") === -1 && normalizedBody.indexOf("PROVINCIA") === -1) {
      window.botReentered = true;
      setStatus("🔍 Iniciando asistente de citas Barcelona para Amina Chair...");
      setTimeout(function () { hardNavigate(BASE_URL, false); }, 3000);
      return;
    }

    if (pageHint) setStatus("⚠️ " + pageHint + " El contador y la recarga automática siguen activos.");
    else setStatus("⏳ Página cargada; no identifico un paso del formulario todavía. Esperando respuesta del portal.");
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
        "Buscando cita para " + NOMBRE + " (" + NIE + "). Provincia BARCELONA, TOMA DE HUELLAS. Recarga automática cada 7 min.");
    }
  }

  // Intento automatico al cargar (funciona si Firefox tiene el Autoplay permitido).
  setTimeout(function () {
    try {
      if (!window.botBgMode) {
        injectMetaRefresh(getRemainingSeconds(), BASE_URL);
      }
      activateBackgroundMode();
      resumeCheck();
    } catch (e) {}
  }, 1500);

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
    version: "9.8",
    segundoPlanoActivo: isBackgroundModeActive,
    activarSegundoPlano: function () { return activateBackgroundMode(); },
    revisarAlVolver: function () { return resumeCheck(); },
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
