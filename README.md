# ableton-agent-toolkit

Agentic tooling for Ableton Live 12: Extensions SDK tools and Max for Live devices sharing one music-theory backend and one HTML/CSS/JS UI kit. Private, personal, built to be genuinely reusable.

See `docs/architecture.md` for the design and `docs/m4l-scaffolding-risk.md` before touching anything under `templates/m4l-device-basic`.

## Status

86 tests passing repo-wide (`npm run test`).

- [x] **Phase 0** — repo scaffold, `extensions/hello-world` dev-loop validation
- [x] **Phase 1** — `packages/test-harness`: fakes only `initializeExtensionHost`, real SDK does the rest
- [x] **Phase 2** — `@music-theory/core` + `@music-theory/song-structure` ported verbatim (with baseline tests — none existed upstream), `ui-kit` bridge + design tokens
- [x] **Phase 3** — `extensions/chord-assistant`: right-click a MIDI Arrangement selection → inserts a chord progression as one MIDI clip per lane. Logically verified; real-Live manual QA still outstanding
- [x] **Phase 4** — `packages/cli`: `create extension` is real and non-interactive (agents can't answer prompts), end-to-end verified — built a throwaway extension, installed it, built it, deleted it
- [x] **Phase 5** — `create device`: hand-authored `reference.amxd` in Live, reverse-engineered the (undocumented) `.amxd` binary format byte-by-byte to patch it programmatically, verified end-to-end (scaffolded a throwaway device, independently re-parsed the output with a fresh Python script). One thing still needs a real Live session: confirming Max's own parser accepts JS's re-serialized JSON formatting — see `docs/m4l-scaffolding-risk.md`
- [ ] **Phase 6+** — `osc-bridge`, on-demand `ui-kit` components, master-Set consolidation tooling

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

Open `devices/<name>/<name>.amxd` in Live's Max for Live device browser. Edit `devices/<name>/ui/interface.html` for the webview UI — no build step, `jweb` loads it straight off disk. See `docs/m4l-scaffolding-risk.md` for the `.amxd` format and the one manual verification step still outstanding.

## Layout

```
packages/     shared libraries (music-theory, song-structure, ui-kit, test-harness, osc-bridge, cli)
templates/    scaffolds the cli copies from (extension-basic, m4l-device-basic)
extensions/   Ableton Extensions (Node.js/TypeScript, @ableton-extensions/sdk)
devices/      Max for Live devices
vendor/       vendored beta SDK/CLI tarballs (not on public npm)
```
