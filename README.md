# ableton-agent-toolkit

Agentic tooling for Ableton Live 12: Extensions SDK tools and Max for Live devices sharing one music-theory backend and one HTML/CSS/JS UI kit. Private, personal, built to be genuinely reusable.

See `docs/architecture.md` for the design, `docs/design/workspace.md` for the current TrackDraft workspace direction, and `docs/m4l-scaffolding-risk.md` before touching anything under `templates/m4l-device-basic`.

## Status

~1,600 tests passing repo-wide (`npm run verify` = typecheck + tests), 0 type errors across all workspaces, and a CI `verify` workflow runs lint + typecheck + tests on every push.

Node **24** is required (`engines` + `.npmrc` enforce it; `.nvmrc` pins 24.18.0). `npm run lint` is the ESLint gate.

## Fresh machine (start here)

```bash
nvm use                        # Node 24 per .nvmrc — install it first if nvm says "not installed"
npm ci                         # at the repo root; the workspaces link from here
npm run dev --workspace=trackdraft
```

`npm run dev --workspace=trackdraft` serves the app at <http://localhost:5183>.
For the full experience (Ableton transport sync + Send to Ableton), use the launcher instead — it also starts `osc-bridge` and opens the browser:

```bash
bash apps/trackdraft/start-all.sh
```

`npm run build` builds every workspace; `npm run build --workspace=trackdraft` builds just the app. `npm run verify` is the typecheck + test gate (also run by the pre-push hook).

### Checking MIDI out on a new machine

