# TrackDraft Workspace — the ladder & the bands

Status: **direction frozen 2026-09-21** (user + Copilot brainstorm). Phase 1 implementation
started the same day (this doc + `Spine` v0 + the `/song/:id/workbench` route).
Related: `docs/ui-standardization.md` (the constitution — primitives, tokens, drift),
`docs/ui-audit.md` (the inventory), `docs/design/README.md` (the Design Lab loop).

The old model: six tabs, each owning its own chrome, chord wheel and drum
timeline as peers. The new model: **one workspace, one time axis, three
depths** — the tabs dissolve into *places you can be* in one song.

---

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
│  [Intro][Verse 1][Verse 2][Chorus]…   [▶ ⟳ undo · zoom · fit]│
├────┬────────────────────────────────────────────┬────────────┤
│ ▸  │                                            │ INSPECTOR  │
│ LI-│              THE CANVAS                    │ (slides    │
│ BR-│  line view · hex wheel · blocks grid · …   │  open on   │
│ ARY│                                            │  engage)   │
└────┴────────────────────────────────────────────┴────────────┘
   sources            the work             the focused object's tools
```

**The three menus, decided 2026-09-21** (user: "logically figure out where
those controls go and then I will stick with it"):

| Zone | Role | Contents |
|---|---|---|
| **LEFT** | **Library — the sources** | songs · maps · recipes (kits, presets later). A browser you pull FROM. Same on every view. |
| **CENTER** | **The canvas** | the view's visual: the drum line view, hex wheel + progression strip, structure cards, blocks grid, lyric pad. Tool chrome never lives here. |
| **RIGHT** | **Inspector — the focused object's tools** | facet tabs (≣ form · ▦ drums · ◉ mix, growing per instrument); **slides open on engagement** — selecting a section or clicking a canvas element opens it (manual collapse wins until the next selection change); collapses to a thin strip for canvas room. |
| **BOTTOM** | **retired** | the dock duplicated the rail's job and existed on some views but not others; the workbench's stub band duplicated the left library. Wide surfaces that want the bottom edge (harmony's progression strip) belong to the CANVAS, not a third menu. |

- The spine spans the **entire width, above the zones row** (user rule,
  2026-09-21: the left browser and right rail must never cut it off). The
  browser and rail live *below* it and can open/close freely.
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
in per-section mode and a pointer hint in song-text mode. Drum tools read
the shared studio selection directly.

| Piece | Home |
|---|---|
| Mix/Bend | stacks beneath Structure in the right rail as a **collapsible group** (open on demand) — the lens on the focus. |
| Structure right sidebar | becomes the rail's **Structure edits for the focused section** (the SectionCard editor ported: name/role/delete, TS, bars, beats/chord, repeats, drums+variant, velocity, transition note — v1 of arrangement editing; v2 mirrors these writes from direct manipulation on the spine). |
| Maps · genre recipes | **left Library tabs** (revised 2026-09-21 — was the bottom band): Songs · Maps (narrative + genre) · Recipes. Maps replace sections (confirmed); recipes seed genre + bend + tempo. |
| Harmony's two menus | **done (slice B)** — chord controls live **in the hex workspace**: progression strip + effect lane under the wheel, toolbox in the ♪ facet; the dock's section chips **died** (P2) — the ribbon is the single navigator |
| Drums dock | **retired (slice B)** — tools live in the ▦ facet; the classic line view stays as the level-2 canvas |
| Lyrics dock | **retired (slice B)** — rhyme/meter live in the ✎ facet (per-section mode gate) |
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
| Lyrics | lyric lane under the cards | lyric pad |
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
- **P3**: interactive section rows (loop, ◆ adopt, open); element embedding
  in place (editors mount under the persistent ribbon); spine grow animation.
- **P4**: tabs retired to focus presets; arrangement lanes (lyric / chord /
  groove / bend); maps · recipes · templates in the workbench band; library
  drag-ins.

## 8. Defaults chosen (veto-able)

- Level-1 rows = **rich previews with light actions**, not lite editors
  (avoid maintaining two editors per element; full power one click down).
- Element stack order: **Drums first** (the clock) → Bass → Chords → Color →
  Melody → Lyrics pinned last (annotation).
- Rail scope defaults: Song at Arrangement, selected Section elsewhere.

## 9. Non-goals (for now)

Infinite freeform canvas (the ladder beat it — time stays the axis); in-place
editor embedding before P3; no tab removal until its home is live.
