# TrackDraft Workspace — the ladder & the bands

Status: **direction frozen 2026-09-21** (user + Copilot brainstorm). Phase 1 implementation
started the same day (this doc + `Spine` v0 + the `/song/:id/workbench` route).
Related: `docs/ui-standardization.md` (the constitution — primitives, tokens, drift),
`docs/ui-audit.md` (the inventory), `docs/design/README.md` (the Design Lab loop).

The old model: six tabs, each owning its own chrome, chord wheel and drum
timeline as peers. The new model: **one workspace, one time axis, three
depths** — the tabs dissolve into *places you can be* in one song.

---

## 0. The names (shared vocabulary — frozen 2026-09-21)

Use these words, in this meaning, in every conversation about the workspace.

**Depths** — where you are in the ladder:

| Depth | Meaning | Home today |
|---|---|---|
| **Arrangement** (L1) | the whole song on the time axis — section sculpting, the arc, maps/templates | the spine at full size + the **Studio** tab (its page) |
| **Section** (L2) | one section stretched out, all its material visible | **Workbench β** (`/workbench`) |
| **Element** (L3) | one element's full editor | the tab pages — **Drums · Harmony · Lyrics · Melody** |

**Faces** — every element has two:

- **arrangement face**: the element across the song (drums = the classic
  **Line view**; harmony = the progression strip generalized later;
  melody = contour lane later).
- **section face**: the element itself, authored in place (drums =
  **Blocks**; harmony = the hex wheel; lyrics = the pad; melody = the
  staff).

**Zones** — the shell bands (§2): **Spine** (top) · **Library** (left) ·
**Canvas** (center) · **Inspector** (right — facets ≣ Section form ·
▦ Drums · ♪ Harmony · ✎ Lyrics · ◉ Mix/Bend · ⓘ Song).

**View names ↔ semantic roles** — views live in the left rail's VIEWS
list since 2026-09-21 (the top tab row and the identity header both
dissolved); the names below stay the same wherever the doors move:

| View (left rail) | Semantic name | Depth |
|---|---|---|
| Studio | **Arrangement board** (timeline + console) | L1 |
| Workbench β | **Section workspace** | L2 |
| Drums | **Drums editor** — Line view (classic) + Blocks | L3 |
| Harmony | **Harmony editor** — wheel + progression strip | L3 |
| Lyrics | **Lyrics editor** — pad + rhyme/meter tools | L3 |
| Melody | **Melody editor** — staff | L3 |
| Structure | **Section form** — today's full-page home of the ≣ facet | L2 preset |
| Library | **Library view** — the browser (songs · maps · recipes) as a center view | — (acts on the open song) |
| Settings | **Settings view** — MIDI & sync · export & popout · files · labs | — |

In-view modes are deliberately NOT doors: the Drums view's **Line view
↔ Blocks** toggle, Lyrics' **per-section ↔ song text** toggle, and the
Harmony wheel's Linear/Loop timing modes all switch *within* their view.
The lyrics/chords **popout** is a window (opened from Settings or
Studio), not a view — since 2026-09-23 it opens in **Song flow** (the
whole arrangement as one karaoke scroll, every repeat pass labelled,
current line lit + auto-scrolled) with the performing **Section** face
one persisted toggle away. **Labs** — Genre Workbench · Design Lab · the Puck
sandbox — live outside the song editor and are linked from Settings.

The drum pair keeps the names it earned: **Line view** = the classic
timeline (the drums' arrangement face, shown at Section depth with
context around the focused section); **Blocks** = the beat-by-beat editor
(the section face, one click down).

## 1. The ladder

```
ARRANGEMENT ── spine at FULL size (section cards + lanes)     ← "arrangement work"
     │  click a section → it grows into…
SECTION    ── spine recedes to a RIBBON; rows = every element  ← "section work"
     │  click a row → …
ELEMENT    ── the full editor (blocks / hex / melody / lyric pad…)
               ribbon persists above
```

- **Arrangement work**: when/where — section sculpting, maps/templates, the
  song's arc. The spine is the whole picture.
- **Section work**: what — one moment stretched out with all its material
  visible at once, then a single element in full detail.

The **two drum views map onto the ladder** and are the template for every
element: Blocks = the Drums **section face**; the classic lane timeline = the
Drums **arrangement face**. (Authoring is migrating into Blocks; a few bits
still live in the classic dock — detour start-beat, transition preview —
until modal parity.)

## 2. The bands — full width means full width

```
┌──────────────────────────────────────────────────────────────┐
│  THE SPINE — edge to edge, never squeezed, EVERY view       │
│  [← song chip] [Intro][Verse 1][Verse 2][Chorus]… [▶ ⟳ zoom]│
├────┬────────────────────────────────────────────┬────────────┤
│ ▸  │                                            │ INSPECTOR  │
│ VI-│              THE CANVAS                    │ (slides    │
│ EW-│  line view · hex wheel · blocks grid ·     │  open on   │
│ S  │  library browser · …                       │  engage)   │
└────┴────────────────────────────────────────────┴────────────┘
   doors              the work             the focused object's tools
```