Live MIDI out needs **desktop Chrome** (Web MIDI isn't exposed in Safari or Firefox) and a virtual MIDI bus — on macOS: Audio MIDI Setup → IAC Driver → tick *Device is online*. Then in TrackDraft: **Settings → MIDI & sync** → pick the bus → **Run loopback**.

A returned probe ("✓ returned from IAC Driver Bus 1 in Nms") means the OS route works, so any remaining silence is the *DAW's* MIDI input or channel filter — not TrackDraft. A timeout means the bus isn't online.

In any DAW, give each stem its own track pointed at that port on the stem's channel (the panel shows both the channel and the instrument it expects). **Export MIDI** writes the same routing plus General MIDI program changes and instrument names, so a GM-compatible DAW assigns the sounds on import; drums go to channel 10 there, where GM expects percussion.

- [x] **Phase 0** — repo scaffold, `extensions/hello-world` dev-loop validation
- [x] **Phase 1** — `packages/test-harness`: fakes only `initializeExtensionHost`, real SDK does the rest
- [x] **Phase 2** — `@music-theory/core` + `@music-theory/song-structure` ported verbatim (with baseline tests — none existed upstream), `ui-kit` bridge + design tokens
- [x] **Phase 3** — `extensions/chord-assistant`: right-click a MIDI Arrangement selection → inserts a chord progression as one MIDI clip per lane. Logically verified; real-Live manual QA still outstanding
- [x] **Phase 4** — `packages/cli`: `create extension` is real and non-interactive (agents can't answer prompts), end-to-end verified — built a throwaway extension, installed it, built it, deleted it
- [x] **Phase 5** — `create device`: hand-authored `reference.amxd` in Live, reverse-engineered the (undocumented) `.amxd` binary format byte-by-byte to patch it programmatically. Fully verified end-to-end in real Live, including a genuine gotcha found along the way — `jweb` silently drops custom JS→Max messages without an undocumented `nonstandardoutletcalls 1` attribute, which doesn't survive a save and has to be re-asserted via `loadbang` on every load. See `docs/m4l-scaffolding-risk.md`
- [x] **Phase 6** — `osc-bridge` is implemented and running: relays Ableton transport/beat state over WebSocket (`ws://127.0.0.1:8081`) and serves M4L telemetry + the blueprint command queue over REST (`http://localhost:5200`). See `packages/osc-bridge`.
- [ ] **Phase 7+** — on-demand `ui-kit` components, master-Set consolidation tooling

**Current work (2026-09)** is the TrackDraft workspace overhaul: one shell (spine · views rail · canvas · inspector) across every song route, in-place section editing, and the lyrics/karaoke pass — see `docs/design/workspace.md` for the frozen direction and what remains (arrangement lanes, melody note editing). The UI standardization plan (`docs/ui-standardization.md`) has landed its first slice: shared primitives and a promise-based confirm dialog, with no native `confirm()` left in the app.

### Apps, extensions, and the flagship
- **`apps/trackdraft`** — the main React songwriting app (structure/harmony/lyrics/drums/melody) built on `@music-theory/*` and `@platform/*`.
- **`extensions/trackdraft-bridge`** — the flagship Ableton Extension: applies a song blueprint to Live as chord/drum/bass/color clips, with a picker/viewer webview and a file-based command queue polled from the extension host.
- **User song library** — lives in `~/TrackDraft/library` (read by `packages/song-mcp`, `osc-bridge`, and the bridge extension). The source/draft songs are kept in `~/Downloads/lalo-chezia`.

## Verification

`npm run lint` and `npm run verify` (typecheck + tests) are the gate. `npm install`
installs a pre-push hook (`.githooks/pre-push`, enabled via `prepare` → `core.hooksPath`)
that runs both and refuses to push on Node < 24; bypass deliberately with
`SKIP_VERIFY=1 git push` or `git push --no-verify`.

The GitHub Actions workflow (`.github/workflows/verify.yml`) runs the same commands,
but is currently blocked by an account/repo-side `startup_failure` — a workflow
containing only `echo ok` fails the same way, so the hook is the enforced gate until
that is resolved.

## Dev loop (Phase 0)

```bash
cd extensions/hello-world
npm install
```

In Ableton Live 12 Beta: Preferences → Extensions → enable **Developer Mode**. Then:

```bash
npm start
```

Edit `src/extension.ts` and re-run `npm start` to hot-reload without relaunching Live. Output and errors land in:

```
~/Library/Preferences/Ableton/Live 12.x Beta/ExtensionHost.txt
```

## Scaffolding a new extension (Phase 4)

```bash
npm run build --workspace=@platform/cli   # once, or after changing packages/cli
npm run cli -- create extension <name> [--ui] [--author "Name"] [--live /path]
cd extensions/<name> && npm install && npm start
```

Non-interactive by design — no prompts to answer, so an agent can run this unattended. Auto-discovers the newest Live install with Extensions support in `/Applications` if `--live` isn't given. See `packages/cli/README.md` for what the platform overlay adds on top of Ableton's own official template.

## Scaffolding a new M4L device (Phase 5)

```bash
npm run build --workspace=@platform/cli
npm run cli -- create device <name>
```

Open `devices/<name>/<name>.amxd` in Live's Max for Live device browser. Edit `devices/<name>/ui/interface.html` for the webview UI — no build step, `jweb` loads it straight off disk. See `docs/m4l-scaffolding-risk.md` for the `.amxd` format and a real gotcha worth knowing before touching the reference patch.

## Layout

```
packages/     shared libraries (music-theory, song-structure, ui-kit, test-harness, osc-bridge, cli)
templates/    scaffolds the cli copies from (extension-basic, m4l-device-basic)
extensions/   Ableton Extensions (Node.js/TypeScript, @ableton-extensions/sdk)
devices/      Max for Live devices
vendor/       vendored beta SDK/CLI tarballs (not on public npm)
```

Parked packages (kept, tested, not imported by any app yet — see each README):
`@daw/routing-matrix`, `@groove/capture`, `@daw/virtual-reaper`,
`@platform/blueprint-store`. Adopt or remove them deliberately; don't treat
them as live surface.

## Local services and network exposure

`osc-bridge` binds loopback (`127.0.0.1:5200` REST, `127.0.0.1:8081` WebSocket)
by default because both channels can drive Live. `bash start-all.sh lan` is the
explicit opt-in that sets `BRIDGE_HOST=0.0.0.0` for iPad/phone control.
