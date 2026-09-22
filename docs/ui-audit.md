# TrackDraft UI audit — component, command & interaction inventory

**Produced:** 2026-09-21, at commits `e3ba94a` + `7ea8f2a`.
**Method:** grep-derived metrics over `apps/trackdraft/src` (every number below is
machine-counted, not estimated) + each file's own header docstring; command surfaces read
from the extension sources. **Living document** — update it when the surface changes
(§8 has the regeneration commands).

This is the inventory input for the standardization overview
(`docs/ui-standardization.md` — the next artifact). It records what exists; it does not
propose changes (those go in the standardization doc, drawn from §7).

---

## 0. Headline numbers

| Metric | Value |
|---|---|
| Component files (`components/` + `pages/`, excl. generated/tests) | **65** |
| Total component LOC | **15,262** |
| Button sites (`<button`) | **238** |
| Shared primitives layer (`components/common/`) | **none exists** |
| Modal overlays (`fixed inset-0`, hand-rolled) | **4** |
| Native `confirm()` sites | **3** |
| Global `keydown` listeners | **2** |
| Raw `#RRGGBB` literals in `.tsx` components | ~**193** across 22 files |
| TrackDraft amber `#E8B54A` occurrences (**untokenized**) | **115** (57 in `.tsx`; 50 in an unreferenced prototype HTML) |
| Interactive accent token (`#FFA500` orange) | **172** total — 163 class uses + 9 raw draw-code literals |
| Font-size tokens (`text-2xs/3xs`) vs bracket sizes (`text-[9–11px]`) | **187 vs 159** |
| `font-mono` micro-label adoption | **34 of 65** files |
| Inline `style={}` | **76** |
| Drums domain share of UI LOC | **5,299 / 15,262 ≈ 35%** |

---

## 1. System map

### Routes (`src/App.tsx`)

| Route | Surface |
|---|---|
| `/` | Dashboard — directory browser + songs table; sidebar (Songs/Templates); header links: UI Kit · Sandbox · Canvas · Genre Maps |
| `/song/:songId` → `studio` | Song workspace (shell below) |
| `…/workbench` | Workbench β — the section workspace (spine + in-place element rows) |
| `…/studio` | Studio — arrangement timeline, console, export menu |
| `…/structure` | Structure — section cards, map picker, necklace preview |
| `…/harmony` | Harmony — hex wheel + progression track (in canvas) |
| `…/drums` | Drums — Line view (classic) ↔ Blocks, selection workbench |
| `…/lyrics` | Lyrics — document/text modes, brief panel, metrical table |
| `…/melody` | Melody — record flow, piano roll, staff notation |
| `…/library` | Library — songs · maps · recipes browser (a view since 2026-09-21) |
| `…/settings` | Settings — MIDI & sync · export & popout · files · labs |
| `/song/:songId/popout` | Lyric + chord popout (second render target — second screen) |
| `/sandbox` | Puck live-preview sandbox |
| `/canvas` | Render canvas layout test |
| `/genre-workbench` | Genre-map authoring (prompt → paste → validate → copy to catalog) |
| `/design-lab` (old `/ui-kit-sandbox` redirects) | Design Lab — hands-on design surface: accent fork, hue playground, type/button specimens, decisions log |

### Song workspace shell (`SongEditorLayout.tsx`) — restructured 2026-09-21

- **Spine** (top band, `shell/Spine.tsx`, every route): song chip (title ·
  key · meter; click = dashboard) + transport strip + ruler + blocks +
  chords lane; blank songs keep the band with first-section role chips.
- **Views rail** (left, `shell/NavRail.tsx`, narrow w-32/w-9): all views —
  Workbench β · Studio · Structure · Harmony · Drums · Lyrics · Melody ·
  Library · Settings. Icons: `common/Icon.tsx` (SVG icon pass).
- **Inspector** (right, `shell/InspectorRail.tsx`): contextual facet tabs
  per view (≣ Section form · ▦ Drums · ♪ Harmony · ✎ Lyrics · ◉ Mix/Bend ·
  ⓘ Song); slides open on engagement, collapses to a 36px strip.
