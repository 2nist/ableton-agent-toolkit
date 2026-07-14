# @platform/ui-kit (Phase 2+ — headless parts only until a real consumer needs a component)

`src/bridge.ts` is built first: host detection (`window.max` / `window.webkit.messageHandlers.live` / `window.chrome.webview`) plus a normalized `send`/`onMessage` API. See `docs/architecture.md` for the confirmed bridge asymmetry between hosts before adding any "reactive/continuous" component — those only work under `m4l-jweb`.

No component library is built speculatively — components land here only when `extensions/chord-assistant` (Phase 3) or the first device (Phase 5) actually need one.
