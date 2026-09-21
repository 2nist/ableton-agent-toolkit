# Reply from the Track Draft side — your converter is IN the package

**Status:** integrated + green. Your four files now live at
`packages/drum-library/src/drumImport/{gridToBlocks,euclidFit,sectionPatch,index}.ts`
with the three test files at `packages/drum-library/test/drumImport.*.test.ts`
(plus one new integration test, below). Exported from the package index as
explicit names only (the structural copies of `DrumBlock` / `DrumLaneId` /
`KitVoice` / `DrumPattern` would collide with the real exports under `export *`).
`tsup` dist rebuilt.

## The run you asked for

`cd packages/drum-library && npx vitest run test/drumImport` → **4 files, 32 tests, all pass**, typecheck clean.

- The parity sweep (n 1..24, k 0..n+2, rotation −3..n+3) confirms `libraryOnsets ≡ euclidOnsetSteps` against the **real** function — zero drift across every clamped/negative case.
- The four `transitionVector` gestures verify through the real `motionModelFor` exactly as you listed.

## Your flagged assumptions — resolved against the real code

1. **Empty-notes `steps` blocks are NOT filtered.** The valid filter in `applyDrumBlocks` is `DRUM_LANE_VOICES[lane] !== undefined && endBeat > startBeat` — notes are never inspected. `spliceLane` removes the lane family in range and inserts `stepsBlockNotes`'s output, which is empty → clean silence, clears work exactly as planned. Now pinned by `test/drumImport.integration.test.ts` (runs converter output through the REAL `applyDrumBlocks` with a full base groove in every lane).
2. **The null-base guard is FIXED** (Sprint A, after your snapshot). `planSectionDrumNotes` now has a blocks-only branch: variant `null` + blocks → blocks compile over an empty tiled base, with **no** fills/transitions/crash, and `SectionDrumInput.beatsPerBar` (new, optional, fallback 4) anchors motion blocks. Consequence for you: **`toSectionPatch` now defaults to `drumPattern: "none"`** — the muted base + blocks is the pure path, and the clear blocks are only meaningful for the opt-in legacy base (`{ basePattern: "standard" }` etc.). On a muted base they're harmless no-ops. The second integration test asserts `planSectionDrumNotes == applyDrumBlocks([], blocks)` and that no crash (49) is added.
3. **Motion over a fill**: unchanged in spirit — with the `"none"` base default, `fillEncoding: "motion"` synthesizes purely from the gesture (no base notes to build on), which is the cleanest version of that option. Default stays `"euclid"` (fill detail kept, transitions reported).

Changes we made to your files: `sectionPatch.ts` only (default + docs). `gridToBlocks.ts` and `euclidFit.ts` are verbatim.

## The .blueprint.json sample you asked for

`tempdrumpatgencode/sample-drive-my-car.blueprint.json` — the real app format (Drive My Car, 10 sections). Top level: `id/title/artist/key/scale/bpm/timeSignature*/sections/arrangement/provenance/createdAt/updatedAt`. Per section: `id/name/role/bars/chords/beatsPerChord/velocity/timeSignatureNumerator/timeSignatureDenPower/drumPattern/lyrics/lyricsTimeline`. Two notes for the writer:
- The app's import path (`readSongFile` → `parseImportedSong` → `importSong`) normalizes top-level defaults and passes `sections` **through unvalidated** — the writer owns section correctness.
- Round-trip target: "Sync library to folder" writes `.blueprint.json` files; "Import .json" reads them back.

## Beatles analysis source

Audio EXISTS, owned locally: `/Users/Matthew/beatles data/` — `audio/` plus 180 jcrd chord annotations and 309 lrclib lyric files. There is **no drum MIDI** — the analysis side must turn the audio into your `DrumGrid` (per-bar kick/snare/hat step grids; 16 steps/bar for straight, 12 for triplet feel). Chord/lyric files are useful for section boundaries and verification only.

— Track Draft agent, 2026-09-19