- The identity header + tab row + **dock** are gone (`dockStore.ts`
  deleted); wide surfaces (harmony's progression strip, lyrics pad) live
  in their canvases.

### Dashboard (`/`)

Sidebar (Songs/Templates switch + Directories + import-zone), header (links, song count,
confidence legend), ActionBar (create / import / YouTube / sync / analyze), FilterBar,
sortable SongTable, TemplatePicker gallery, DirSetupModal.

---

## 2. Component inventory

Legend: **LOC** · **btn** = `<button` sites · **hex** = raw 6-digit color literals ·
**sel/inp** = native `<select>`/`<input>` counts · stores = zustand stores used.
Roles condensed from each file's own header docs.

### layout / root — 2 files · 386 LOC

| File | LOC | Role / notes |
|---|---|---|
| `layout/SongEditorLayout.tsx` | 365 | App shell: header, tab strip, dock host, right sidebar; hydration-guarded `openSong` (the P6 wrong-song route fix). 9 btn |
| `RenderCanvasLayout.tsx` | 21 | `/canvas` layout wrapper |

### dashboard — 8 files · 1,360 LOC

| File | LOC | Role / notes |
|---|---|---|
| `Dashboard.tsx` | 367 | Auto-registers built-in dirs; hosts header, ActionBar, FilterBar, SongTable, dir listings. `useDirectoryStore`, `useSongStore` |
| `ActionBar.tsx` | 279 | Create · Import .json · Sync library to folder · YouTube one-click import (SSE progress) · Analyze Audio. 5 btn, 4 inp |
| `DirSetupModal.tsx` | 128 | Overlay: manage browsable directories. 4 btn |
| `DirectoryTree.tsx` | 105 | Directory listing + Import-All. 4 btn |
| `FilterBar.tsx` | 125 | Search / Has-sections / confidence / key filters. 3 btn, 2 inp |
| `Sidebar.tsx` | 95 | Songs·Templates switch, directory list, ImportZone drop targets |
| `SongTable.tsx` | 163 | Sortable song list (confidence dots, key/bpm/sections) |
| `TemplatePicker.tsx` | 98 | Template gallery; create **applies the map** (slots + defaults + Groove-DNA genre) |

### structure — 4 files · 518 LOC

| File | LOC | Role / notes |
|---|---|---|
| `StructureView.tsx` | 85 | Section list assembly + MapPicker + totals line |
| `SectionCard.tsx` | 233 | One section: name/role, bars, velocity, meter, beatsPerChord, repeats, chords, DnD reorder. 4 btn, 4 sel, 5 inp |
| `MapPicker.tsx` | 179 | Narrative vs genre maps · variants · exclude-optional · seed-recipe checkbox; `confirm()` on replace. 5 btn, 3 sel |
| `DrumNecklacePreview.tsx` | 21 | Thin resolver → `drums/NecklaceRow` (shared presentation) |

### harmony — 15 files · 2,877 LOC

| File | LOC | Role / notes |
|---|---|---|
| `HarmonyView.tsx` | 162 | Hex-canvas shell; wires dock panels; hosts ModeInferenceCard |
| `HoneycombWheel.tsx` | 383 | Editable hex chord walk (canvas). Tap = contextmenu = add/select. hex 15 |
| `ProgressionTrack.tsx` | 256 | Chord strip: effect-lane glyph cycle, borrowed-residue dot, click select/preview. hex 5 |
| `ChordCard.tsx` | 165 | Compact chord chip + inline fields. 3 sel |
| `ChordEditorPopover.tsx` | 205 | Right-menu chord editor (selection → Beats → Quality → Substitutions → performance). 10 btn |
| `ChordInspector.tsx` | 320 | Theory drill-down: function, chromatic transforms, all borrowed candidates. 5 btn |
| `HarmonyDockTools.tsx` | 441 | Bottom-dock panels: chord tools, rhythm, layer toggles, key/scale header. 9 btn |
| `PresetPicker.tsx` | 231 | Categorized progression presets; save-current; `confirm()` ×2 on replace. 6 btn |
| `KeySelector.tsx` | 42 | Key + scale selects (dock header) |
| `FloatingToolbar.tsx` | 100 | Former floating bar → plain strip (presets shortcut). 2 sel |
| `FitStatus.tsx` | 57 | Bars-fit advisory + set-bars action |
| `HexReadout.tsx` | 216 | Static readout of a section's walk on hex geometry. hex 6, style 7 |
| `BassSettings.tsx` | 105 | Per-section bass profile (register/pattern/velocity) |
| `ColorSettings.tsx` | 94 | Color-layer settings |
| `ModeInferenceCard.tsx` | 100 | ◆ borrowed-vs-modulate teaching card (Set / Keep / dismiss) |

### drums — 11 files · 5,299 LOC (~35% of the UI)

| File | LOC | Role / notes |
|---|---|---|
| `blocks/DrumBlocksView.tsx` | **1,574** | Step-lane timeline, SVG-drawn (velocity lane, step FX). ctrl/meta-modified pickers. hex 25 |
| `DrumPatternTools.tsx` | **1,091** | Pattern grids + Euclidean sliders + voice tools — the largest control surface in the app. **37 btn**, 12 hex |
| `DrumsView.tsx` | 950 | Shell: pattern editor ↔ blocks toggle; selection-system wiring; registers dock. hex 15 |
| `blocks/SelectionEditorModal.tsx` | 480 | Exploded selection modal (2 bars context); Esc-close. 6 btn, hex 20 |
| `blocks/SelectionDisplays.tsx` | 326 | Shared big control displays (docked + modal = one implementation). 9 btn, hex 13 |
| `blocks/SelectionWorkbench.tsx` | 282 | Docked home for selection tools (appears with a selection). 5 btn |
| `blocks/SelectionPad.tsx` | 234 | XY pad docked right of the selection rect (never covers the pattern). hex 17 |
| `TransitionPreview.tsx` | 143 | Transition-fill preview (same `synthesizeTransition` the export uses) |
| `euclidEditor.tsx` | 117 | Shared Euclidean sliders/strips (drums outline; Harmony rhythm reuses it) |
| `NecklaceGlyph.tsx` | 68 | Single groove-necklace SVG |
| `NecklaceRow.tsx` | 34 | Necklace presentation (shared by Structure preview + Drums) |

Supporting color maps (not components): `voiceStyle.ts`, `transitionStyle.ts`,
`sectionRoleStyle.ts` — semantic palettes as literals; see §5.

### lyrics — 9 files · 1,035 LOC

| File | LOC | Role / notes |
|---|---|---|
| `LyricsBriefPanel.tsx` | 298 | Brief/prompt panel (spark suggestions); reads selection + spark stores |
| `LyricDocumentView.tsx` | 261 | Document mode; section add/rename (Enter handlers). 9 btn |
| `SectionMarker.tsx` | 105 | Sectionize ops UI (mark/merge/split/unassign), presentation-only. 5 btn |
| `MetricalTable.tsx` | 83 | Syllable/feet/rhyme table (from .xlsx imports) |
| `LyricsView.tsx` | 89 | Shell + mode toggles; registers dock |
| `RhymeSuggestions.tsx` | 69 | Rhyme finder |
| `LyricsDockTools.tsx` | 59 | Dock content (self-sufficient, like HarmonyDockTools) |
| `WritingContext.tsx` | 41 | Concept/vocal/lyric-direction readout while writing |
| `LyricsEditor.tsx` | 30 | Text-mode editor glue |

### melody — 3 files · 1,099 LOC

| File | LOC | Role / notes |
|---|---|---|
| `MelodyView.tsx` | 503 | Record flow: pick section → ● Record → hum → Stop; quantize grid + fit-to-scale. 9 btn |
| `MelodyStaff.tsx` | 389 | Notation on a treble staff (canvas drawing). hex 2 |
| `MelodyPianoRoll.tsx` | 207 | Pitch/time bars view. hex 5 |

### studio — 7 files · 1,182 LOC

| File | LOC | Role / notes |
|---|---|---|
| `StudioView.tsx` | 286 | Transport + clock source + play controls; hosts console/timeline. 6 btn |
| `StudioConsole.tsx` | 226 | Console readout (module-scope subcomponents for isolated re-renders) |
| `ArrangementTimeline.tsx` | 224 | Section blocks + playhead (min-width clamped to real render width) |
| `MidiSetupPanel.tsx` | 182 | Overlay: ports/channels + Test; persists via `midiSettingsStore` |
| `ExportMenu.tsx` | 93 | Dropdown: Export MIDI · Send to Ableton; global Esc-close listener |
| `AbletonStatus.tsx` | 92 | Bridge health + start hints |
| `MidiTemplateGuide.tsx` | 79 | Overlay guide for MIDI wiring |

### details — 1 file · 268 LOC

| File | LOC | Role / notes |
|---|---|---|
| `SongInfoPanel.tsx` | 268 | Wide-short song info panel for the dock (replaces the old tall Details column). 4 btn, 4 inp |

### style — 1 file · 367 LOC

| File | LOC | Role / notes |
|---|---|---|
| `BendPanel.tsx` | 367 | Mix/Bend station: style-recipe select, per-layer sliders, ◆ detected ghosts + adopt |

### popout — 1 file · 205 LOC

| File | LOC | Role / notes |
|---|---|---|
| `LyricChordPopout.tsx` | 205 | Second render target; loops chords via `midiExport`'s `loopChordsToFill` |

### pages — 3 files · 666 LOC

| File | LOC | Role / notes |
|---|---|---|
| `GenreWorkbench.tsx` | 323 | Genre-map authoring (master list, prompt, validate, copy-to-catalog) |
| `UiKitSandbox.tsx` | 241 | ui-kit evaluation (tokens, presets, hue generator). hex 9 |
| `LivePreviewSandbox.tsx` | 102 | Puck live preview |

---

## 3. Interaction inventory

- **238 button sites.** Concentration: `DrumPatternTools` **37**, `ChordEditorPopover` **10**,
  then 9 each in `SongEditorLayout` / `HarmonyDockTools` / `MelodyView` /
  `SelectionDisplays` / `LyricDocumentView`.
- **Overlays (4, all hand-rolled `fixed inset-0`)**: `DirSetupModal`,
  `SelectionEditorModal`, `MidiSetupPanel`, `MidiTemplateGuide`. The popover
  (`ChordEditorPopover`) and dropdown (`ExportMenu`) are separate mechanisms.
  There is no modal/popover primitive.
- **Native `confirm()`**: exactly **3** call sites (`PresetPicker` ×2 — replace
  progression; `MapPicker` ×1 — replace sections). Everything else communicates inline.
- **Keyboard**: only **2 global listeners** — `ExportMenu` (Esc close) and
  `SelectionEditorModal` (Esc + keys). All other key handling is per-input Enter.
  **No shortcut registry; no global hotkeys** beyond the transport header buttons.
- **Pointer conventions**: HoneycombWheel tap = contextmenu = add/select;
  DrumBlocksView ctrl/meta-modified drag; SelectionPad drag/resize; dnd-kit for section
  and arrangement reordering.
- **Suggest-don't-impose canon** — the homegrown interaction pattern worth codifying:
  ◆ ghosts in `BendPanel` (detected style ratings; explicit adopt) and
  `ModeInferenceCard` (borrowed-vs-modulate; Set / Keep / dismiss). Both are *derived*
  (recomputed from state, not event-fired) and never auto-apply.
- **Undo**: song-store history only (header Undo/Redo); no independent undo for
  drums/lyrics local edits.

---

## 4. State & persistence map

10 zustand stores + shared `store/storage.ts` helpers (one debounced-writer mechanism).

| Store | Scope | Persists? |
|---|---|---|
| `songStore` | songs, current id, undo/redo history, clock source | `trackdraft-songs` · `trackdraft-current-song-id` · `trackdraft-clock-source` |
| `directoryStore` | browsable directories | `trackdraft-directories` |
| `midiSettingsStore` | MIDI output + channel map | `trackdraft-midi-settings` |
| `lyricsSparkStore` | spark/brief re-roll state | `trackdraft-lyrics-spark` |
| `dockStore` | dock panel ReactNodes | session only |
| `drumsDraftStore` · `drumsSelectionStore` | drum draft + selection | session only |
| `harmonySelectionStore` · `lyricsSelectionStore` · `studioSelectionStore` | per-domain selection | session only |

**Persistence gotcha (cross-cutting):** `parseImportedSong` (`lib/exportImport.ts`)
rebuilds songs field-by-field — any new `BlueprintSong` field must be added there or it
**silently drops on import**. Bit twice: `bend`/`detected` (fixed `28dca7e`) and
`blueprintAcks` (fixed `e3ba94a`); now regression-locked in `exportImport.test.ts`.

**Convention to keep:** per-domain selection stores named `use<Domain>SelectionStore`;
persistence only for durable config, never for selection/preview state.

---

## 5. Styling inventory

### Token architecture (already exists; single-sourced)

- `tailwind.config.js` derives **all** colors from `@platform/ui-kit`'s `ABLETON_DARK`:
  `canvas · panel · panelAlt` (derived `lighten()`) `· edge · ink · inkMuted · accent ·
  accentHover · accentActive`.
- Radius tightened to Live-like **2/3/4/5px**; micro sizes `text-2xs` (10px) and
  `text-3xs` (9px) added — the config comments state these exist to end the one-off
  bracket pattern.

### Adoption numbers (drift is measurable and small)

- **Two accent families are in play — only one is tokenized:**
  - **Interactive accent** = Tailwind `accent` token = `ABLETON_DARK.accent` =
    **`#FFA500` (orange)**: 163 class uses (`text/bg/border-accent…`) + 9 raw `#FFA500`
    draw-code literals (SelectionPad strokes) — the class uses are healthy; the literals
    become one shared constant.
  - **TrackDraft amber `#E8B54A` (gold) is NOT in the token system** — 57 tsx occurrences:
    4 arbitrary class values (`accent-[#E8B54A]` on BendPanel sliders — deliberate: the
    range-input accent-color), ~15 "active chip" class strings in drums
    (`border-[#E8B54A] text-[#E8B54A] bg-[#E8B54A]/10` across 4 files), and the rest SVG
    `fill=`/`stroke=` attributes, `style={{…}}` shadows, and local `const AMBER = "#E8B54A"`
    (3 drums files) — plus **50 more in `components/drums/newview.html`**.
  - The design question this surfaces (one accent or two — interactive vs instrument) is
    now presented hands-on at **`/design-lab`** (decision D1).
- **Fonts**: token **187** vs bracket **159** — the migration is about half done.
- **Radius**: only **11** `rounded-lg` stragglers vs 259 bare `rounded`.
- **Inline `style={}`**: 76 total; hotspots `HoneycombWheel` 12, `DrumPatternTools` 8,
  `HexReadout` 7, `ProgressionTrack` 6 — mostly canvas geometry / dynamic colors.
- **`font-mono` micro-labels** adopted in 34/65 files — the de-facto text convention.

### Semantic palettes living as literals (the real gap)

- **Drums voice palette**, duplicated across `voiceStyle.ts`, `transitionStyle.ts`,
  `sectionRoleStyle.ts`, `DrumPatternTools.CELL_VOICE_COLOR`, and the Selection* files:
  kick `#E8B54A` · snare `#D96459` · rim `#D9954A` · hat `#8B94A1` · cym `#4FA3A5` ·
  tom `#9678C8`.
- `#FFA500` (9×) — substitution/active orange (e.g. `ProgressionTrack` stripe), distinct
  from accent gold; a semantic token candidate.
- `#0B0D11 / #0D0F14 / #0B0E13` (~25×) — near-black fills in drums SVG/panels; candidate
  deep-canvas tokens.

### Stray artifact

`components/drums/newview.html` — 32 KB committed **design prototype**
("Drum Blocks v3 — docked pad + step lanes"), unreferenced by any code, and the historical
source of the drums palette + token ideas (its CSS vars define `--kick/--snare/…`, and an
`--accent:#FFA500` vs `--amber:#E8B54A` split). Decide: `docs/design/` or archive.

---

## 6. Command surface

### In-app

238 button sites across the views in §2; header transport (play/stop/loop/undo/redo/export);
dashboard actions (create/import/sync/YouTube/analyze); per-view tools as inventoried.
Export menu: **Export MIDI** · **Send to Ableton**.

### Ableton Extensions (context-menu registrations, 5 extensions)

| Extension | Menu item | Command id |
|---|---|---|
| chord-assistant | Insert Chord Progression (MidiTrack.ArrangementSelection) | `chordAssistant.insertProgression` |
| drum-studio | Open Drum Studio (MidiTrack + AudioTrack) | `drumStudio.open` |
| progression-studio | Open Progression Studio | `progressionStudio.open` |
| progression-studio | Generate Melody | `progressionStudio.melody` |
| trackdraft-bridge | Apply Song Blueprint (Midi + Audio) | `trackdraftBridge.applySongBlueprint` |
| trackdraft-bridge | View Song Blueprint (Midi + Audio) | `trackdraftBridge.viewSongBlueprint` |
| trackdraft-bridge | Generate Chord Clips | `trackdraftBridge.generateChordClips` |
| trackdraft-bridge | Generate Drum Clips | `trackdraftBridge.generateDrumClips` |
| trackdraft-bridge | Generate Bass Line | `trackdraftBridge.generateBassLine` |
| trackdraft-bridge | Generate Blank Section Clips | `trackdraftBridge.generateBlankClips` |
| trackdraft-bridge | Probe Drum Rack | `trackdraftBridge.probeDrumRack` |
| hello-world | ping | `helloWorld.ping` |

### CLI

`platform create extension <name> [--ui] [--author "…"] [--live <path>]` ·
`platform create device <name>`

### MCP (`packages/song-mcp`)

`song_query_library` · `song_get` · `song_apply_ops` · `song_revert` ·
`song_create_template` · `song_library_stats`

### Scripts (`apps/trackdraft/scripts/` — 28 entries + dirs)

- **Ingest**: `ingest-beatles-catalog`, `ingest-lalo-chezia`, `ingest-mcgill-catalog`,
  `ingest-rock-corpus-catalog`
- **Catalog QA**: `audit-catalog`, `repair-catalog`, `triage-catalog`, `fit-report`,
  `measure-repair-improvement`, `repair-chord-tracks`, `audit-patterns`, `batch-fix-drums`
- **Analysis**: `analyze-drum-stem.py`, `analyze-bass-stem.py`, `analyze-drums.ts`,
  `whisper-transcribe.py`, `whisper-upgrade-plain.py`, `transcribe-accuracy`,
  `midi-to-analysis`, `import-drum-analysis`, `merge-drum-analysis`
- **Metadata / lyrics**: `lookup-metadata`, `lookup-lrclib`, `refresh-lrclib-lyrics`
- **Pipeline**: `assemble-blueprint`, `detect-bend`, `export-midi`, `chordmini-bridge`,
  `generate-puck`, `drum-section-reanchor` (+ `catalog/`, `drumAnalysis/`, `output/`)

---

## 7. Findings — inputs for the standardization pass

1. **Token drift is small and countable — plus one design decision.** Two accent families
   exist: the tokenized interactive orange (`accent` = `#FFA500`; 163 class + 9 raw draw
   uses) and the untokenized TrackDraft amber (`#E8B54A`; 57 tsx + 50 prototype uses) —
   ~15 chip strings + 4 arbitrary classes are mechanical drift; whether both colors
   *should* exist is a design call, now staged at `/design-lab` (D1). Fonts: 187 vs 159 —
   the other half of a deliberate migration the config already anticipated.
   `rounded-lg`: 11 stragglers.
2. **Draw code needs a shared palette constant, not classes.** SVG `fill=`/`stroke=` and
   canvas drawing can't use Tailwind tokens; three drums files already use
   `const AMBER`. Generalize into one theme module (sourced from `ABLETON_DARK`) covering
   accent + the six voice colors + deep-canvas fills.
3. **The drums voice palette is duplicated in 4+ places** and its source of truth is a
   committed prototype HTML (`newview.html`). Single-source it; relocate the prototype.
4. **Drums is 35% of the UI** (`DrumBlocksView` 1,574 + `DrumPatternTools` 1,091 +
   `DrumsView` 950). Any monolith-split plan starts here.
5. **No primitives layer.** 238 buttons, selects in 12 files, inputs in ~20, 4 hand-rolled
   overlays, 3 native `confirm()`s, no shared modal/popover/checkbox/chip/slider —
   a `components/common/` layer (or ui-kit components) is the single highest-leverage
   standardization deliverable once the ui-kit direction is decided.
6. **Dock grammar is nearly there but placement varies.** 4 panels, auto-focus rules,
   registration by 3 views; Structure=right, Studio=none, Harmony=both, Melody=bottom-but-
   empty. Decide: full adoption for all six tabs, or documented exceptions.
7. **Suggest-don't-impose (◆) is the established suggestion pattern** (BendPanel,
   ModeInferenceCard) — codify it (states: ghost → adopt/dismiss; derived recomputation;
   no auto-apply) so future features inherit it instead of inventing another.
