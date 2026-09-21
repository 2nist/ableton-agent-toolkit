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
│  THE SPINE — edge to edge, never squeezed                   │
│  ⌘ SONG · key · bpm   [Intro][Verse 1][Verse 2][Chorus]…  ▶ ⟳ ⇄│
├────┬────────────────────────────────────────────┬────────────┤
│ ▸  │                                            │  CONTEXT   │
│ lib│        SECTION rows / ELEMENT workspace     │   RAIL     │
│    │                                            │            │
├────┴────────────────────────────────────────────┴────────────┤
│  WORKBENCH — song maps · genre recipes · templates   (⇕)     │
└──────────────────────────────────────────────────────────────┘
```

- The spine spans the **entire width, above the zones row** (user rule,
  2026-09-21: the left browser and right rail must never cut it off). The
  browser and rail live *below* it and can open/close freely.
- The spine's left end carries the song chip (title · key · bpm), its right
  end the transport readout/controls — the old standalone header dissolves
  into it (P2; v0 keeps the legacy header above while the tabs still exist).
- The playhead sweeps the full width; descended, it can drop a vertical
  beat line through the workspace so every row stays time-anchored.
- The bottom workbench is a full-width band too: horizontal genre cards +
  narrative templates — **hovering a template ghosts the sections it would
  mint onto the spine** before committing.

## 3. The spine

- Rendered at two sizes from the same data: **cards** (arrangement) ↔
  **ribbon** (section/element). Clicking a card during the descent animates
  it growing into the section workspace — continuity is the make-or-break vs
  "six tabs again".
- Cards carry **material badges** = coverage map *and* doorways: chords /
  drums / melody / lyrics presence dots today; clicking a badge jumps to that
  element's section face for that section (P3).
- Carries the playhead + loop; `←→` steps sections when it has focus.
- **Timeline v2 (user-specified 2026-09-21, shipped P1.5):** fixed
  **bar-linear** scale — 10px/bar default, zoom 6/10/14/20 + fit — scrolls
  inside the full-bleed band; a **bar ruler** with adaptive labels doubles
  as **seek** (click a bar = jump playback there; paused/stopped starts
  from there); the playhead is pixel-exact per span with **auto-follow**
  while playing (wheel scroll disengages, the toggle re-engages). All
  controls live in a **compact icon-only strip ABOVE the timeline** —
  transport (play · pause · stop · section loop) + undo/redo, then zoom
  −/+ · fit · follow; nothing sits at the timeline's left or right ends.
  That strip is the seed of P2's collapsed header (the workbench already
  hides the legacy header transport so the two can't disagree). Blocks are
  true scale — a short song leaves an honest empty tail instead of
  stretching; labels and coverage dots render only when a block is wide
  enough to read them.

## 4. The placement law

**Rail = reference. Dock = workbench. Palette = selection. Modal = import.**

| Piece | Home |
|---|---|
| Mix/Bend | Right rail, **one global panel, scope switch** — Song at Arrangement, selected Section elsewhere. It's a lens on the focus. |
| Structure right sidebar | becomes the rail's **section reference** (role, bars, chords, groove, ◆ detected, lyric + jump links) |
| Harmony's two menus | chord controls move **into the hex workspace** (anchored panel + progression strip + effects row under the wheel); the dock's section chips **die** — the ribbon is the single navigator |
| Drums dock | contracts as the Blocks selection palette absorbs authoring (classic tools stay until parity) |
| Lyrics dock | stays — rhyme/meter are workbench tools (rhyme may later become rail reference) |
| Melody | workspace controls strip only — no rail, no dock |
| Drums | no rail — correct today |

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
- **P2**: spine becomes shell chrome above *all* song routes; legacy header
  + nav collapse into it; ribbon at element depth; harmony dock chips die.
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
