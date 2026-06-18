import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import './i18n/rtl.css';
import './i18n/config';
import App from "./App.jsx";

// Importar estilos de Leaflet globalmente
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';
import 'leaflet-defaulticon-compatibility';

const container = document.getElementById("root");
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
