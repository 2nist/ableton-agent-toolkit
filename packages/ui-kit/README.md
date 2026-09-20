# @platform/ui-kit

Shared UI layer for both Ableton Extensions webview modals and M4L `jweb` device UIs — one host-detecting bridge, one design-token system. Components are added on demand as `extensions/chord-assistant` (Phase 3) and the first M4L device (Phase 5) actually need them; there's no speculative component library here yet.

## `bridge.ts` — read this before building any component with interaction

Extensions and M4L `jweb` are NOT symmetric hosts, and pretending otherwise will produce components that silently do nothing under one of them:

| | Extensions modal | M4L `jweb` |
|---|---|---|
| Detected via | `window.webkit.messageHandlers.live` (macOS) / `window.chrome.webview` (Windows) | `window.max` |
| `send()` | **One-shot.** Maps to `{method: "close_and_send", params: [json]}`. First call closes the dialog and resolves the extension's `showModalDialog()` promise. Further calls are dropped (reported via `onProtocolError`). | Unlimited. Maps directly to `window.max.outlet("message", json)`. |
| `onMessage()` | **Never fires.** Extensions modals have no documented push channel into an open dialog. | Live. Wraps `window.max.bindInlet("message", cb)`. |

Both facts are cited from primary sources in `bridge.ts`'s module doc comment — the SDK's own `Ui.showModalDialog` doc comment for Extensions, Cycling '74's shipped `jweb.maxref.xml`/`jweb.maxhelp` for M4L.

**Practical consequence for component design:**

- **Presentational / one-shot** components (a chord picker, a confirm/cancel form) — build these first. They only need `send()` once, at the end. Portable to both hosts unmodified.
- **Reactive / continuous** components (a live level meter, a realtime position readout) — only meaningful under `"m4l-jweb"`. Don't build one of these and expect it to do anything under an Extensions modal; `onMessage` will register but silently never call back.

## `theme/tokens.ts`

A fixed, small set of semantic roles (`background`, `panel`, `text`, `accent`, ...), plus one hue-parameterized `generateFromHue(hue)` function that derives every role via HSL math. `PRESETS` are just fixed hues run through that same generator — not hand-tuned per-role overrides. (The role-set + hue-generator design was originally inspired by a Reaper theming script, but this is a from-scratch TypeScript implementation with Ableton-specific presets — no shared code.)

`ABLETON_DARK` is a separate, fixed (non-generated) palette matching Live's own webview chrome exactly, taken from the SDK's own webview boilerplate — use it when a webview UI should visually blend into Live rather than stand out.
