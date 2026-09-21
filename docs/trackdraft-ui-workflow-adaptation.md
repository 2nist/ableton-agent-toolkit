# TrackDraft UI Workflow — Adaptation Note

_2026-09-20 · status review after the analysis-pipeline push_

## Context: what changed underneath

The pipeline gained (all committed, cross-validated):

- **Real BPM** — spectral-flux comb detection, within ±0.8% of reference BPMs.
- **Real chords** — chroma-template matching (the old server returned a canned
  I-V-vi-IV pattern; every previously imported ChordMini song had dummy chords).
- **Key/mode** on the full track (was: first 2.3s, always "minor").
- **Metadata enrichment** — iTunes/MusicBrainz/Wikipedia/Deezer (year, album, genre).
- **Demucs stem lane** — verified equivalent to Ableton's separator for drums
  (identical periodicity numbers); fully scriptable.
- **Drum groove profile** — backbeat / hat feel / kick phrasing + Euclidean fits,
  from the drum stem (Demucs or Live — same results).
- **Bass profile** — register, notes/bar, note-length mix, root/fifth/scale
  function, movement; matches the hand-exported MIDI within a point.
- **Validation culture** — references (Deezer BPM), ground truth (hand MIDI),
  and second separators all agree where checked.

## Verdict: the UI is not behind in concept — it is behind in wiring

The app's model already rhymes with the analysis model almost 1:1:

| Pipeline output | UI slot that already exists |
|---|---|
| Drum periodicity / backbeat / density | Section style chips (`bridge_sparse` / `standard` / `driving`), Bend **ENERGY / DENSITY** sliders |
| Euclid fits E(k,16) per voice | Section `EuclidLike` overrides in the drums engine |
| Bass register / motion / rhythm / velocity | Harmony → Layers → **BassSettings** (exactly these four fields) |
| Extension tones / overtones (future) | Harmony → Layers → **ColorSettings** (bi-tonal flavor chips) |
| Analysis confidence & source | Song **Info** panel + library Conf badges |
| Stems | Studio console (Harmony / Drums / Melody panes) + Import tiles |

Nothing needs redesign. The detected values need routes into the settings the UI
already owns, plus surfaces that show **what was detected** and **where it came
from**.

## Gap list, prioritized

### P0 — data binding (FIXED, 7362120)
Deep links / hard reloads rendered the **last-persisted song's** content under the
route's title (child effect ran `openSong(songId)` against an empty store before
hydration; it no-op'd and never re-ran; every tab reads `currentSong()`).
Fixed: the open effect re-runs when the song exists, guarded so edits don't wipe
history. Verified on two routes.

### P1 — "adopt detected" (wire profiles into existing controls)
> **Shipped first (2026-09-21):** the Mix/Bend station is now **layered** —
> Song master + Drums / Bass / Harmony / Melody, with the new axes wired
> end-to-end through the shared engine (bass register/motion/rhythm/velocity →
> `bassProfile`; Color/Tension/Articulation → chord quality + performance;
> Melody contour → the captured line). Song master + per-section override per
> layer. Remaining P1 work = **seeding these sliders FROM the profiles**
> ("detected" badges + adopt) instead of starting neutral.
1. **Section style + Bend sliders**: drum profile's per-section energy/share,
   density spread, and backbeat index → *suggested* style chip and slider
   positions, marked "detected", with manual override staying first-class.
2. **BassSettings**: "adopt detected" per section from the bass profile
   (register median, notes/bar, short/medium/long mix, movement) with a small
   meter row showing the detected values.
3. **Drums Euclid overrides**: display detected per-voice fits
   (e.g. snare `E(2,16) r4`, hats `E(4,16)`) with match %, one-click lock into
   per-section overrides.
4. **Song Info "Analysis" block**: BPM + source, key confidence, groove summary,
   bass summary; profile presence indicator.

### P2 — trust & provenance surfaces
5. **Source badge** per song (ChordMini v2 / MIDI import / manual).
6. **Metadata line** (year · album · genre) in Song Info + library tooltip.
7. **Per-section profile view** ("what we heard") in Structure/Song Info — the
   spirit-capture made legible.

### P3 — import / workflow plumbing
8. **MIDI tile** (currently "Soon"): drop Bass + Others MIDI → cleanup bridge →
   draft import.
9. **Stems tile** (new): drop Demucs/Live stems → run profilers → auto-style
   draft; per-layer "analyze this stem" actions.
10. **Color layer extensions analysis** (Other stem: 9/11/13 + overtone
    character → ColorSettings flavors) — same meter idiom, future frontier.

## Process note

Every pipeline claim now has a cross-check. The UI should inherit that culture:
show detected values **with their source and confidence** instead of pretending
certainty; make "detected" and "authored" visibly distinct.
