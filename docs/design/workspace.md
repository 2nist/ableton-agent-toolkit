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
Studio), not a view. **Labs** — Genre Workbench · Design Lab · the Puck
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
| Lyrics | **no lane — vetoed (user, 2026-09-21)**: words don't time-snap like notes; a lane would read as noise. Presence at L1 = the coverage gauge's lyrics segment + the block tooltip; the real surfaces are the section row and the pad | lyric pad + rhyme/meter tools |
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
  Remaining: melody in-place editing (needs the record/piano-roll
  plumbing); ◆ adopt; spine grow animation. **Done since (2026-09-21,
  same template):** the Lyrics row embeds the real pad (textarea +
  syllable gutter), the Bass and Color rows embed their full controls
  (BassSettings / ColorSettings), and the section header carries a loop
  action (the same `playSectionLoop` the spine's ⟳ uses).
- **P4 (partly done 2026-09-21)**: the top tabs + identity header retired
  — views live in the left rail, the Library became a view, the spine
  chip carries identity. **SVG icon pass shipped the same day**
  (`components/common/Icon.tsx`: views rail · inspector facets · spine
  strip — every placeholder glyph in the shell chrome replaced).
  Remaining: arrangement lanes (chord /
  melody contour / groove / bend — **no lyric lane, vetoed 2026-09-21**);
  maps · recipes · templates live in the Library view; library drag-ins.

## 8. Defaults chosen (veto-able)

- Level-1 rows = **rich previews with light actions**, not lite editors
  (avoid maintaining two editors per element; full power one click down).
- Element stack order: **Drums first** (the clock) → Bass → Chords → Color →
  Melody → Lyrics pinned last (annotation).
- Rail scope defaults: Song at Arrangement, selected Section elsewhere.

## 9. Non-goals (for now)

Infinite freeform canvas (the ladder beat it — time stays the axis); in-place
editor embedding before P3; no tab removal until its home is live.
