# TrackDraft — Electron shell

The desktop wrapper around `apps/trackdraft/dist`. It exists to do the things a
browser tab cannot: serve the app from its own protocol (so no dev server, no
`localhost:5173`), answer Chromium's permission prompts, and reach the
filesystem through a native dialog.

## Run it

```bash
cd apps/trackdraft
npm run build        # dist/ must exist
npm run electron     # builds, then launches
```

Against the dev server instead (HMR, dev-only import endpoints available):

```bash
npm run dev          # in one terminal (port 5183)
npm run electron:dev # in another
```

Node ≥ 24 is required by the repo's `engine-strict` (`.npmrc`); Electron is
declared as a devDependency of this workspace.

## Verifying it without clicking

```bash
TRACKDRAFT_SMOKE=1 npx electron .   # boots, asserts, prints one JSON line, quits
```

It checks what only exists under Electron: the `app://localhost/` origin, the
preload bridge surface, that the app rendered, and that an **ungranted** read
(`/etc/passwd`) is refused. Renderer console errors are collected too.

It then drives the app the way a person does — clicks a row in the song table —
and asserts the song route lands on the workbench with both surfaces (`Section`,
`Arrangement`), that the arrangement surface actually renders, and that the Sync
facet is on the rail. These are the things the Studio phase-out could have
silently broken.

Run it against the **packaged** bundle as well; two things differ there (the
`dist/` it serves, and whether `media.cjs` got staged):

```bash
TRACKDRAFT_SMOKE=1 "release/TrackDraft-darwin-x64/TrackDraft.app/Contents/MacOS/TrackDraft"
```

Quit any running instance first — `requestSingleInstanceLock()` makes a second
launch exit silently, which reads exactly like a crash.

## What it adds

| Concern | Implementation |
|---|---|
| App transport | `app://localhost/` custom protocol serving `dist/`, SPA fallback, path-traversal guard |
| Content Security Policy | Set on every protocol response (`main.cjs` → `CSP`) |
| Web MIDI | `setPermissionRequestHandler` / `setPermissionCheckHandler` allow `midi` + `midiSysex` |
| Popout window | `setWindowOpenHandler` allows the `/popout` route as a real second window; other links go to the OS browser |
| Navigation | `will-navigate` refuses anything outside the app origin |
| Renderer isolation | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| Node access | Only through the preload bridge; main refuses reads outside paths the user picked this session |
| File import | `File → Import Song…` (⌘/Ctrl+O) or the dashboard's **Import file…** button |
| Song library | `userData/songs/*.trackdraft.json`, seeded once from `dist/catalog` |

## Why `app://localhost` and not `file://`

- `file://` has no origin, so `localStorage`, `BroadcastChannel` (the popout) and
  module workers all behave differently or break.
- The renderer derives the osc-bridge address from `window.location.hostname`
  (`src/lib/bridgeHost.ts`). The host must stay `localhost` or the app will try
  to reach `ws://trackdraft:8081`.
- Absolute asset paths (`/assets/…`) work unchanged, so `vite.config.ts` keeps
  `base: "/"` and the dev server, LAN/iPad mode, and this shell all agree.

## The preload surface

Deliberately five reads and two pickers — no arbitrary path access:

```ts
window.trackdraft = {
  isElectron: true,
  appInfo(), pickFiles(opts?), pickDirectory(),
  readText(path), readBytes(path), readAlsXml(path), listDirectory(path),
  libraryLoad(), libraryWrite(song), libraryDelete(id), libraryInfo(),
  youtubeMeta(videoId), analyzeAudio(bytes), youtubeFullImport(videoId, onProgress),
  onMenuImport(fn),
}
```

Reads are refused outside what the user granted this session (`assertGranted`
in `main.cjs`), which is why a typed path can't work in the desktop app — the
native picker is what creates the grant.

`readAlsXml` exists because `.als` is gzipped and `zlib` is a Node builtin. The
main process decompresses; the renderer keeps the XML walk it already had. That
is also why `.als` import never worked in the browser.

## The song library is a directory, not localStorage

localStorage caps out near 5 MB — about 85 songs — and the Beatles catalogue
alone is 10.9 MB across 182 files. So in the desktop build the library IS
`userData/songs/`, one `<songId>.trackdraft.json` per song:

- `host:library-load` reads the directory and, **on first run only**, seeds it
  from the bundled pack in `dist/catalog` (never overwriting an existing library).
- Saves write only the songs that changed (identity comparison against the last
  synced snapshot), written tmp-then-rename so a crash can't truncate a song.
- The renderer keeps its existing in-memory shape; only `songStore` and
  `storage.ts` know the difference. A browser still uses localStorage.

## Test builds with a real catalogue

```bash
npm run electron:test-build   # build → pack the Beatles corpus → bundle into dist/catalog
npm run electron:test         # the above, then launch
```

The pack is the `internal` profile: stamped `DO-NOT-DISTRIBUTE.txt`,
`"distribution": "internal-test-only"` in its manifest, and it lands in a
separate output directory. The main process reports that stamp back through
`libraryInfo()` so the app can tell you what kind of build it is.

