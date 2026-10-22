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
| `@platform/osc-bridge` | Thin wrapper over the already-installed AbletonOSC remote script, for realtime control Extensions can't do. **Implemented and running**: `bridge.ts` relays Ableton transport/beat state to WebSocket clients; `telemetry.ts` serves M4L telemetry + the blueprint command queue over REST; `cli.ts` wires both together. |
| `@platform/cli` | `create extension` / `create device` scaffolding. |

## Why AbletonOSC, not a new realtime layer

AbletonOSC is already installed and registered (`~/Music/Ableton/User Library/Remote Scripts/AbletonOSC`). Extensions are explicitly not for realtime audio/control (per the SDK's own docs) — AbletonOSC already covers that gap. `osc-bridge` wraps it; it does not reimplement it.

## The browser → Live command path

Browser actions ("set tempo", "apply this blueprint", "send to Ableton")
travel through a **directory of JSON files** that both the bridge and the
extension can reach:

```
TrackDraft app ──POST /api/command──▶ osc-bridge ──writes──▶ <queue>/*.json ──▶ extension ──▶ Live
```

The folder, rather than a socket, is historical: extensions had no network
globals, so a shared directory was the only channel. That is why the
extension used to learn about commands by scanning it every 2 s — a browser
action could sit for up to two seconds before Live did anything.

**Live 12.4.15b5** changed that: extensions now get `fetch`, `AbortSignal`,
`Headers`, `Request`, `Response`, `FormData` and `performance` (see
`extensions/trackdraft-bridge/src/commandTransport.ts`, whose
`describeRuntime()` reports which of them the running host actually has).
So the extension can long-poll instead:

| Transport | Needs | Latency |
|---|---|---|
| `GET /api/command/next?wait=…` (long-poll) | Live ≥ 12.4.15b5 | **~9 ms** (measured) |
| Directory scan every 2 s | any Live | 0–2000 ms |

Both remain, and the choice is automatic: the fast path is used when the
globals are present, and the scan takes over when they are not, when the
bridge is unreachable, or when the route 404s (an older bridge). The fast
path is re-probed every 30 s so a bridge started after Live is picked up
without a relaunch.

**Exactly-once** is the invariant that makes running both safe. A consumer
"claims" a command by **renaming** the file out of the queue — atomic on one
filesystem — so a still-running old extension, a new long-polling one, and
even two Live instances can all look at the same queue without any command
executing twice. Verified by racing the two paths over 20 commands in each
order: zero double executions.

The queue stays on disk on purpose: a command survives a bridge restart, and
the file scan keeps working if the bridge dies mid-session.

## MIDI import: classify the tracks, then use each for what it is

MIDI import used to treat every note as evidence of harmony — it stacked all
tracks together and ran chord detection on the result. That is right for a
full arrangement and wrong for the corpora we import most: **BiMMuDa and
CoCoPops are monophonic melody annotations**, so a single melodic line was
"detected" as chords that were never written (`D#aug, C#…` for Dancing
Queen, which has neither), while the melody itself was dropped — the importer
never populated `melody` at all.

`lib/parsers/midiTracks.ts` classifies first:

| Signal | Role |
|---|---|
| channel 9 | `drums` (GM percussion) |
| ≥ 20 % of onsets sound more than one note | `harmony` |
| monophonic, mean pitch < 52 | `bass` |
| monophonic | `melody` |

Then each track is used for what it is: harmony feeds chord detection (and
nothing else does — a melody-only file keeps an **empty** progression rather
than a fabricated one), the melody track becomes a `MelodyTrack`, and a
percussion track becomes one `steps` `DrumBlock` per lane, which stores the
notes verbatim rather than guessing a groove.

Sections: one **honest** section spanning the file's real bar count. Structure
is not recoverable from a monophonic line, and the old "every 12 bars is a
section" carving invented section names A, B, C… A single `Full Song` section
says what is actually known, and the import's `provenance.warnings` spell out
what was found, what was skipped, and why.

Verified through the UI on the real corpora (ABBA – Dancing Queen, 76 bars):
0 fabricated chords, 301 melody notes imported (A4–C#5). BiMMuDa resolves the
same way. Both corpora are registered as **browse-only** dashboard
directories, each probed once against the dev server so a machine without the
datasets never sees a broken entry.
