// ==UserScript==
// @name         Bot Cita Previa Barcelona - Cada 10 Minutos
// @namespace    https://icp.administracionelectronica.gob.es/
// @version      3.6
// @description  Buscador automatico de cita de Toma de Huellas en Barcelona para Amina Chair (Reintento cada 10 minutos)
// @match        *://icp.administracionelectronica.gob.es/*
// @grant        none
// ==/UserScript==

var NOMBRE = "AMINA CHAIR";
var NIE = "Y2086361E";
var NACIONALIDAD = "MARRUECOS";
var RETRY_MINUTES = 10; // Frecuencia de búsqueda: Cada 10 minutos
var RETRY_SEC = RETRY_MINUTES * 60; // 600 segundos

function clickBtn(sel) {
  var b = document.querySelector(sel);
  if (b) b.click();
}

function run() {
  var body = document.body ? document.body.innerText : "";

  // 0. Auto-recuperación si sale "URL was rejected" o Error 0301
  if (body.indexOf("requested URL was rejected") !== -1 || body.indexOf("Se ha producido un error") !== -1 || body.indexOf("0301") !== -1) {
    setTimeout(function() {
      window.location.href = "https://icp.administracionelectronica.gob.es/icpplustieb/index.html";
    }, 3000);
    return;
  }

  var selects = document.querySelectorAll("select");

  // PASO 1: Seleccionar Provincia (Barcelona)
  if (selects.length > 0 && (body.indexOf("PROVINCIAS DISPONIBLES") !== -1 || body.indexOf("Selecciona Provincia") !== -1)) {
    var selP = selects[0];
    for (var i = 0; i < selP.options.length; i++) {
      if (selP.options[i].text.toUpperCase().indexOf("BARCELONA") !== -1 || selP.options[i].value === "8") {
        selP.value = selP.options[i].value;
        selP.dispatchEvent(new Event("change", { bubbles: true }));
        setTimeout(function() {
          clickBtn("#btnAceptar");
          clickBtn("input[value='Aceptar']");
        }, 1200);
        return;
      }
    }
  }

  // PASO 2: Seleccionar Trámite Específico de TOMA DE HUELLAS / RENOVACIÓN TIE
  if (selects.length > 0 && (body.indexOf("TRÁMITES") !== -1 || body.indexOf("TRÁMITE") !== -1)) {
    var targetSelect = null;
    var foundIndex = -1;

    for (var s = 0; s < selects.length; s++) {
      var currentSel = selects[s];
      for (var o = 0; o < currentSel.options.length; o++) {
        var optText = currentSel.options[o].text.toUpperCase();
        if (optText.indexOf("TOMA DE HUELLAS") !== -1 || optText.indexOf("HUELLAS") !== -1 || optText.indexOf("RENOVACIÓN DE TARJETA") !== -1) {
          targetSelect = currentSel;
          foundIndex = o;
          break;
        }
      }
      if (targetSelect) break;
    }

    if (!targetSelect) {
      for (var s2 = selects.length - 1; s2 >= 0; s2--) {
        if (selects[s2].options.length > 1) {
          targetSelect = selects[s2];
          foundIndex = 1;
          break;
        }
      }
    }

    if (targetSelect && foundIndex !== -1) {
      targetSelect.selectedIndex = foundIndex;
      targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
      setTimeout(function() {
        clickBtn("#btnAceptar");
        clickBtn("input[value='Aceptar']");
      }, 1500);
      return;
    }
  }

  // PASO 3: Entrar
  var btnEntrar = document.querySelector("#btnEntrar") || document.querySelector("input[value='Entrar']");
  if (btnEntrar) {
    setTimeout(function() { btnEntrar.click(); }, 1000);
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
      clickBtn("#btnEnviar");
      clickBtn("#btnAceptar");
      clickBtn("input[type='submit']");
    }, 1500);
    return;
  }

  // PASO 5: Pulsar "Solicitar Cita"
  var btnSol = document.querySelector("#btnEnviar") || document.querySelector("#btnSolicitar") || document.querySelector("input[value='Solicitar Cita']");
  if (btnSol && body.indexOf("Solicitar Cita") !== -1) {
    setTimeout(function() { btnSol.click(); }, 1200);
    return;
  }

  // PASO 6: Si no hay citas disponibles -> Esperar 10 MINUTOS y reintentar
  if (body.indexOf("En este momento no hay citas disponibles") !== -1 || body.indexOf("No hay citas disponibles") !== -1) {
    console.log("Sin citas disponibles. Proxima busqueda en " + RETRY_MINUTES + " minutos.");
    setTimeout(function() {
      window.location.href = "https://icp.administracionelectronica.gob.es/icpplustieb/index.html";
    }, RETRY_SEC * 1000); // 600.000 ms = 10 minutos
    return;
  }

  // PASO 7: ¡Cita Encontrada!
  if (body.indexOf("Teléfono") !== -1 || document.querySelector("#txtTelefonoCitado") || body.indexOf("Seleccione la cita") !== -1) {
    document.body.style.backgroundColor = "#86efac";
    alert("¡¡¡ATENCIÓN AMINA: HAY CITA DISPONIBLE EN BARCELONA!!!");
  }
}

setTimeout(run, 800);