`--source beatles` in that script narrows the pack to one corpus; drop it to
pack the whole 953-song library.

`npm run electron` (no `:test`) builds without bundling any songs.

## Audio analysis & YouTube import

`electron/media.cjs` does this in the main process, so the packaged app has the
same import tools as the dev server:

| IPC | Job |
|---|---|
| `media:youtube-meta` | oEmbed title + channel (no API key) |
| `media:chordmini-analyze` | POST raw audio bytes to ChordMiniApp |
| `media:youtube-full-import` | metadata → yt-dlp → ffmpeg → ChordMiniApp → LRCLIB, streaming `media:progress` events |

The renderer never sees a child process; it calls `host.youtubeMeta`,
`host.analyzeAudio` or `host.youtubeFullImport(videoId, onProgress)`. In the
browser those same call sites fall back to the Vite endpoints, so dev hasn't
changed.

Three external dependencies, each failing with a sentence rather than a 404:

| Dependency | Needed for | Install |
|---|---|---|
| `yt-dlp` | downloading the audio | `brew install yt-dlp` |
| `ffmpeg` | m4a → wav for ChordMiniApp (falls back to raw m4a) | `brew install ffmpeg` |
| ChordMiniApp server | the actual chord/beat analysis | run it, defaults to `localhost:5000` |

None are bundled — they're user-installed tools, and `CHORDMINI_URL` overrides
the analysis endpoint.

**Still dev-server-only:** the corpus browser (`/__catalog/*`) and the Puck
sandbox save endpoint. The directory browser itself now works in the app —
`listDirectory` lists folders the user granted through the native picker.

## Packaging a .app

```bash
npm run electron:test-build   # or: npm run build
npm run package:mac           # → release/TrackDraft-darwin-x64/TrackDraft.app
npm run package:mac:arm64     # Apple Silicon
open "release/TrackDraft-darwin-x64/TrackDraft.app"
```

### Icon

```bash
npm run icon      # build/icon.png + build/icon.icns, drawn by scripts/make-icon.cjs
```

The mark is SVG rasterised by the Electron we already depend on, so there's no
design-tool dependency and no binary art to lose. `package:mac` picks up
`build/icon.icns` automatically when it exists.

### Fonts are bundled, not fetched

`src/theme/fonts.css` carries the four families (IBM Plex Mono, Courier Prime,
Reenie Beanie, Permanent Marker) as 112 KB of local woff2. The renderer makes no
third-party request, the studio-log theme renders the same offline, and the CSP
no longer names any font host. Regeneration notes are in the file header; all
four are SIL OFL 1.1.

`scripts/package-mac.mjs` stages `electron/*` + `dist/` into `build/electron-stage`
and runs `@electron/packager`. No `node_modules` goes into the bundle — the
renderer is a Vite bundle and main requires only `electron` and Node builtins —
so the workspace's symlinked packages and 437 MB of dev dependencies stay out.
Result: a **254 MB** `.app` (≈200 MB of that is the Electron framework), payload
in `Contents/Resources/app.asar` (16 MB).

### Gatekeeper, and what a test build can get away with

`spctl` rejects the bundle (`source=no usable signature`). That is about
*other* machines, not this one:

| Where it runs | What happens | What to do |
|---|---|---|
| Built and opened on this Mac | **Nothing.** Locally produced files carry no `com.apple.quarantine` attribute, so Gatekeeper never inspects them | — |
| Copied to another Mac (AirDrop, zip, USB, download) | The copy IS quarantined → "cannot be opened because the developer cannot be verified" | Right-click → Open, or clear the flag: `xattr -dr com.apple.quarantine /Applications/TrackDraft.app` |
| Another **Apple Silicon** Mac | An *unsigned* arm64 bundle will not launch at all — macOS requires a signature on arm64 | The packaging step ad-hoc signs by default, so a copy works once quarantine is cleared |

The packaging step runs `codesign --force --deep --sign -` (ad-hoc) and reports
it. That is free and needs no certificate, and it is not cosmetic: it is the
difference between an arm64 build that launches and one that does not. `--no-sign`
opts out.

Ad-hoc signing is **not** notarisation — Gatekeeper on a stranger's machine still
refuses it. `spctl --master-disable` (or "Allow Anyway" in Privacy & Security)
does turn it off system-wide; it also weakens every other app on the machine, so
don't leave it set.

**Not done, and needed before anyone else runs it:**

- **Developer ID signing + notarisation** — the only way to hand the app over
  without the dance above. Needs a certificate and `notarytool`.
- **An icon.** It currently shows the default Electron icon. Drop an
  `icon.icns` in and pass `--icon`.
- Intel only by default (this machine is x86_64). `--arch arm64` or
  `--arch universal` covers the rest; universal roughly doubles the framework.
- No DMG, no auto-update.

The release pipeline must also run `catalog:pack:starter` (not the internal
profile) and assert that no `DO-NOT-DISTRIBUTE.txt` reaches the bundle.
