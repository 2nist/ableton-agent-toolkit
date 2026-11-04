# Working in this repository

Read this before changing code. It is the short version of what the history
already knows; the long version is the commit log, and each message states the
problem, the decision and what was verified.

## What this repo is

A toolkit for Ableton Live — Extensions (TypeScript), Max for Live devices, a
shared music-theory backend — plus **TrackDraft**, a songwriting app and a
native JUCE MIDI-generator plug-in that share one harmony model.

```
apps/trackdraft          Electron + Vite + React app (songs, sections, MIDI export)
packages/music-theory    chord/scale tables, voiceChord, planChordNotes, recognition
packages/song-blueprint  BlueprintSong / BlueprintSection / Chord schema
packages/drum-library    Euclidean rhythms, bass planner, drum engine
plugins/trackdraft       JUCE 8 plug-in: VST3, AU (aumi), Standalone. ~8.4k lines C++
extensions/, devices/    Ableton Extensions and Max for Live devices
```

`docs/` and each package's README carry the detail. **`plugins/trackdraft/README.md`
is the plug-in's manual and its best design document** — read it in full before
touching the plug-in.

## Toolchain

- **Node 24** (`.nvmrc`). The pre-push hook refuses anything else.
- **CMake ≥ 3.22** and a C++20 toolchain for the plug-in. JUCE 8.0.15 is fetched
  by CMake; nothing large is committed. `-DJUCE_PATH=/path/to/JUCE` uses a local
  checkout instead.
- macOS builds VST3 + AU + Standalone. **Linux and Windows build VST3 only** —
  `aumi` is an Apple MIDI-processor type, so an AU cannot exist off macOS.

## Commands

```bash
npm ci                          # once, at the root; workspaces link from here
npm run lint                    # baseline: 0 errors, 40 pre-existing warnings
npm run verify                  # typecheck + test across every workspace
npm run plugin:build            # configure + build all three formats
npm run plugin:test             # build TrackDraftTests and run it
```

App checks, from `apps/trackdraft`:

```bash
../../node_modules/.bin/tsc --noEmit
../../node_modules/.bin/vitest run            # whole suite; one file: vitest run <path>
../../node_modules/.bin/vite build
```

**After editing anything in `packages/*`, rebuild that package** or the app will
typecheck against a stale `dist/` — imports resolve there, not to `src/`:

```bash
cd packages/music-theory && ../../node_modules/.bin/tsup
```

Baselines to compare against: **665** plug-in checks, **2358** app tests, **46**
music-theory tests, lint 0 errors.

## Invariants — breaking one of these is a bug

1. **One writer.** Nothing but `ProgressionXml` serialises a progression or a
   song. Presets, song files and session state all go through it.
2. **Defaults are silent.** Root position, close spread, no rhythm grid, no bass
   voice, no region, no section key, plain 4/4 → **no attribute or element**. A
   file written before a feature existed must round-trip byte-identically.
3. **Pin the format from both sides against one string.** `TrackDraftTests` has
   `--dump-xml`, `--dump-song-xml`, `--dump-meter-xml` and `--dump-names`; the
   app's `tdpPreset.test.ts` pastes those exact bytes. A golden each side
   generates for itself proves nothing.
4. **Table order is tie-break order.** New chord qualities go at the **end** of
   `CHORD_INTERVALS` / the C++ `qualities()` table, or you silently change what
   an existing shape is called.
5. **Two octave conventions, on purpose.** Chords use `(octave + 1) * 12`
   (octave 4 = middle C, 60). The bass voice uses the app's `octave * 12`
   (octave 3 = MIDI 36). A bass written with the chord formula lands where the
   chord already is.
6. **Bounds are explicit.** 8 slots per section, 16 sections, 32 passes, 1–8
   repeats, at least one section and one pass.
7. **Levels scale the Velocity knob**: accent = 100%, normal 80%, ghost 55%. The
   app (`gridVelocity`) and the plug-in (`levelVelocity`) must stay equal.
8. **A rhythm grid's digit count is its bar.** 16 digits = 4/4, 12 = 3/4. That is
   how a grid carries its meter with no second attribute.

## Audio thread

`processBlock` takes **no lock**. The flattened cycle lives in
`Source/CycleBuffers.h`, where a buffer has exactly one owner: the message thread
builds an unowned one and publishes it, the callback takes it. A cycle is only
ever published whole. Keep it that way — a lock here stalls the callback.

## Commits

- Subjects: `area: lowercase sentence` — e.g.
  `rhythm: seed the grid from the drum engine's Euclidean rule`. **Not**
  Conventional Commits.
- Explain the problem, the decision, what you verified, and what you did **not**
  verify. Several numbers in this repo came from measurement; do not restate them
  as estimates.
- End with
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Reporting

- **Only claim checks you actually ran.** Distinguish measured facts from
  inference from unknowns.
- When a test fails, decide whether the code or your expectation is wrong. In this
  codebase it has often been the expectation (bass octave, walk cycle length,
  Euclidean rotation, cycle slot indexing, meter bar arithmetic).
- If a measurement contradicts the plan, follow the measurement and record it.

## Known gaps

- `.github/workflows/verify.yml` is Node-only: it **never builds the plug-in**,
  and GitHub Actions was blocked account-side (every run ended `startup_failure`).
  Local `npm run plugin:build` + `npm run plugin:test` is the real gate.
- The root `README.md` Layout section predates `plugins/trackdraft`,
  `packages/song-blueprint` and `packages/drum-library`.
- Plug-in presets are read from `juce::File::userApplicationDataDirectory`, which
  on macOS is `~/Library` — so the folder is `~/Library/TrackDraft/Presets`, not
  the `~/Library/Application Support/...` the README and the app's preset writer
  assume. Unfixed as of this writing.
- A packaged build ships `scripts/output/catalog-internal`, which is packed from
  `scripts/output/catalog.manifest.json` — a gitignored snapshot of the last
  ingest run. `electron:test-build` never re-ingests, so a build can silently
  ship songs generated before the planner changes. `catalog:pack:starter` now
  warns past 24 h; before shipping, run `npm run catalog:ingest:beatles` then
  `npm run catalog:manifest`.
- The desktop app seeds the bundled catalogue only into an **empty** library and
  never overwrites (`seedLibraryIfEmpty`). A machine that has run an older build
  keeps that build's song data — the bundle's newer catalogue is ignored.
