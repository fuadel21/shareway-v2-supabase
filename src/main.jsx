import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import './i18n/rtl.css';
// Responsive polish layers. Keep this order documented in docs/responsive-style-layers.md.
import './styles/mobile-navigation-polish.css';
import './styles/mobile-accessibility-touch-polish.css';
import './styles/responsive-tablet-desktop-polish.css';
import './styles/visual-performance-motion-polish.css';
import './i18n/config';
import App from "./App.jsx";
import RideEmergencyQuickAction from "./components/RideEmergencyQuickAction.jsx";
import RideEmergencyHistoryPanel from "./components/RideEmergencyHistoryPanel.jsx";
import RideBoardingOverlay from "./components/RideBoardingOverlay.jsx";

// Importar estilos de Leaflet globalmente
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';
import 'leaflet-defaulticon-compatibility';

const container = document.getElementById("root");
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <App />
    <RideEmergencyQuickAction />
    <RideEmergencyHistoryPanel />
    <RideBoardingOverlay />
  </React.StrictMode>
);