**The three menus, decided 2026-09-21** (user: "logically figure out where
those controls go and then I will stick with it"):

| Zone | Role | Contents |
|---|---|---|
| **LEFT** | **Views nav — the doors** | every song view + the Library (itself a view since 2026-09-21). Narrow by design (w-32, or a w-9 glyph strip where the current view lights up). Navigation is explicit and coupled: clicking a view switches the center — the inspector's facets are tools, not doors. |
| **CENTER** | **The canvas** | the view's visual: the drum line view, hex wheel + progression strip, structure cards, blocks grid, lyric pad, library browser. Tool chrome never lives here. |
| **RIGHT** | **Inspector — the focused object's tools** | facet tabs (≣ Section form · ▦ Drums · ♪ Harmony · ✎ Lyrics · ◉ Mix/Bend · ⓘ Song — §0), **contextual per view since 2026-09-21** (user rule: "only showing tabs that have controls that can effect that view"): the workbench keeps all six; instrument views open on their own tool plus ≣ and ⓘ (harmony ♪ · drums ▦ · lyrics ✎); studio is ≣ ◉ ⓘ; melody is ≣ ⓘ; library/settings are ⓘ only. A deliberate engagement reveals its facet even off-view (visible = the view's facets ∪ the active one), and **slides open on engagement** — selecting a section or clicking a canvas element opens it (manual collapse wins until the next selection change); collapses to a thin strip for canvas room. |
| **BOTTOM** | **retired** | the dock duplicated the rail's job and existed on some views but not others; the workbench's stub band duplicated the left library. Wide surfaces that want the bottom edge (harmony's progression strip) belong to the CANVAS, not a third menu. |

- **Slice C shipped (2026-09-21):** the Library is shell chrome —
  `SongEditorLayout` mounts it on every song route, next to the spine and
  the inspector (the workbench's private copy is gone). It collapses to a
  w-9 strip ↔ w-56 browser and keeps its open state across tab changes
  (the layout never unmounts on navigation); picking a song KEEPS the
  current tab (`/song/X/harmony` → `/song/Y/harmony`); maps and recipes
  act on the open song from anywhere. With slice B (inspector) this
  completes the zones: **LEFT library · CENTER canvas · RIGHT inspector ·
  BOTTOM retired, on every view.**

- The spine spans the **entire width, above the zones row** (user rule,
  2026-09-21: the left browser and right rail must never cut it off). The
  browser and rail live *below* it and can open/close freely.
- **Views recoupled (2026-09-21, user: "turning the left menu into the tab
  bar and recouple it… make the library a view"):** the top tab row AND
  the identity header dissolved — **two rows gained**; identity is now the
  song chip at the spine strip's left end (title · key · meter, click =
  dashboard). The left rail is the VIEWS list (narrow w-32, collapses to a
  w-9 glyph strip with the current view lit); **the Library is a full
  view** in the center; and touching a chord anywhere — the spine's
  chords lane included — selects it and engages the ♪ facet, so "click a
  chord, see chords" holds everywhere.
- The spine's left end carries the song chip (title · key · bpm), its right
  end the transport readout/controls — the old standalone header dissolves
  into it (P2; v0 keeps the legacy header above while the tabs still exist).
- The playhead sweeps the full width; descended, it can drop a vertical
  beat line through the workspace so every row stays time-anchored.
- The bottom workbench band is **retired** (2026-09-21): its maps/recipes
  copy duplicated the left library, and its future "arrangement lanes"
  belong to the canvas/spine rather than a third menu. The workbench's
  stub band was deleted the same day.
- **The element ladder inside the section view (user-specified
  2026-09-21):** the spine above is the *broadest* rung (the song's
  arrangement — tempo / signature / feel / groove lanes land here later);
  the section workspace is the *broad* rung — the featured element's
  whole face WITH enough context around it (never cut short of its
  transitions in/out or internal detours/fills); the element's own editor
  (e.g. the drums Blocks grid) is the *beat-by-beat* rung, one click down.
- **Drum line view (first featured face, 2026-09-21; revised same day):**
  the Drums row embeds THE classic Drums canvas (`DrumsView embedded`) —
  the actual renderer, so the two views cannot drift — cropped to a
  window around the focused section (4 bars of context each side, zoom
  fitted to the crop box and automatically scrolled to the section), so
  the transition into/out of it and any internal detours are all in
  view. Every click routes to the beat-by-beat rung: the clicked bar —
  or the detour's whole span, or the transition tail (manual bars, else
  the 1-bar auto-fill zone), when the click lands on one — is staged
  into the drums selection and the Blocks editor opens on that range.
  (An earlier same-day attempt drew a per-bar density bar chart instead:
  user vetoed — "the classic view is my vision for the second level.
  So just the line view." — and it was deleted. Lesson recorded.)

## 3. The spine

- Rendered at two sizes from the same data: **cards** (arrangement) ↔
  **ribbon** (section/element). Clicking a card during the descent animates
  it growing into the section workspace — continuity is the make-or-break vs
  "six tabs again".
- Cards carry **material badges** = coverage map *and* doorways: the
  coverage map is the four-segment **top-edge gauge** (chords / drums /
  melody / lyrics, lit = authored — user-specified 2026-09-21, replacing
  the presence-dots text row); clicking a badge jumps to that element's
  section face for that section (P3).
- Carries the playhead + loop; `←→` steps sections when it has focus.
- **Timeline v2 (user-specified 2026-09-21, shipped P1.5):** fixed
  **bar-linear** scale — 10px/bar default, wheel/−/+ zoom ladder 4→80
  px/bar + fit + zoom-to-section — scrolls inside the full-bleed band; a
  **bar ruler** with adaptive labels doubles as **seek** (click a bar =
  jump playback there; paused/stopped starts from there); the playhead is
  pixel-exact per span with **auto-follow** while playing (manual pan —
  shift+wheel, a trackpad swipe, or dragging the scroll rail — disengages;
  the toggle re-engages). The **mouse wheel zooms**, anchored on the bar
  under the cursor; scrollbars are slim translucent drag rails app-wide
  (transparent track, subtle thumb — styled globally, which also forces
  them visible on macOS instead of overlay-hiding), and the timeline
  **reserves its strip's space** (`overflow-x: scroll`) so the workspace
  never jumps when a song fits or stops fitting. All
  controls live in a **compact icon-only strip ABOVE the timeline** —
  transport (play · pause · stop · section loop) + undo/redo, then zoom
  −/+ · fit · zoom-to-section · follow; nothing sits at the timeline's
  left or right ends.
  That strip IS the shell's collapsed header now — P2 slice 1 (2026-09-21)
  mounted the spine above every song route and the legacy header transport
  is gone (the header is identity only: song, key, tempo, classification). Blocks are
  true scale — a short song leaves an honest empty tail instead of
  stretching; labels and the facts line / coverage gauge render only when
  a block is wide enough to read them.
- **Block glance facts (user-specified 2026-09-21):** each block reads
  `12b · 4×3 · 4/4` — bars · beats-per-chord × repeats · meter — disclosed
  progressively as the block widens. The text row carries facts you plan
  against (how long, how the harmony sits, how many passes, the meter),
  not status you scan; the coverage map moved to the 2px top-edge gauge.
- **Interaction shelf (shipped with v2):** ruler **drag = loop region**
  (bar-snapped bracket; Esc / stop / a plain play or seek clears it —
  release without dragging = the classic seek); **right-click a block =
  context palette** (Loop this section · Zoom to section · Open in
  Structure), the second citizen of the placement law's palette tier;
  **hotkeys**: `space` play/pause · `Z` zoom-to-section · `F` fit ·
  `L` section loop · `[` `]` zoom ladder · `Esc` close/release.
- **Arrangement gestures (v2 of structure editing):** a **chords lane**
  sits under the blocks (harmony's arrangement face — chord changes at
  their default rhythm on the same bar axis, width-aware); block **edges
  drag to resize** (right edge = this section, left edge = the previous;
  a pure draft recomputes the timeline per frame, ONE undo step on
  release, Esc cancels); the context palette gains **Insert section
  after · Move left · Move right**.
- **Blank songs still have an arrangement surface (user repro 2026-09-21
  — "start a blank song and add sections"):** the band used to render
  `null` when a song had no sections, so a new song had no transport, no
  ruler, and no way to add anything — every view pointed back at the
  legacy Structure tab ("the arrangement view dissolved"). Now the strip
  always stays (undo of the first add matters) and, with zero sections,
  the timeline area is a row of **first-section role chips** — each chip
  a miniature of the block it will mint (role colour + label, starts at
  8 bars · 4/4, arrives selected so the ≣ form opens for naming/tuning).
  With sections present, the strip carries **＋ Add section** (appends a
  verse, selected; right-click a block for insert-after). Empty states
  across the views now point at the spine instead of the Structure tab.

## 4. The placement law

**Rail = reference. Inspector = workbench. Palette = selection. Modal = import.**

**Slice B shipped 2026-09-21 — the dock is dead, long live the inspector:**
`InspectorRail` is mounted by `SongEditorLayout` on EVERY song route (six
facets: ≣ structure · ▦ drums · ♪ harmony · ✎ lyrics · ◉ mix · ⓘ song),
auto-opens on any section-selection change, collapses to a 36px strip (**as
of 2026-10-24 that strip shows the same facets as glyphs, so the collapsed
rail says what it does — see §10**), and `dockStore.ts` is deleted from the
codebase. Wide surfaces went back to
their canvases: **Harmony's progression + effect lanes now sit under the
hex wheel** (the dock's Menu panel is gone). Lyrics *mode* (per-section /
song-text) moved into `lyricsSelectionStore`; the ✎ facet shows the tools
in per-section mode; **song-text mode now follows the block you last
  touched too** (2026-09-23 — the sectioning pass made the blocks select
  their section on any touch). Drum tools read
the shared studio selection directly.

| Piece | Home |
|---|---|
| Mix/Bend | stacks beneath Structure in the right rail as a **collapsible group** (open on demand) — the lens on the focus. |
| Structure right sidebar | becomes the rail's **Structure edits for the focused section** (the SectionCard editor ported: name/role/delete, TS, bars, beats/chord, repeats, drums+variant, velocity, transition note — v1 of arrangement editing; v2 mirrors these writes from direct manipulation on the spine). |
| Maps · genre recipes | **left Library tabs** (revised 2026-09-21 — was the bottom band): Songs · Maps (narrative + genre) · Recipes. Maps replace sections (confirmed); recipes seed genre + bend + tempo. |
| Harmony's two menus | **done (slice B)** — chord controls live **in the hex workspace**: progression strip + effect lane under the wheel, toolbox in the ♪ facet; the dock's section chips **died** (P2) — the ribbon is the single navigator |
| Drums dock | **retired (slice B)** — tools live in the ▦ facet; the classic line view stays as the level-2 canvas |
| Lyrics dock | **retired (slice B)** — rhyme/meter live in the ✎ facet, which follows the touched section in BOTH modes since the 2026-09-23 sectioning pass |
| Melody | workspace controls strip only — no rail, no dock |
| Drums | no rail — correct today |

**Default tool spot at the broad (level-2) rung — answered 2026-09-21:** the
rail's **instrument tab**. The center stays the *canvas* (the drum line
view); tool chrome never pollutes it. The rail's icon strip is the
instrument tool host: **▦ Drums** hosts the same `DrumPatternTools`
(Pattern · Detour · Transition) the `/drums` dock hosts — one
implementation, two hosts — and clicking the line view stages the clicked
section + range as the tools' target and flips the rail to the tab, so the
thing you touched is the thing you edit. Because the embedded canvas
renders the drums DRAFT, tool edits preview live on the line (add a detour
→ the arc appears; Revert → gone). Single click stages; **double-click
dives** to beat-by-beat on the picked range. Section selection is shared
(like Harmony since P2): selecting anywhere — spine, canvas — retargets the
drum tools. More instruments join the strip as their broad faces land.

## 5. Two faces per element

| Element | Arrangement face | Section face |
|---|---|---|
| Drums | classic lane timeline (fills, detours, transitions across the song) | Blocks editor |
| Harmony | cross-song progression lane (ProgressionTrack generalized) | hex wheel + chord editor |
| Melody | contour lane | staff / piano roll + record |
| Lyrics | **no lane — vetoed (user, 2026-09-21)**: words don't time-snap like notes; a lane would read as noise. Presence at L1 = the coverage gauge's lyrics segment + the block tooltip; the real surfaces are the section row and the pad | **song-text blocks** (sectioning: carve · label · repeats · split · park, each block carrying the ♪ hex walk + chord chips and its drum-transition chip) + lyric pad + rhyme/meter tools |
| Bass / Color | register/density strips (later) | controls exist; visuals TBD |

## 6. Navigation grammar (every depth)

`←→` sections · `↑↓` elements · `Enter` descend · `Esc` ascend. Click mirrors
all of it. Old routes stay as **focus presets / deep links** (`?section=`
jump-open included); the karaoke popout is untouched.

## 7. Phases

- **P1 (started 2026-09-21)**: `Spine` v0 (full-width band, coverage dots,
  playhead, click-select) + `/song/:id/workbench` route: spine band / library
  rail (songs) / section workspace rows (drums·bass·chords·color·melody·
  lyrics previews) / BendPanel as the rail / workbench stub band. Existing
  tabs untouched; "Workbench β" nav entry is the door.
- **P2 (slice 1 shipped 2026-09-21)**: spine becomes shell chrome above
  *all* song routes — mounted by `SongEditorLayout`, so every tab carries
  the transport strip / ruler / blocks / chords lane; the legacy header
  transport cluster died outright (its state plumbing too). **Harmony dock
  section chips died** as planned: section selection unified on the shared
  `useStudioSelectionStore` — the spine's blocks write it; Studio,
  Workbench and Harmony all read it, so selecting a block anywhere IS
  selecting the workspace's section. **Slice B (also 2026-09-21):** the
  InspectorRail became shell chrome on every route and the bottom dock was
  deleted app-wide (details in §4). Remaining for P2: nav tabs fold into
  the strip (P4 retires them), ribbon at element depth.
- **P3 (started 2026-09-21)**: in-place element editing at section depth —
  the Chords row embeds the REAL `ProgressionTrack` (drag-reorder,
  per-chord remove, effects lane — all writing through the shared
  `updateSection` path with single-step undo; clicking a chord selects it
  in the shared harmony store and engages the ♪ facet, so the thing you
  touched is the thing you edit). The Drums row already embeds the classic
  Line view (click dives to Blocks with the range staged — 26cf4f2).
  Remaining: melody note editing — none exists anywhere (the workspace is
  record-first; the piano roll is a view) — so the row dives armed
  instead, and the staff click-seeks; ◆ adopt (still undefined).
  **Done since (2026-09-21,
  same template):** the Lyrics row embeds the real pad (textarea +
  syllable gutter), the Bass and Color rows embed their full controls
  (BassSettings / ColorSettings), and the section header carries a loop
  action (the same `playSectionLoop` the spine's ⟳ uses). **Depth pass
  (2026-09-22):** the header edits its basics in place (click-to-rename ·
  bars −/+ · role menu on the dot), rows collapse (remembered in
  `trackdraft-workbench-rows`), the melody staff draws a live playhead
  (`activeBeat`) and the progression strip tints the sounding chord
  (`activeChordId`).** **Transition (2026-09-22):** the spine's **grow
  animation** shipped — clicking a block flies a translucent clone of it
  into the workspace header (`data-section-header`), the "clicked card
  grows into the Section workspace" beat; reduced-motion and views
  without the header no-op.** Also fixed en route: **undo/redo now
  persist** — an undone edit used to resurrect on reload (songStore
  regression test added).
  **Song-text sectioning pass (2026-09-23):** the Lyrics view's "Song
  text" mode rebuilt as **blocks** — and the pass leading with a
  correctness fix: the old view numbered selections in DISPLAY order
  while the ops sliced the DOCUMENT, so any selection below an
  instrumental placeholder or the hidden "Unassigned" tray silently
  acted on the wrong line (live repro: unassign a line, then Add Section
  on the row below carved the invisible one). Now: `songTextRows.ts`
  builds the view model in canonical document order with TRUE doc
  indices (unit-locked), unassigned lines render in place as a dashed
  parked tray (nothing vanishes), and blocks carry their system context —
  role dot/rename, `bars · beats/chord · meter` facts, a **repeats
  stepper** (chorus ×2 written straight to the arrangement), a ♪
  disclosure with the read-only **HexReadout** + real chord chips
  (clicking one selects the chord and pops the ♪ facet), and a
  **transition chip** showing the manual `drumTransitionModel` (solid) or
  the role-driven **auto plan** (dashed — build INTO choruses, break out
  of verses…), with a quick set/clear popover. Hover dividers split
  sections mid-flow, double-click fixes a line's text in place
  (`updateLineText`). **Karaoke popout flow mode shipped the same day
  (2026-09-23):** the popout gained a persisted **Song flow ↔ Section**
  toggle — flow renders the whole arrangement (repeats expanded,
  `Chorus · 2/3` pass labels), lights + auto-scrolls the current line,
  floats the active pass's chords over the words, and renders even with
  no playback at all (the rehearsal face for verifying the form from the
  words alone). Section mode is unchanged (and still the default in the
  toggle's persistence: first visit opens in flow). **Playhead follow
  (2026-09-24):** the Song text view now follows the track — the spine's
  transport drives it on the lyrics route like everywhere else (the
  transport is a silent position clock by design; Ableton owns the
  sound). The playing block lights with a `▶`/`⏸` chip + its pass number
  (`▶ 2/3`), the current line highlights with an accent bar and
  auto-scrolls into view, and the block's authored progression shows as
  a live **chord mini** (`I · F`) that advances as the loop plays —
  clickable into its harmony tools; the ♪ hex readout lights the
  sounding cell and the chord chips ring in sync. Derived per tick as a
  minimal play-position, applied only on line/chord changes
  (`songTextPlayback.ts` + shared `chordSlots.ts` — one slot
  implementation shared with the popout, so the two readouts can't
  drift).
- **P4 (partly done 2026-09-21)**: the top tabs + identity header retired
  — views live in the left rail, the Library became a view, the spine
  chip carries identity. **SVG icon pass shipped the same day**
  (`components/common/Icon.tsx`: views rail · inspector facets · spine
  strip — every placeholder glyph in the shell chrome replaced).
  Remaining: arrangement lanes (chord /
  melody contour / groove / bend — **no lyric lane, vetoed 2026-09-21**);
  maps · recipes · templates live in the Library view; library drag-ins.
- **Phase A — shared time foundation (started 2026-10-17)**: time is now a
  first-class UI object instead of per-component state. Two stores under
  `apps/trackdraft/src/store/`:
  - `timeViewportStore` — one scale (px per **bar**, preserving the
    bar-linear axis) and scroll position (stored in bars, so it survives
    zoom) per depth: `song` (spine/studio) and `section` (drums and every
    future layer editor). Scale + snap persist; scroll hands off between
    views. Wheel and **two-finger pinch** share the same anchored math
    (`lib/time/timeMath.ts`), and pinch cancels any in-flight single-pointer
    gesture in the Blocks editor.
  - `timeSelectionStore` — the one section-relative beat range
    (`sectionId · startBeat · endBeat · lanes`). The drums range store is
    gone; the Blocks marquee, the workbench line view, and future harmony/
    melody layers all read the same selection, and a range can never leak
    into a different section.
  Exit test for the next slice: the section workspace renders harmony,
  drums, bass, melody and lyrics rows against this shared ruler, and a drag
  in one row is visible in the others.
- **Phase B — the section layer stack (2026-10-17)**: the Workbench's rows
  are now one grid. A fit-to-width `SectionGridProvider` gives every row the
  same bar/beat geometry, and `SectionTimeRuler` is the single pointer
  surface: click a bar to seek + select it, drag to select a range,
  double-click to clear. Time-aligned **broad faces** sit above each
  element's existing detail editor — drums (six-lane hit dots), harmony (the
  progression as it plays), melody (contour), lyrics (timed line blocks) —
  and the selection band appears in all of them simultaneously. Clicking a
  chord selects that chord *and* its beat span, so the drums row highlights
  the same time and the ♪ facet opens. The detail faces are unchanged, so the
  classic drum line view, the chord wheel, the melody staff and the lyric pad
  keep their behavior; `open →` still dives to the full editor. The stack is
  an overview (fit to width); the shared `section` scale still governs the
  detail editors. No keyboard shortcut is required for any of it.
  Follow-up (2026-10-18): **all six elements now have a face.** Bass and Color
  were the last two rows still showing only their controls, so the ladder's
  order (Drums → Bass → Chords → Color → Melody → Lyrics) existed in the
  markup but not on the timeline. `layers/BassFace.tsx` and
  `layers/ColorFace.tsx` plan their notes with the *same* functions the
  exporter, live MIDI out and the Ableton bridge use (`planBassStem`,
  `planColorStem`) and render them through one shared `StemFace` roll, so a
  face can never promise something the export wouldn't play. Both are thin:
  the row's controls (`bassProfile`, `colorFlavor`/`colorOctave`) stay the
  source of truth, and the face only answers "what will sound, and when".
- **Phase C — melody auto-fill + Bend depth (2026-10-17)**: the Melody layer
  now has a corpus-driven auto-fill. `@platform/progression-engine`'s melody
  model (1.42M melody points, shipped as a 1.8 KB table) rides the section's
  resolved chord stream, and the Mix/Bend's Melody group grew from one axis
  to six: **Contour** (conjunct ↔ disjunct, both halves implemented),
  **Density** (notes per chord), **Register** (octave), **Rhythm**
  (on-grid ↔ syncopated), **Motif** (through-composed ↔ repeat the opening
  phrase) and **Space** (continuous ↔ airy). Generation is deterministic per
  seed + Bend; the track stores `source`, `seed`, `params` and
  `contourApplied`, so the UI can show "◆ Rebuild from Bend" instead of
  silently rewriting a line, and the export stem never applies contour
  twice. Auto-fill is available in the Melody row and the Melody view; a
  recorded line can be replaced explicitly. Melody-only bends no longer
  reseed the drums (`hasBend` now means "a drum axis is off neutral").
  Note-level editing lives in **`MelodyNoteEditor`** (pointer/touch first —
  tap the grid to add, drag to move, drag a note's edge to resize, drag the
  velocity lane, `✕ Delete`): it runs on the Melody workspace and inline in
  the Melody row (Staff | ✎ Notes), snapping to the same `QuantizeGrid`
  vocabulary as capture. Hand edits mark the line `source: "edited"`, drop
  the raw capture so the quantize knobs can't silently undo a drag, and set
  `contourApplied` — the drawn line is what exports. Every gesture is one
  song-store write, so the header's Undo steps back through them.
  Two whole-line moves sit in the same toolbar: **Octave −/+** (refused at the
  MIDI range edges instead of clamped) and **Sits on** — the key's degrees as
  roman numerals cased by triad quality (`I ii iii IV V vi vii°`). Clicking a
  degree transposes the line diatonically so its first note lands there, by
  the shorter route so the register stays close; notes outside the scale keep
  their alteration above the new degree (a raised 4th stays raised), and the
  range readout (`C3–F#5`) shows where the line landed.
- **Phase D — harmonic rhythm (2026-10-17)**: the Chords row and the Harmony
  workspace gained a **rhythm strip** under the progression. A section's chord
  list is one pass through the progression (every generator loops it to fill
  the section), so the strip shows one cycle: each chord sized by its `beats`,
  bar lines as a yardstick, and the repeat count for the section
  (`4 bars cycle · ↻ ×2`, amber when the last pass is truncated). Dragging the
  boundary between two chords **trades beats between them** — the cycle length
  is preserved, so the repeat rate doesn't drift — snapped to a half beat.
  Dragging the **cycle end** resizes the *last* chord, which re-times the loop
  instead: the header updates live ("4.5 bars cycle · ↻ ×1.778, last pass
  truncated"), and the strip pins its horizontal scale for the duration of the
  gesture and scrolls itself when the cycle outgrows the panel, so the handle
  never runs away from the pointer. The
  `2 bars / 1 bar / ½ bar` presets give every chord the same share, which
  *does* change the cycle length (and syncs the section's `beatsPerChord`).
  Because the drums, bass, color and melody stems all resolve chords through
  the same `resolveChordOccurrences`, changing the harmonic rhythm moves every
  layer at once — the spine's chord chips, `Bts/ch` and the fit status all
  follow without a reload. When a meter outline governs chord timing (the
  drums/Bend grid), the strip is read-only and says so rather than offering a
  drag the generator would ignore.
- **The strip can add a chord (2026-10-18)**: it could reorder, re-time, voice
  and effect a chord, but there was **no add control anywhere on it** — the
  only way to get a new chord was to click an empty hex in the wheel — and
  the remove `✕` only rendered on a selected card at least 34px wide, so in
  the workbench's compact strip it could never appear. `+ chord` now appends a
  copy of the last chord (same voicing and effect, section defaults) and
  selects it, and `✕` shows on any selected card at any width. `+ chord` is
  hidden when chord timing follows the meter outline, where a chord's `beats`
  is not what plays.
- **The wheel re-roots at a modulation (2026-10-18)**: the flat map's cells
  are scale degrees (`degreeAt = (3q + r) mod 7`), which only means anything
  relative to *one* tonic — so after a key change the wheel was still
  measuring every chord against the old home, and a modulation could only
  ever look like borrowed chords. `lib/harmony/tonicWalk.ts` continues the
  walk from the same cell **translated by (3, −2)** at every region boundary
  — a vector the lattice maps onto itself (3·3 − 2 = 7 ≡ 0 mod 7), so every
  cell still reports exactly the degree it was placed at and the
  neighbourhood stays a valid hex neighbourhood — while on screen it is ~3½
  cells right and 3 cells up, i.e. visibly new ground. The wheel also derives
  each chord's degree from its **root measured against the home in force at
  its own beat** (`degreeRelativeTo`) instead of the authored numeral, which
  is the only reading that is correct after a change of key. A dashed guide
  plus a `→ G` label marks each seam. Verified with `C F | G D` (authored
  regions C@0, G@8): step 3 lands on a *different* hex from step 1 (pixel
  `(117.8, −102)` = exactly `2√3·S, −3S`), labelled `I / G`, and step 4 reads
  `V / D` — the same two chords that would have been `I` and `II` in C. Known
  Follow-up (2026-10-20): that limit is closed. Unwalked **choice** cells
  take the home of their nearest walked step (`regionOfCell`), so the degrees
  offered beside a re-rooted region read in *that* region's key — a C chord
  next to the G region is `IV`, not `I`, and `F#m` appears as `vii` — and
  clicking one adds the chord **its own home** would build there, which is the
  thing that would otherwise silently write the old key's chord. The depth
  mode's frontier uses the region the next chord would land in. Verified on
  `C F | G D` with C@0 / G@8: the five placeholders around the shifted region
  read `ii/Am`, `IV/C`, `vii/F#m` (G's degrees) while those around the first
  region keep `iii/Em`, `vi/Am`; clicking the `IV` placeholder appended
  `IV: Cmaj` (C, not F) and its chord menu then offered `ii·Am`, `I·G`, `V·D`.
  Cells exactly equidistant from two regions take the earlier one, so the
  key the progression starts in wins the contested band.
  Loop and 3D modes agree with Linear on every case checked.
- **Borrowing is judged per home, not per song (2026-10-19)**: three places
  measured every chord against one key, so a modulation made them lie.
  `borrowedChordIds` / `chordHomes` (`lib/harmony/modeInference.ts`) give each
  chord the home in force at its own beat, and the consumers follow: the
  progression editor's borrowed dot (its title now names the local home and
  where it starts), the **mode-inference card** (which ran on the *foreign*
  chords only, so a modulation no longer triggers "set section to <mode>" —
  that suggestion was the bug in its most visible form), and the chord
  editor's substitution menu, which now offers the degrees of the local home
  (`D` in G reads `V`, and its menu lists G's `iii · Bm`, `vi · Em`,
  `vii° · F#dim`). Verified A/B on `C F | G D`: with no regions `D` is marked
  "borrowed — outside C ionian" **and** the mode card appears; with regions
  authored at C@0 / G@8 both are gone, and a deliberately outside `♭VI` chord
  in the second region is still flagged ("outside G ionian (the home from
  beat 8)"). Checked and found already key-agnostic: `detectBend` and
  `colorStem` never read the key, so the Bend/colour axes needed no change.
- **Phase D — chord voicing (2026-10-17)**: a second lane under the rhythm
  strip gives every chord a **bass tone** (R / 1 / 2 / 3 — one click cycles)
  and a **spacing** (close / open — one click). Both are stored minimally
  (`voicing?: { inversion?, spread? }`; root position with close spacing is
  simply absent, so untouched songs keep their exact JSON), and the musical
  result comes from `@music-theory/core`'s `voiceChord`, which re-expresses a
  chord as (root, intervals). The .mid export, live MIDI out, the
  HoneycombWheel audition and the Ableton bridge's clip planner all call it,
  so a voiced chord sounds and exports identically in all four — the bridge's
  chord-clip test asserts the same pitches the app's export test does.
- **Phase D — one progression editor (2026-10-17)**: the chord cards, the
  voicing lane and the effects lane merged into a single time-aligned stack —
  `ProgressionEditor`, replacing `ProgressionTrack` + `HarmonicRhythmStrip`.
  Tap a card to select, drag a card to reorder (a caret shows the drop), drag
  a boundary to trade beats, drag the cycle end to re-time the loop. Reorder
  is plain pointer math (no drag-and-drop library) because the editor already
  owns a capture-based gesture system — two systems over the same pixels is
  what made reorder and resize fight. The voicing and effects lanes are
  **collapsible**, and the choice persists (`trackdraft-progression-lanes`),
  so the workbench row stays slim while the Harmony canvas opens everything.
  `ProgressionTrack` and its `dnd-kit` sortable are deleted.
- **Phase D — the wheel tells the truth about chords (2026-10-17)**: two
  fixes to the honeycomb. It labelled every cell with its degree's *diatonic*
  chord, so an E major on degree 3 read `iii / Em`; the label now comes from
  the chord that actually landed there (falling back to diatonic only on
  unwalked choice cells). And a cell is a *degree*, so same-degree chords
  (Em → E, VI → bVI, I → Imaj7) reused one hex and read as a repeat — they
  now stack as **variant chips** inside the hex (`I | Imaj7`), with
  `walkVariants` grouping steps per cell and disambiguating chips that share a
  numeral by suffix. The step badge lists the visits that reached the cell
  (`1·3`), with the full list in its `<title>`.
  A zoom control (24–56 px, persisted in `trackdraft-honeycomb-scale`) gives
  stacked cells room. Next: a contour view mode for runs and modulation, then
  modulation layers (which need a decision: inferred vs authored tonic).
- **Phase D — Depth view (z = time) (2026-10-17)**: a third wheel mode.
  Each step gets a depth equal to its position in the sequence and the
  projection shears by it (`lib/harmony/depthView.ts`), so every chord has its
  own screen position and the path is monitone along depth — repeats advance
  instead of stacking on one hex, runs stop doubling back, and a modulation is
  a lattice step taken at a new depth. The shear is deliberately **not** a
  lattice direction (`shearIsSafe` asserts no two `(q, r, z)` collide), depth
  mode draws smaller hexes (`DEPTH_CELL_SCALE`), older steps fade to 35%, and
  the add-a-chord choices sit on the next plane so adding reads as stepping
  forward. Long progressions scroll horizontally at a fixed cell size. This
  subsumes the planned contour mode; modulation **layers** are now optional
  (key-signature regions) rather than the linearity fix.
- **Repeats read as a sequence, not a count (2026-10-18)**: the flat wheel
  cannot advance a revisit — a hex's six neighbours hold the other six degrees,
  so a return to a chord the progression has already played has nowhere to go
  and used to fold into the same cell behind a `×2` badge. `visitBeads` now
  gives **each visit its own numbered bead** in a row under the chord label
  (spread `min(11, 1.2·S / visits)`, i.e. still inside the hex) and the walk
  path threads those beads, so `I–IV–IV–V` and `I–vi–I` both read as a
  sequence; cells visited once keep their single step badge. Numbered beads are
  suppressed in Depth mode, which already gives every step its own hex — that
  remains the honest "one hex per chord" view for long progressions.
- **Phase D — 3D scene experiment (2026-10-17)**: a fourth mode next to the
  wheel, deliberately **not** hexagonal — a rectilinear space where
  `x` = scale degree, `y` = chromatic alteration (b / ♮ / #) and `z` = time.
  Boxes rather than hexes because this view is testing the concept, and a
  square grid makes the three axes unambiguous: a diatonic run climbs x, a
  borrowed chord lifts y, and a repeat steps deeper in z. `lib/harmony/scene3d.ts`
  is a hand-rolled orthographic pipeline (yaw/pitch rotation, projection,
  painter's-order face sorting, normal shading) with 13 tests; no 3D library.
  Drag orbits, wheel/pinch zooms, shift-drag pans, Reset returns to the
  three-quarter view; the camera auto-fits once per content change (never
  mid-gesture) and centres on the walk's centroid, so tilting keeps the music
  in frame. Tapping a box selects that chord. The honeycomb and its Depth mode
  are untouched. Second pass (same day): **accidental tiers** — the y axis now
  shows explicit `♭ / ♮ / ♯` lanes (only the diatonic tier gets a plane; the
  outer tiers are two edge lines, because three filled slabs read as stacked
  floors and drowned the boxes); **beat-height boxes** — a chord's box height
  is its length in beats (`boxHeightForBeats`), so harmonic rhythm is visible
  without reading a label; and a **ghost trail** — older chords dim to 40% so a
  run leaves a visible wake behind the current chord.
- **Phase D — the canvases follow the transport (2026-10-18)**: the harmony
  workspace now subscribes to the transport and resolves the chord under the
  playhead through the same `resolveChordOccurrences` the generators use
  (`useActiveChord` + `activeChordIdAt`), so every mode marks what is
  sounding: a ring in the wheel, a lit box and a `▶ now` marker in 3D, the
  active card in the segment editor. Two bugs fell out of the same session:
  the dock's view-mode row didn't wrap, so the fourth mode ("3D") was pushed
  off the rail and looked like nothing had changed; and note that playback is
  **rAF-driven** — a backgrounded/hidden tab gets zero animation frames, so
  the playhead (and therefore any highlight) freezes until the tab is
  visible again.
  Follow-up (2026-10-18): the mode switcher also sits **on the canvas**
  (top-right) as well as in the dock, because the inspector rail is narrow
  enough that the fourth button could still wrap out of sight; and each
  accidental tier in the 3D scene shows its **occupancy count** (`♭ 0 · ♮ 4 ·
  ♯ 0`), which keeps a diatonic-only progression honest — nothing looks
  stacked because nothing left the tier. A borrowed chord (`♭VI`) was verified
  to drop its box onto the ♭ lane. **Modulation still cannot show**: the
  schema holds one key/scale per section, and a modulation to the dominant
  keeps every chord diatonic to the *new* key, so nothing leaves the ♮ tier.
  Key changes need a tonal-centre concept (per chord or per region) — the next
  step if this scene is to earn the axis it was built for.

- **Tonal centre — inferred, editable (2026-10-18)**: the schema holds one
  key/scale for the whole song and a section has none of its own, so a
  modulation was unrepresentable: every chord was measured against the same
  tonic, which is why the 3D scene's y axis could only ever show borrowing,
  never a key change. `lib/harmony/tonic.ts` introduces a **tonic region** —
  a run of the section with one home note — and infers them from the resolved
  chords with the Krumhansl-Kessler profiles (the same ones the audio key
  estimator uses). Three details make the inference usable rather than noisy:
  a 16-beat window (two chords is ambiguous — `G–C` fits both keys), **hysteresis**
  (a new home must beat the current one by more than 8%, so equal fits stay
  put), and a **chord-root tiebreak** within 2% (a progression loop usually
  lands on its own tonic). Runs shorter than two bars fold into the region
  before them, so a borrowed pair of bars is not a modulation. The *mode* is
  never inferred — only the home note; the scale stays authored. The scene now
  measures every box against the home in force at its own beat
  (`degreeRelativeTo`) and prints the trail (`home C ionian → G ionian @7`),
  so a C chord reads `I` before the modulation and `IV` after it.
  Follow-up (2026-10-18): the regions are **persisted and editable**. The
  section carries `tonicRegions` (schema in `@music-theory/song-blueprint`,
  next to the existing per-section `key`/`scale` overrides), stored regions
  win over inference (`effectiveTonicRegions`), and a `TonicStrip` under the
  canvas lists the homes in force — authored ones marked `⌂`, because a
  correction must survive re-inference. Two controls: **⌂ home from here**
  re-homes at the selected chord's root (a modulation is usually "this chord
  is the new I"), and **follow the chords** drops the authored list and hands
  the decision back to the key finder. Verified end to end: authoring G at
  beat 12 turns the V chord into `I`, persists to the song, and the scene
  readout follows (`home C ionian → G ionian @4`). Region consumers still to
  convert: the hex wheel (re-root the lattice per region), borrowed-chord
  flags and the Bend/colour heuristics, which all still assume one key.

- **Extended chord qualities (2026-10-22)**: the quality lane used to be ten
  triads and sevenths, with `extendedSuffix` as the catch-all for richer
  symbols. The catch-all didn't catch anything worth catching: export resolves
  intervals from `chord.quality` via `getChordIntervals`, so an imported
  `C7#9` displayed correctly and **exported as a plain `C7`**. Exports now
  come from a 34-entry `CHORD_INTERVALS` table, so the quality *is* the
  interval set: `Cmaj9` is five notes (C E G B D), `C13` six, `C5` two. Upper
  extensions sit above the octave (14 = 9, 17 = 11, 21 = 13) so the stack stays
  root-anchored and the existing inversion math works untouched — the voicing
  lane now names the real bass tone (`ninth`, `♯9`, `thirteenth`) instead of
  counting to "fourth" and stopping.
  The editor's Quality row groups the vocabulary the same way the table does
  (Triads · Sevenths & sixths · Altered dominants · Extended). Triads and
  sevenths stay visible; the last two sit behind `+ 9 · 11 · 13 · altered` so
  the dock keeps its height — unless the selected chord is already one of
  them, in which case that group renders, because a picker that hides the
  current value is a picker you can't trust.
  Two invariants are now compile-checked rather than remembered:
  `CHORD_INTERVALS`, `CHORD_QUALITY_SUFFIX` and `CHORD_QUALITY_GROUPS` are all
  keyed by `ChordQuality`, so a new quality can't exist without intervals, a
  round-trippable symbol, and a chip to reach it; and `parseChordQuality` is
  the single suffix parser behind `parseChordName`, `honeycombTextToChords`
  and the importers. `extendedSuffix` now only holds suffixes the vocabulary
  cannot (e.g. `7#9b13`), which still export the base quality's intervals —
  documented, and pinned by a test.

- **The pitch axis is a chromatic ladder (2026-10-24)**: the floor used to
  draw seven degree rows with `♭ / ♮ / ♯` tiers stacked above and below the
  floor — which meant a sharpened chord floated in the air instead of sitting
  next to the note it lives beside, and an accidental was reachable only from
  a menu. The axis is now the **twelve semitones of the octave**
  (`STEP_W`, `LADDER_STEPS = 12`, `Node.step` = semitones above the tonic):
  the seven scale steps are the destinations — solid rules, labelled with
  their numerals — and the five rows between them are reachable but quiet
  (thin dotted rules, no label). Dragging a box up or down walks the ladder;
  ⌥-lane-dragging is gone because pitch *is* the row now. `ROW_SHARE` is
  divided by twelve, so a plate that used to show seven comfortable rows
  shows twelve shorter ones — hence a stacked band drops its tension strip
  (a quarter of its height for a strip too small to read) and grew 262 → 306px.
  Spelling became data: `Chord.spelling` (`"sharp" | "flat"`) pins ♯III
  against ♭IV, which are the same pitch and different numbers. The floor
  writes it from the direction of arrival (up = sharpened the row below, down
  = flattened the row above), from the half of a chromatic row that was
  clicked, and from the right-click menu's `spell` row (♯i / ♭ii). Names that
  would need a double accidental — B in D aeolian as `♭♭VII` — are dropped,
  so the menu only offers readings worth writing. Two long-standing
  spelling bugs fell out of the same pass: modal numerals now come from the
  mode's own label, so aeolian prints `♭VI`/`♭VII` instead of `VI`/`VII`, and
  absolute names follow the *net* accidental (a ♯ on the mode's ♭III cancels
  to the natural third, so F# is never printed Gb). `degreeRelativeTo` keeps
  its shape — the store is still just `root` — so export, playback and
  transposition never see any of this.
- **Rehearse reads as a chart (2026-10-25)**: the desk was four stacked
  blocks — a form list capped at eight entries, Now/Next cards, a controls row
  and a per-section bar grid that wrapped at eight columns. A player on a
  stand reads the *tune*, four bars to a line, so the desk is now one chart
  (`StudioChart` over `layoutChart`): section letters with their names and
  repeat counts, real bar rules, `%` where a bar repeats the one before it,
  the sounding chord restated at the top of a bar whose change lands late,
  meter written only where it changes, and a cursor that follows the
  transport. Bar numbers sit in the margin, chords carry their numeral under
  the symbol, and `@media print` hides the app so the chart prints as paper.
  Everything positional comes from `layoutChart` (12 tests), so the component
  only decides about type sizes — and the chart's names come from the
  analysis, not from re-spelling the chord: a first cut printed `A#` for ♭VI
  because it built names from `chord.root` instead of the transposed,
  net-accidental analysis.
  The transport under it is real: play/stop drives the app's (silent) clock,
  `loop` plays the focused section on a loop region, and `count-in` clicks a
  bar before the playhead starts. The click is MIDI — the app has no synth, so
  it goes out on the drum channel of the selected port and says so when no
  port is configured. Those three toggles used to be local state that
  controlled nothing.
- **Section structure lives on the ruler (2026-10-25)**: the harmony floor is
  where a form gets edited, so the selection surface is the floor's own bar
  ruler, not a second timeline. Bars carry `data-ruler-bar`; a pointerdown
  starts a sweep and the sweep reads the bar spans captured at that moment,
  resolving the pointer's bar by **x**. Hit-testing (`elementFromPoint`) was
  the first implementation and it was wrong: the edit chip that appears on
  pointerdown sat on the ruler row, so it swallowed the pointer and every drag
  stopped at the anchor bar. The chip floats just under the ruler
  (`top-6`) so the labels stay readable, and holds the verbs — `separate`,
  `merge next`, `rename`, `×`. Two rejected designs stay rejected: stacked
  per-section bands (unreadable at twelve rows) and a separate
  `SectionTimeline` strip (a second copy of the same time axis).
  Renaming is one component (`SectionNameInput`) in both the band and the
  chip, so the same field means the same keys: Enter or leaving the field
  keeps the name, Escape throws it away.
  Detection got a coarsening pass for the same reason. Layla's 87-chord block
  read as 18 look-alike parts at fine grain and 9 at medium because a vamp
  that plays 4-4-5 bars cannot be a `repeats` run (`sameDurations` refuses the
  fold). Neighbouring sections of the same material are now **stitched while
  the stitched span still recurs** in the stream — the guard is what keeps two
  coincidental look-alikes apart — which reads Layla's block as 12 parts
  (fine) and 6 (medium, first section 15 bars), matching "a 16-bar vamp then
  the same thing again" rather than nine stumps the user had to merge by hand.

## 8. Defaults chosen (veto-able)

- Level-1 rows = **rich previews with light actions**, not lite editors
  (avoid maintaining two editors per element; full power one click down).
- Element stack order: **Drums first** (the clock) → Bass → Chords → Color →
  Melody → Lyrics pinned last (annotation).
- Rail scope defaults: Song at Arrangement, selected Section elsewhere.

## 9. Non-goals (for now)

Infinite freeform canvas (the ladder beat it — time stays the axis); in-place
editor embedding before P3; no tab removal until its home is live.

## 10. Chrome trim (2026-10-24)

Three lanes were carrying nothing the next one down didn't already say.

- **The Drums view has one surface.** "Classic is read only, Steps is
  obsolete, Blocks is THE view" — so `/song/:id/drums` renders
  `DrumsTab` → `DrumBlocksView` and the Classic/Steps/Blocks switcher row
  (plus the `trackdraft-drums-view` preference) is gone. The Classic
  renderer survives *only* as the Workbench's embedded Drum Line
  (`<DrumsView embedded />`); `steps/DrumStepsView.tsx` is deleted.
- **⤓ Import analysis moved to the spine strip**, next to ＋ Add section.
  It is section-scoped like every other control there (it stages a draft for
  the *selected* section, Apply keeps / Revert discards), and its result
  reports inline in the strip — success summary or the exact parse error,
  click to dismiss. `ImportAnalysisButton` is the one implementation.
- **Both rails start minimized.** `NavRail` (36px glyph strip, current view
  lit) and `InspectorRail` (36px, facets as glyphs; clicking one opens the
  rail *on* that facet). The old "slides open on every section selection"
  rule is gone: it made "minimized by default" impossible to keep, and the
  glyph strip already says what it does. Opening is now a facet click or an
  explicit `engage(tab)` from a surface that means "edit this now" (spine
  chord → ♪, workbench drums row → ▦, melody generator → ◉).

## 11. Groove as glue (2026-10-23)

The pocket machinery had been in `@drum/library` since the corpus landed —
`extractGroove` / `applyGroove` — but only ever ran *inside* the drum
pipeline (`humanizeOutlineNotes`). The bass and the harmony were planned on
the grid while the drums sat behind it, and the euclidean-harmony lock lived
only in the Harmony inspector. Both are now one visible control on the drum
surface.

- **Engine seam** (`packages/drum-library/src/groove.ts`): `drumPocket()`
  measures a section's one-bar pocket from the notes that will actually play;
  `glueToPocket()` imposes it on any part's notes (time and velocity move;
  pitch and duration survive; unplayed slots are left alone);
  `pocketSummary()` turns a pocket into the "−4 ms behind · 18 slots played"
  line.
- **Schema**: `BlueprintSection.grooveGlue?: { bass?, chords?, strength? }`.
  Absent ⇒ byte-identical to the pre-glue pipeline.
- **Both exporters glue with the same two calls** — the app's `midiExport`
  (which the live MIDI out reuses) and the bridge's `chordClips`/`bassLine`
  via `glue.ts` — over the same shared drum planner, so preview ≡ .mid ≡
  live-out ≡ Ableton by construction. Five tests in the app pin the note
  moves through the real planners; five more pin the engine seam.
- **The control**: a `⛓ GLUE` chip in the Blocks header. It shows the pocket
  readout live, then three clickable decisions — *put the bass in it*, *put
  the chords in it*, *strength* — plus the harmony rhythm (`BEATS · EUCLID ·
  DRUMS`), which is the euclidean-harmony lock surfaced where you can hear
  the drums you are locking to.

Honest caveat, and the reason the readout matters: most synthesized presets
are exactly quantized (mean offset 0 ms), so glue is a no-op there and the
chip says "on the grid". It bites on the corpus presets (54/68/trap), on any
section whose Bend *feel* is off-centre, and on outline sections — which is
precisely where the parts used to fight the drums.

## 12. Lane mute / solo (2026-10-23)

The drum surface had no mixer state at all. Now each of the six lanes carries
**M** and **S** in the gutter, and — because the filter runs inside the
shared `planSectionDrumNotes` — a muted lane leaves the preview, the `.mid`,
the live MIDI out AND the Ableton clips together.

- **Schema**: `drumLaneMute[]` / `drumLaneSolo[]` on the section (lane keys,
  not voices — the lane is what you see).
- **Engine**: `audibleLanes(mute, solo)` is the single rule (any solo ⇒ only
  soloed lanes; a muted lane stays silent even when soloed), and the planner
  drops the notes by pitch → lane. Both exporters pass the section's fields
  into it, so there is no second implementation to drift.
- **Canvas**: `resolveSectionLaneHits` applies the same `audibleLanes` set,
  so a dimmed row is a row the export drops — the cells actually empty out
  rather than merely greying. Tests: 4 in the library (rule + planner, both
  the variant and blocks-only paths), 3 in the app (through `planDrumStem`).

## 13. Per-lane MIDI CC (2026-10-23)

Each lane can carry one controller, ramped across the section — hat openness
(CC4), filter cutoff (CC74), expression (CC11), volume (CC7), anything.

- **Schema**: `drumLaneCc?: Partial<Record<DrumLaneKey, { cc, from, to }>>`.
  `from === to` means a static device setting (one message at the section
  start); otherwise the value ramps, `perBar` messages per bar.
- **Engine**: `planLaneCc` in `@drum/library/src/cc.ts`. Pure and
  deterministic, and it skips muted / un-soloed lanes with the SAME
  `audibleLanes` set the notes use (now a shared module, `lanes.ts`, so
  there is exactly one mute/solo rule in the package).
- **Carriers**: the `.mid` (CC events on the drum track, moved by
  `outputOffsetBeats` like the notes) and the live MIDI out (scheduled by the
  same clock window as notes, on the drums channel). Tests: 6 in the library,
  4 in the app — the last one scans the written SMF bytes for `0xB0|ch`.
- **Known divergence, documented in the schema field**: the Ableton
  Extensions SDK exposes no clip-envelope API, so "Send to Ableton" sends
  notes only. The CC lines arrive when the `.mid` is imported into Live.
- **UI**: a `CC` chip beside M/S in each lane gutter (lit + tooltip
  `CC4 · 0→90` when set) opening a small panel: controller number (with a
  name hint: foot/hat, volume, expression, cutoff…), FROM, TO, SET, CLEAR.

## 14. Two more kit voices (2026-10-24)

The kit grew from 13 voices to 15: **shaker** (GM 82) and **cowbell** (GM 56),
both in the PERC lane — which is what makes the VOICE step parameter earn its
place (PERC now cycles rim → clap → shaker → cowbell).

Adding a voice touches seven tables, and `kit.ts` lists them at the union.
Two of them are exhaustive `Record<KitVoice, …>`, so the compiler catches
those; the arrays and the pitch map are now pinned by
`packages/drum-library/test/kit.voices.test.ts`:

- every voice belongs to exactly one lane
- every voice has a pitch and `voiceOf(pitch)` reads back as that voice
- no two voices share a pitch
- every fallback points at a voice that exists

That test immediately caught a **pre-existing** bug: our TOM HI exports on
pitch 47 (`ABLETON_SAFE_NOTES.tomHigh`), but the General MIDI reverse map
called 47 "tomMid" — so an authored TOM HI read back as TOM MID, and any
edit that re-authored a *resolved* hit silently changed the voice. The
reverse map now follows the kit, not the spec (documented at the entry).

## 15. Gesture layer — drawing the detour (2026-10-24)

> **Superseded by §20 (2026-10-30).** The lanes now draw the export plan
> itself, so there is no gap left to narrate: `gestureLayer.ts` and its ghost /
> strike deltas were removed rather than kept as a second, already-equal
> opinion. The reasoning below still explains why a gesture is an OVERRIDE and
> not an addition, which is why the lanes had to change rather than gain an
> overlay.

The last truth gap in the Drums surface: the marker rail announced a detour or
transition, but the cells went on drawing the base groove. A handoff fill or a
detour is *not* an addition — a sparse detour in a 4-bar section plays 4 notes
where the grid draws 24 — so "ghosts on top" would have claimed 24 hits were
sounding. The layer is therefore a **window override**, drawn as two deltas in
the gesture's window only:

- **ghosts** — `planned − resolved`: what will play that the grid can't show,
  drawn as a bar at the hit's real velocity. Solid in lane colour when the
  gesture is the user's (authored detour / authored transition), dashed in ink
  when the planner chose it (auto transition, handoff fill).
- **strikes** — `resolved − planned`: a diagonal across the base hits the
  gesture takes over, so a cell that will not sound never looks like it will.

`gestureLayer.ts` derives both from the planners the app and the bridge already
share (`planDrumStem` / `resolveSectionLaneHits`), so it cannot invent a rhythm
neither of them plays.

Two traps, both found in the browser rather than in a test:

- **Windows, not the whole section.** The export carries the corpus's seeded
  micro-variation (~1/32 beat) while the canvas deliberately draws a plain
  tiling, so a beat-for-beat diff struck almost every cell in a section whose
  rail said "clean handoff". The diff is now restricted to the same windows the
  marker rail draws, and matched with `TOL = 0.08` beats.
- **The cache must be content-addressed.** Keyed on the section object it
  served the pre-edit `null` for the whole preview, so a freshly authored
  detour showed its rail chip and nothing in the lanes. The key is now
  `WeakMap<song>` → signature of every field that can move the window or the
  plan (pattern, variation start/bars/outline, transition model/bars, mute,
  solo). `useMemo` in the view is not enough on its own: `spans` is rebuilt on
  every render.

The plan is also fed the **preview draft** (`effectiveSection`), the same
overlay the rail uses — otherwise the rail shows a detour the lanes refuse to
explain. Cost is ~6 ms per section, paid once per edit and never mid-drag (a
velocity drag writes nothing until release).

Silent lanes are dropped from both sides: the canvas already dims a muted lane
and the planner drops its hits, so every cell would read as "taken over".

Deliberately **not** shown: velocity changes the gesture makes to hits that
survive it. The owner chose the plain override reading; a finer layer can be
added later without moving the data.

## 16. MIDI chord entry (2026-10-29)

The floor could only be written by clicking hexes and dragging beats; naming a
chord you were already holding, or playing the progression in time, meant
leaving the app. The **midi** tool on the Compose floor closes that loop.

- **Recognition** (`lib/harmony/chordRecognition.ts`) is pure: pitch classes in,
  root + quality out. The lowest sounding note is root evidence, the song's key
  is a soft tie-breaker, and a quality preference order settles exact ties
  (C–E–G–A with C in the bass reads C6, not Am7). One note is not a chord, so
  nothing is named until two are held.
- **The pad** (`MidiChordPanel`) listens to every MIDI input through
  `lib/playback/midiInput.ts`, which uses `addEventListener` (the ATOM SQ
  handler owns `onmidimessage`) and skips the selected output port's name, so a
  virtual bus like IAC cannot record the app's own click as input. The ATOM
  SQ's User-mode channels (10–17) are ignored. A 55 ms settle window means a
  3rd landing a few milliseconds late doesn't flash two chords, and the first
  note-on of the shape is the attack the take is timed from.
- **A chord at a time**: `place at playhead` writes a bar at the cursor through
  `insertChordAt`; `replace selected` swaps the selected chord's root/quality
  and keeps its length and rests. Both are one song-store write.
- **The take** (`lib/harmony/chordCapture.ts`): arm, count-in, click. Chord
  changes are timestamped against the transport's beat (walked back from the
  settle window), repeats merge, and change points snap to 1/8 · 1/4 · 1/2
  notes. The last chord ends where the player released (or the transport
  stopped), so a four-bar cycle played inside an eight-bar section stays four
  bars and loops instead of stretching its final chord. Nothing is written
  until **write progression**; a bad take costs one click and Undo takes it
  back like any other edit.
- **Clocks**: with the app's clock the panel runs its own count-in and Web
  Audio click (no MIDI output needed); with Live as the target it arms and
  reads Live's beats instead of pretending it can start the transport.

## 17. Drums: multi-section steps (2026-10-29)

Harmony stacks every section the spine has selected; the Drums Blocks view was
the last surface still reading only `selectedSectionId`, so a sweep across the
spine looked like it had done nothing here. It now reads the shared `selected`
set and draws a **combined step canvas**.

- **One canvas, section end to end.** `views` is the model: each selected
  section (song order, one entry each) carries its own meter, step grid, hits,
  gesture layer and marker rail. `barPx` is shared so bars line up, but the
  step subdivision is per section — a 3/4 bar keeps its six eighths beside a
  4/4 bar's eight. A section-name band sits above the ruler, bar numbers keep
  counting across seams, and the whole run scrolls.
- **Editable where it belongs.** A click toggles the step in the section that
  owns that bar (`withToggledStep` on that section), and a drag edits the
  velocity/param of the pressed cell in that section too. Editing a section
  moves the selection's **focus** (tools follow) without collapsing the set.
- **Range tools stay single-section.** Bar/lane ranges, the Selection
  Workbench, copy/paste, flatten and the velocity ops all describe one
  section; entering multi clears the range and the bars-per-view control is
  disabled ("every selected bar is on screen"). `focus one` returns to the
  familiar editor.
- **Bulk groove.** Picking a card in the groove shelf applies it to **every
  selected section in one song update** — one undo step — which is the verb a
  multi-selection exists for. M/S/CC remain per focused section.

## 18. Sequencer accuracy (2026-10-29)

A report that "the sequencer doesn't show the beat that plays" turned out to be
two different things — one real, one a confusing label.

- **The label.** A section whose `drumPattern` is set but not pinned resolves a
  **seeded variant** (`standard` has 69 baked takes; "Unlabeled" was playing
  v10). The groove shelf highlighted variant 1 of every pattern, so the card
  said one beat and the grid/audio played another. The shelf now receives the
  resolved `currentVariant`, draws that pattern's card from it in whole-kit
  mode, highlights it, and badges it (`v10`) — clicking the active card pins
  the variant instead of silently changing the performance to v1.
- **The transforms.** `resolveSectionLaneHits` (the AUTHORED pocket behind a
  step toggle) used to tile the raw groove and skip two structural export
  steps. It now mirrors the exporter: the Bend (`applyStyleToVariant` —
  backbeat inserts 2 & 4 snares, feel moves notes), the velocity preset
  (`styleVelocityTarget` + `scaleToVelocityPreset`), the seeded
  `tileGrooveVaried` (the deliberate hat gaps), the 4-bar cyclic development,
  and authored blocks. The lanes still drew a *pocket* the performance no
  longer played while a fill owned the final bar; §20 replaces what the lanes
  draw with the export plan itself.
- **Known limit, not fixed:** a section with a meter MAP still gets one average
  step grid (`stepGridFor` divides duration by bars), so mixed-meter sections
  cannot draw a beat-accurate bar grid yet.

## 19. Multiple MIDI outs for external hardware (2026-10-29)

"The MIDI out" was a single port id, so a rig with a drum module on one
interface and a synth on another could only reach one of them.

- **Per-stem ports.** `midiSettingsStore.stemOutputs: Partial<Record<StemId,
  string>>` overrides the master port per stem; absent/`""` means "same as the
  master", so every existing setup keeps working untouched. Settings → MIDI Out
  setup shows a port `<select>` per stem (default label *master port*), and the
  Sync facet summarises how many stems sit on their own port.
- **Master may be off.** The scheduler accepts a null master as long as at least
  one stem resolves (hardware-only rigs). `resolveStemOutputs` in `liveMidiOut`
  maps stem → `MIDIOutput`, every `ScheduledNote`/`ScheduledCc` carries the
  output it belongs to, and `allNotesOff` silences **every** port in use — not
  just the master — so stopping the transport cannot strand a held note on a
  second interface.
- **Every start site resolves outputs.** `transportControl` gained
  `resolveOutputs()`/`hasAnyOutput()` and all play paths (`playSong`, `seekTo`,
  `playSectionLoop`, `resumeUnlooped`, `playLoopRegion`, `liveRefresh` and its
  staged re-plan) pass the per-stem map; `MelodyView` does the same, and the
  MIDI setup panel's **Test** button plays on the stem's own port.
- **Auditions follow their stem.** `previewChord`/`previewProgression` send the
  chord, bass and color layers to those stems' ports, `auditionDrumHit` to the
  drums port, and the rehearsal **click** to the drums port too. Without this a
  hardware-only rig went silent while editing — the one moment you most need to
  hear the port you just picked.
- **Stale ports.** `useMidiOutputs` clears a vanished master id *and* every
  vanished per-stem id, so unplugging an interface falls back rather than
  failing silently.

## 20. The lanes draw the performance, and a playhead (2026-10-30)

§18 closed the *label* gap and most of the transform gap, and left the last one
visible: the lanes drew the section's pocket for the whole section, so the bar
the automatic fill / transition had taken over showed hits that never sounded.
The view annotated the difference (a "gesture layer" of ghost bars and strike
marks) instead of drawing the truth.

- **One source of truth.** `planDrumStem` was split into `planDrumSections`
  (per span, section-relative) + a thin `planDrumStem` flatten, and the lanes
  now bin those notes (`laneHitsFromNotes` → `resolvePlayedLaneHits`). A dot is
  now a note the exporter writes: fills, transitions, handoff fills, the
  post-fill crash and the outline humaniser's micro-timing all included. The
  whole song is planned once per edit (≈4 ms for a 13-section song) because a
  handoff fill is decided across the seam — a section planned alone would draw
  a different last bar than the one that sounds.
- **Editing is unchanged.** `resolveSectionLaneHits` stays the AUTHORED pocket
  (groove + blocks) and `stepToggle` still reads it, so clicking a cell writes a
  step into the section's own material rather than trying to rewrite a
  generated fill. The ghost/strike gesture layer is gone — it existed only to
  narrate a gap that is no longer there; the marker rail still names the
  detour/transition windows.
- **The playhead.** The canvas subscribes to `getSongTransport().onTick` and
  draws a full-height rule (ruler → lanes) with a triangular head, resolved by
  section IDENTITY (`tick.sectionId` + `occurrenceIndex`) so editing the
  arrangement mid-playback cannot move it to the wrong section. It dims when
  stopped, follows the viewport while playing, and hides when the tick belongs
  to a section the canvas is not showing (the spine still marks it "Now
  playing").

## 21. A door to the popout from the workbench (2026-10-30)

The lyrics/chords popout never went away — the route
(`/song/:id/popout`, `LyricChordPopout`) and the window were intact, but its
only launcher was a row buried in Settings, so it read as "lost" (user report).

- `lib/popout.ts` owns the URL, the fixed window name and the window features,
  so Settings and the workbench cannot drift — and a second open focuses the
  first (`window.open` with a name).
- The **workbench toolbar** (the Section/Arrangement row) now carries a
  `lyrics & chords` button on its right. That is the surface where you play
  along while editing, which is exactly who the second screen is for.
- Pop-up blockers: the call is made straight from the click handler (not after
  an await), which is what browsers require; the tooltip says to allow pop-ups
  if the window does not appear.
