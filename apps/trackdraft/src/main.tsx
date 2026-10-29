import React from "react";
import ReactDOM from "react-dom/client";
import { ensureCryptoRandomUUID } from "./lib/uuid";
import App from "./App";
import { applyTheme, useThemeStore } from "./store/themeStore";
import { loadTables } from "./lib/dataFiles";
import { isElectronHost } from "./lib/host";
import "./index.css";
// Self-hosted fonts — no CDN request, so the studio-log voices survive offline.
import "./theme/fonts.css";
// Runtime theme variables + fonts. After index.css so a theme can re-point
// any token without fighting specificity.
import "./theme/themes.css";

// `crypto.randomUUID` is missing on plain-HTTP LAN origins (e.g. an iPad
// loading http://192.168.4.26:5183) — without this, every create/apply
// action throws. Polyfill it before anything can call it.
ensureCryptoRandomUUID();

/* Tables (a custom colour flavour, a genre, a transition shape) are loaded from
 * `<library>/tables/*.json` BEFORE the first render — a table applied after
 * paint means the first view is drawn with the shipped values and then silently
 * disagrees with everything computed afterwards. A read of one small folder, so
 * the delay is not perceptible; a failure is not fatal (shipped defaults). */
void loadTables().finally(() => {

/* On macOS the desktop shell uses `titleBarStyle: "hiddenInset"`, which draws
 * the window buttons INSIDE the page — over whatever sits at the top-left.
 * These two numbers are the space the shell must leave for them: ~80px of
 * width for the three buttons, ~18px of height so a vertical stack clears
 * them. Browser builds get 0 and are untouched.
 *
 * Set here (not in a stylesheet) because it's a fact about the host, and
 * because the theme files are being rewritten independently right now. */
if (isElectronHost()) {
  const root = document.documentElement.style;
  root.setProperty("--chrome-inset", "80px");
  root.setProperty("--chrome-inset-top", "18px");
}

  // Apply the stored theme before the first paint, so a log-sheet user never
  // sees a flash of dark chrome.
  applyTheme(useThemeStore.getState().theme);

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
