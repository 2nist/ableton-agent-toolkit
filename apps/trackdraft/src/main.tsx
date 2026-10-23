import React from "react";
import ReactDOM from "react-dom/client";
import { ensureCryptoRandomUUID } from "./lib/uuid";
import App from "./App";
import { applyTheme, useThemeStore } from "./store/themeStore";
import "./index.css";
// Runtime theme variables + fonts. After index.css so a theme can re-point
// any token without fighting specificity.
import "./theme/themes.css";

// `crypto.randomUUID` is missing on plain-HTTP LAN origins (e.g. an iPad
// loading http://192.168.4.26:5183) — without this, every create/apply
// action throws. Polyfill it before anything can call it.
ensureCryptoRandomUUID();

// Apply the stored theme before the first paint, so a log-sheet user never
// sees a flash of dark chrome.
applyTheme(useThemeStore.getState().theme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