8. **No shortcut layer.** 2 global listeners total. Either add a minimal registry
   (Esc/undo/space transport) or explicitly decide keyboard is not a first-class input.
9. **Inline styles (76) are mostly deserved** (canvas geometry, drag transforms,
   dynamic hues) — standardize the *static* ones into tokens/constants; leave the dynamic
   ones documented.
10. **`font-mono` micro-label language is de-facto standard** (34 files) — promote it to an
    explicit rule (which elements are mono-uppercase, which sizes) so it survives the
    polish pass intact.
11. **Selection-store pattern is consistent** (per-domain `use<Domain>SelectionStore`,
    session-only) — document it as convention; the song-import whitelist gotcha (§4) is
    the one persistence sharp edge and is now test-locked.
12. **Prototype/scratch artifacts inside `src/`** (`newview.html`; earlier: `tempdrumpatgencode`
    strays, `YTTESTSONGS.md`) — establish a home (`docs/design/`, `archive/`) so design
    history stays discoverable but out of the source tree.

---

## 8. Regeneration commands

All numbers in this doc come from these (run from `apps/trackdraft/src`):

```bash
# LOC per component
find components pages -name '*.tsx' ! -name 'puck.generated.tsx' ! -name '*.test.tsx' | xargs wc -l | sort -rn

# button / control / color density per file
for f in $(find components pages -name '*.tsx' ! -name 'puck.generated.tsx'); do
  echo "$f $(grep -c '<button' "$f") $(grep -cE '#[0-9a-fA-F]{6}' "$f")"; done

# token vs raw adoption
grep -roh 'text-accent' components pages | wc -l
grep -roh 'E8B54A' components pages | wc -l
grep -rEoh 'text-2xs|text-3xs' components pages | wc -l
grep -rEoh 'text-\[(9|10|11)px\]' components pages | wc -l

# interactions
grep -rln 'fixed inset-0' components pages          # overlays
grep -rn 'confirm(' components pages | grep -v '//' # native confirms
grep -rnE 'addEventListener\("keydown"' components pages
```

Update this document in the same commit whenever the component surface, token system, or
command surfaces change.
