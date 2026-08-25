# Drum Studio

A pattern/fill picker for Ableton Live, powered by `@drum/library` — sibling
to Progression Studio, same webview-modal shape and Ableton dark-chrome
styling.

Right-click a **MidiTrack** or a **Session clip slot** → **Open Drum
Studio** → one modal opens with:

- **Pattern** — every `DrumPattern` that currently has preset data (corpus
  or synthesized), with a friendly label (e.g. "Standard", "7/8", "Drum &
  Bass").
- **Variant** — chips for each of the pattern's variants; picking one
  updates the preview grid.
- **Bars** — how many bars of the pattern's own meter to tile (1–32), via
  `@drum/library`'s `tileGrooveVaried`.
- **Velocity** — the section-style dynamics preset (`pp`…`ff`), scaled onto
  the variant's peak via `scaleToVelocityPreset` (shape preserved, not
  flattened).
- **Preview** — a step grid, one row per drum role in the variant, one
  column per 16th note, accented hits highlighted.

**Render to Live & Close** sends the pattern back. Where the clip lands
follows what you right-clicked, same as Progression Studio:

- **MidiTrack** → an arrangement clip appended after the track's last clip.
- **ClipSlot** (Session view) → one clip created directly in that slot.

## Styling

Same design tokens as Progression Studio, sourced from `@platform/ui-kit`'s
`ABLETON_DARK` (built for exactly this — styling Extensions webview modals)
rather than a second hand-copied literal, so the two studios can't visually
drift apart. Layout/class conventions (header, card, chip, `button.primary`)
are copied structurally from Progression Studio's `studio.ts`.

## Architecture

- `src/webview/app.ts` — the studio UI (typed TS, imports `@drum/library`
  and `@platform/ui-kit` source directly). Bundled by `build.ts` to a single
  IIFE and inlined into the modal page.
- `src/studio.ts` — composes the self-contained modal HTML.
- `src/render-drum-studio.ts` — pure: studio result → `NoteDescription[]`,
  reusing `@drum/library`'s `PRESET_DATA`/`scaleToVelocityPreset`/
  `tileGrooveVaried` as-is (the same two steps `trackdraft-bridge`'s
  `planDrumClips` uses per section).
- `src/generated/studio-bundle.ts` — **generated** by `build.ts` (bundled
  app + trimmed preset preview data). Don't edit.

## Build / test

```sh
npm run build        # typecheck + bundle webview & extension
npm test              # render-drum-studio unit tests + extension integration tests
```

`scripts/preview.ts` writes a standalone preview HTML for browser QA
(`npx tsx scripts/preview.ts` from this directory).
