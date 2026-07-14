# Architecture

## The one fork that matters

Not "Extensions vs. M4L" — **Node execution context vs. browser/webview execution context**.

- **Node context**: an Extension Host process running `extension.ts`. Real Node.js, has `context.*` SDK access (tracks, clips, transactions, commands), no DOM.
- **Browser context**: any UI. An Extensions modal dialog and an M4L `jweb` device page are both plain Chromium/WebKit pages running HTML/CSS/JS. They differ only in how they talk back to their host.

This is why `packages/ui-kit` can share real component code across both hosts, and why only `packages/ui-kit/src/bridge.ts` needs to know which host it's in.

## Verified host bridges

| Host | Detect via | Send | Receive |
|---|---|---|---|
| Extensions (macOS) | `window.webkit?.messageHandlers?.live` | `window.webkit.messageHandlers.live.postMessage(msg)` | none — one-shot only |
| Extensions (Windows) | `window.chrome?.webview` | `window.chrome.webview.postMessage(msg)` | none — one-shot only |
| M4L (`jweb`) | `window.max` | `window.max.outlet(...)` | `window.max.bindInlet(name, cb)` |

The Extensions side only supports a single `{method: "close_and_send", params: [resultString]}` call that closes the dialog and resolves a promise on the extension side — there is no ongoing push channel into an open modal. M4L's bridge is fully continuous and bidirectional. `ui-kit` components are split into two categories accordingly:

- **presentational / one-shot** — safe on both hosts (forms, pickers, confirm/cancel).
- **reactive / continuous** — only meaningful under `m4l-jweb` (live meters, realtime readouts).

## The SDK's real native boundary

Verified directly from the vendored SDK's compiled `dist/index.mjs` / `dist/index.d.mts`:

```ts
interface ActivationContext {
  initializeExtensionHost<V extends ApiVersion>(options: InitializeOptions<V>): EXTENSIONS_API[V];
}
```

`initialize(activation, apiVersion)` destructures `{commands, dataModel, environment, resources, ui}` from that one call and wraps each in a real SDK class (`Commands`, `Ui`, `Environment`, `Resources`, and the `DataModelObjectRegistry` behind `Track`/`Clip`/etc). `packages/test-harness` fakes only this one boundary and hands the fake to the SDK's own real `initialize()` — so mocked tests get real `instanceof MidiTrack` fidelity for free, with no duplicated class logic to keep in sync.

## Packages

| Package | Role |
|---|---|
| `@music-theory/core` | Chord/scale/substitution logic. Zero runtime deps, pure TS — runs unmodified in Node and any browser/webview context. |
| `@music-theory/song-structure` | Arrangement/form analysis, depends on `core`. |
| `@platform/ui-kit` | Shared components + `bridge.ts` host adapter + design tokens. |
| `@platform/test-harness` | Fakes `initializeExtensionHost`, calls the real SDK's `initialize()`. |
| `@platform/osc-bridge` | Thin wrapper over the already-installed AbletonOSC remote script, for realtime control Extensions can't do. Stubbed until there's a real consumer. |
| `@platform/cli` | `create extension` / `create device` scaffolding. |

## Why AbletonOSC, not a new realtime layer

AbletonOSC is already installed and registered (`~/Music/Ableton/User Library/Remote Scripts/AbletonOSC`). Extensions are explicitly not for realtime audio/control (per the SDK's own docs) — AbletonOSC already covers that gap. `osc-bridge` wraps it; it does not reimplement it.
