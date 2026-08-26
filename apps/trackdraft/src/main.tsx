import React from "react";
import ReactDOM from "react-dom/client";
import { ensureCryptoRandomUUID } from "./lib/uuid";
import App from "./App";
import "./index.css";

// `crypto.randomUUID` is missing on plain-HTTP LAN origins (e.g. an iPad
// loading http://192.168.4.26:5183) — without this, every create/apply
// action throws. Polyfill it before anything can call it.
ensureCryptoRandomUUID();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
