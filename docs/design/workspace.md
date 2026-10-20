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
auto-opens on any section-selection change, collapses to a 36px strip, and
`dockStore.ts` is deleted from the codebase. Wide surfaces went back to
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
  limit: the unwalked choice cells around a translated region are still
  labelled from the song's key, so their names are right for the first region
  only; the walked chords, the seam label and the home strip carry the truth.
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

## 8. Defaults chosen (veto-able)

- Level-1 rows = **rich previews with light actions**, not lite editors
  (avoid maintaining two editors per element; full power one click down).
- Element stack order: **Drums first** (the clock) → Bass → Chords → Color →
  Melody → Lyrics pinned last (annotation).
- Rail scope defaults: Song at Arrangement, selected Section elsewhere.

## 9. Non-goals (for now)

Infinite freeform canvas (the ladder beat it — time stays the axis); in-place
editor embedding before P3; no tab removal until its home is live.
