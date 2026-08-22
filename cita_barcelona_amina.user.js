// ==UserScript==
// @name Bot Cita Barcelona
// @match *://icp.administracionelectronica.gob.es/*
// @grant none
// ==UserScript==

var NOMBRE = "AMINA CHAIR", NIE = "Y2086361E", NACIONALIDAD = "MARRUECOS";

function clickBtn(sel) {
  var b = document.querySelector(sel);
  if (b) b.click();
}

function run() {
  var txt = document.body ? document.body.innerText : "";

  if (txt.indexOf("0301") !== -1 || txt.indexOf("Se ha producido un error") !== -1) {
    setTimeout(function() { window.location.href = "https://icp.administracionelectronica.gob.es/icpplustieb/index.html"; }, 2000);
    return;
  }

  var sel = document.querySelectorAll("select");
  if (sel.length > 0 && (txt.indexOf("PROVINCIAS") !== -1 || txt.indexOf("Selecciona Provincia") !== -1)) {
    for (var i = 0; i < sel[0].options.length; i++) {
      if (sel[0].options[i].text.toUpperCase().indexOf("BARCELONA") !== -1 || sel[0].options[i].value === "8") {
        sel[0].value = sel[0].options[i].value;
        sel[0].dispatchEvent(new Event("change", { bubbles: true }));
        setTimeout(function() { clickBtn("#btnAceptar"); clickBtn("input[value='Aceptar']"); }, 1000);
        return;
      }
    }
  }

  if (sel.length > 0 && txt.indexOf("TRÁMITES") !== -1) {
    if (sel[0].options.length > 1) {
      sel[0].selectedIndex = 1;
      sel[0].dispatchEvent(new Event("change", { bubbles: true }));
      setTimeout(function() { clickBtn("#btnAceptar"); clickBtn("input[value='Aceptar']"); }, 1000);
      return;
    }
  }

  if (document.querySelector("#btnEntrar")) {
    setTimeout(function() { clickBtn("#btnEntrar"); }, 800);
    return;
  }

  var inNie = document.querySelector("#txtIdCitado"), inNom = document.querySelector("#txtDesCitado");
  if (inNie && inNom) {
    var rNie = document.querySelector("#rdbTipoDocNie") || document.querySelector("input[value='NIE']");
    if (rNie) rNie.checked = true;

    inNie.value = NIE;
    inNie.dispatchEvent(new Event("input", { bubbles: true }));

    inNom.value = NOMBRE;
    inNom.dispatchEvent(new Event("input", { bubbles: true }));

    var selP = document.querySelector("#txtPaisNac") || document.querySelector("#idPais");
    if (selP) {
      for (var p = 0; p < selP.options.length; p++) {
        if (selP.options[p].text.toUpperCase().indexOf("MARRUECOS") !== -1 || selP.options[p].value === "248") {
          selP.value = selP.options[p].value;
          selP.dispatchEvent(new Event("change", { bubbles: true }));
          break;
        }
      }
    }

    setTimeout(function() { clickBtn("#btnEnviar"); clickBtn("#btnAceptar"); }, 1200);
    return;
  }

  if (txt.indexOf("Solicitar Cita") !== -1) {
    setTimeout(function() { clickBtn("#btnEnviar"); clickBtn("#btnSolicitar"); }, 1000);
    return;
  }

  if (txt.indexOf("no hay citas disponibles") !== -1) {
    setTimeout(function() { window.location.href = "https://icp.administracionelectronica.gob.es/icpplustieb/index.html"; }, 12000);
    return;
  }

  if (txt.indexOf("Teléfono") !== -1 || document.querySelector("#txtTelefonoCitado")) {
    document.body.style.backgroundColor = "#86efac";
    alert("ATENCION AMINA: CITA DISPONIBLE EN BARCELONA!");
  }
}

setTimeout(run, 800);
