import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import * as serviceWorkerRegistration from "./serviceWorkerRegistration";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Habilita "instalar como app" (PWA) — no cachea datos del negocio, solo
// cumple el requisito técnico del navegador. Ver InstalarApp.js para el
// tutorial que ofrece el botón de instalación al cliente.
serviceWorkerRegistration.register();
