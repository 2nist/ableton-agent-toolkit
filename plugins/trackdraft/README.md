# TrackDraft Harmony (VST3 / AU)

A **MIDI generator**: it turns a chord progression into MIDI notes on the host's
timeline and hands them to whatever instrument the track already has. It makes no
sound of its own.

This is the native sibling of `apps/trackdraft`'s harmony view, not a wrapper
around the web app — the editor is native JUCE, because a webview inside a plugin
puts a second event loop and a second state store between the host and the notes.

## What it is, and what it is not

| | |
|---|---|
| Format | VST3, AU (`aumi`, Apple's MIDI-processor type), Standalone |
| Class | MIDI effect — `isMidiEffect()` is true, so JUCE reports `JucePlugin_IsMidiEffect` |
| Audio | none. Audio passes through untouched; the plugin declares stereo buses only so a host that insists on them is happy |
| MIDI | passed through **and** generated; incoming notes are never swallowed |
| Sound | none — the whole point is to drive the track's existing instrument |

**Ableton Live does not route MIDI out of plug-ins.** A MIDI generator cannot
feed a Live track; use it where the host accepts plugin note output — REAPER,
Bitwig, Cubase, Studio One — or keep using the Extension / M4L routes in the rest
of this toolkit for Live. (Confirm in your Live version before planning around
this either way; it is the one assumption in this file that the build cannot
prove.)

## Build

Requires CMake ≥ 3.22 and a C++20 toolchain. JUCE 8.0.15 is fetched by CMake —
nothing large is committed.

```bash
cd plugins/trackdraft
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j8
```

To build against a local JUCE checkout instead of downloading one:

```bash
cmake -B build -DJUCE_PATH=/path/to/JUCE
```

Artefacts land in `build/TrackDraftHarmony_artefacts/Release/`:

```
VST3/TrackDraft Harmony.vst3
AU/TrackDraft Harmony.component
Standalone/TrackDraft Harmony.app
```

Install for local use (no sudo):

```bash
cp -R "build/TrackDraftHarmony_artefacts/Release/VST3/TrackDraft Harmony.vst3" ~/Library/Audio/Plug-Ins/VST3/
cp -R "build/TrackDraftHarmony_artefacts/Release/AU/TrackDraft Harmony.component" ~/Library/Audio/Plug-Ins/Components/
```

The AU is only discoverable after the system audio-component cache rescans:
log out and back in, or run `sudo killall AudioComponentRegistrar` and reopen
the host.

## Tests

`TrackDraftCore` (theory, progression, scheduler) has no GUI dependency, so it is
tested from a console app rather than from a DAW:

```bash
cmake --build build --target TrackDraftTests
./build/TrackDraftTests_artefacts/Release/TrackDraftTests
```

Covers: theory-table parity with `@music-theory/core`, diatonic vocabulary per
mode, the walk's neighbour and cycle properties, chord recognition (including
the vocabulary rules and the borrowed-chord fallback), articulation (block,
strum spread, pulse accents, arp direction), the borrowed-chord set (derived,
deduplicated, never a chord already in the key), reordering, applying
articulation to the whole progression, the XML round-trip, presets (save, list,
load, missing-preset failure, and that a hostile name cannot escape the preset
directory), preset rename/delete (including refusing to overwrite), the factory
set, mixture-only borrowings against the wider every-mode list, Harte label
parsing (including flats, slash bass and tensions), JAMS/plain-JSON import and
MIDI import from a generated file, the progression cycle, and the scheduling
rules — a stopped transport emits
nothing, the downbeat sounds the first chord at MIDI 60, a boundary inside a block
releases the previous chord first, a host loop restarts cleanly, the gate closes
notes without a boundary, and disabling emission releases what is sounding.

## Editing

| Control | What it does |
|---|---|
| **Section bar** | The song's sections, one box each. Click to choose one; it lights while the transport is inside it. A section holds up to 8 chords |
| **Section name / + / Dup / Del / < / >** | Rename the selected section, add an empty one, copy it (chords and all), delete it, or reorder the list. A song keeps at least one section |
| **Arrangement bar** | The order the song plays in — one box per pass, `Chorus x2` when a pass repeats. Click a pass to select it, and the section it plays with it |
| **+ pass / ± rep / del pass** | Append a pass of the selected section, change how many times the selected pass repeats (1-8), or remove it |
| **Save song** | Writes every section and the arrangement to the preset folder under the name in the Presets row |
| Key / Scale | Seeds nothing by itself; they are the context for seeding, the walk, and the vocabulary detection prefers |
| **Seed from key** | Fills the slots with the mode's diatonic chords (I, ii, iii… with sevenths where the mode has them) |
| Slot strip | Click a slot to select it; it shows the chord and the beat count, and the slot currently sounding is lit |
| Root / Quality | Set the selected slot directly |
| **Beats** | Length of the selected slot, 1-8. The cycle is the sum, so 4 × 4 beats is four bars of 4/4 |
| **Walk row** | The six hex neighbours of the selected chord. A click writes that chord into the next slot and moves the selection there |
| **Borrowed chord…** | Chords the *other* modes on this tonic would give the key — bIII, iv, bVI, bVII in a major key — derived at the triad, written into the selected slot |
| **Rhythm grid** | Sixteen sixteenths for the selected slot: click a step to cycle off → normal → accent → ghost. The grid is *when* and the articulation is *how*, so a strummed grid and an arpeggiated grid are one idea. One bar long, tiled over a longer slot; a grid with no hits is silence, which is different from having no pattern. The cursor follows the transport |
| **Clear rhythm** | Gives the slot back to its articulation |
| **Articulation** (Block / Strum / Pulse / Arp) | Per slot. Strum uses the app's millisecond spread, Pulse re-strikes on a subdivision with a triangle accent, Arp walks the tones up, down or up-down |
| **Inversion / spread** | Which chord tone is in the bass (root, 1st, 2nd … — the list is the chord's own tones, so a 13th offers six) and whether the upper voices stack close or open. The slot strip names the result as a slash chord, `C/E` |
| **Bass line** (off / octave / motion / rhythm / velocity) | The section's own bass voice. Off unless it is asked for. `Root` holds the chord's bass tone, `Root-fifth` alternates with the fifth, `Walking` ends each chord on a leading tone into the next one; `Locked` sounds once per chord, `Half` twice, `Eighth` four times. It plays the tone the inversion put in the bass, so `C/E` is an E in the low end |
| **Preview** | Plays the selected slot immediately, transport or not, so you can hear the voicing before committing to it |
| **Drag a slot** | Click-drag reorders the progression; the drop target shows while dragging |
| **Apply feel to section** | Copies the selected slot's articulation *and* rhythm onto every slot of the selected section — the "feel" of a part is both |
| **Presets** | Save / Rename / Delete the selected *section* under a name (one `.tdp.xml` per preset in `~/Library/Application Support/TrackDraft/Presets`), pick one to load it. A file written as a whole song loads as a song instead, because the list is one folder and the file says which it is. Names are sanitised to a filename and never allowed to define a path. Factory entries (one per mode, plus `bVI–bVII–I` and `i–iv–bVI–V`) are code, not files, and cannot be renamed or deleted |
| **Import…** | Load a progression from a `.mid`, `.midi`, `.jams` or `.json` annotation file — see below |
| **Detect MIDI / Use heard** | Arm listening to the notes the host sends in, then write the recognised chord into the selected slot. The readout names both what you played and what the slot says, so the difference is the decision |

The walk row is a port of the app's honeycomb arithmetic, not an invented
"good next chord" list: with `degree = (3q + r) mod 7`, the six axial neighbours
of a cell are the six *other* degrees — all of them, each once. Stepping the
first direction is `+3 mod 7`, which cycles through all seven degrees before
returning (`gcd(3, 7) = 1`), so a walk never dead-ends. The tests assert both
properties.

Detection is the same scorer as the app's chord pad — the port in
`Source/Theory/ChordRecognition.cpp` keeps its constants, its optional-tone
costs, its bass evidence and the "permitted vocabulary first, but only if it
explains every note" rule, so the plug-in and the app agree on what a shape is
called.

## Importing a song's harmony

Two sources, both MIR-standard rather than invented:

- **MIDI** — notes are collected per bar and recognised with the same scorer the
  rest of the plug-in uses (bar windows, previous-chord prior, repeats merged),
  which is the app's `parsers/parseMidi.ts` approach. Tempo comes from the file's
  tempo map; the result is one chord per change, four beats each.
- **JSON** — a **JAMS** annotation (the container ChordMini and the
  McGill/Isophonics exports use), a plain `{ chords: [...] }`, or a bare array of
  `{ time, chord }` / `[time, label]`. Labels are parsed as **Harte** syntax —
  `C:maj7`, `A:min/3`, `N` — which is what every MIR chord corpus writes.
  Durations become beats through the file's `bpm`/`tempo` (120 when absent).

What the slot model cannot hold is simplified rather than dropped — parenthesised
tensions (`maj(9)`), slash bass (`maj/3`), `N` — and the count of what was kept
and simplified is reported in the editor's message line. A progression is a loop,
so an import keeps the first eight chord changes and says so when it truncates.

## Sharing progressions with the app

A slot also carries `inversion` and `spread="open"` when the chord is voiced,
omitted when it is in root position and close — so a file written before
voicings existed is byte-identical to one written now. A section carries its
bass voice as `<bass octave motion rhythm velocity/>`, written only when the
voice is on, and its rhythm as `rhythm="3001200030002000"` — sixteen digits, one
per sixteenth, written only when the slot has a grid of its own; a song exported from the app always has one, because the app's
`.mid` export always has, and a *preset* never does — a preset is a chord set,
and the section it lands in keeps its own bass.

Presets use the same XML the TrackDraft app reads and writes
(`apps/trackdraft/src/lib/harmony/tdpPreset.ts`), so a progression moves between
the two without a translation step:

- **app → plug-in (one section)**: *Save for plug-in* in the app's preset panel
  writes a `<section>.tdp.xml` into `~/Library/Application Support/TrackDraft/Presets`;
  it appears in the plug-in's preset list.
- **app → plug-in (a whole song)**: *Export ▸ Save song for the plug-in* writes
  every section and the arrangement as a `<TrackDraftSong>`. It lands in the same
  folder and the same list, and picking it replaces the plug-in's whole song —
  the plug-in then follows the app's form as the transport plays.
- **plug-in → app**: *Load plug-in preset…* opens any `.tdp.xml` and applies its
  chords to the section.

Both sides are tested against the same bytes: `TrackDraftTests --dump-xml` and
`--dump-song-xml` print the plug-in's output, `tdpPreset.test.ts` parses that
exact string, and `testSongXml` parses the app's `toTdpSongXml` output pasted
from that test — so the format is checked in both directions against one string
rather than against each side's assumptions.

## How it plays

- Articulation is scheduled on the musical clock, not approximated per block: a
  strum spread stays even at any tempo, and an arp's remaining steps are
  cancelled when the chord changes.
- Audition (`Preview`) runs on its own sample clock, so it works with the
  transport stopped and never leaves a note ringing.
- A chord sounds as voiced, not as a stack of root-position triads: the
  inversion rotates the tones (`C/E` is E-G-C, so the inversion is audible with
  no bass voice at all) and "open" drops the second-highest tone an octave.
  `theory::voicedNotes` is a port of the app's `voiceChord`, rule for rule.
- The bass voice is a **section** setting and is off unless a section turns it
  on — a plug-in that started emitting notes nobody asked for would change every
  session saved before it existed. `Source/Bass.*` is a port of the app's
  `planSectionBass`, with two differences that come from having more context:
  it plays the chord's *bass* tone rather than its root (identical for
  root-position chords, so the port stays checkable), and "the next chord" is the
  next slot of the whole song, so a walking line leads into the next section as
  readily as into the next bar.
- Its register uses the app's bass numbering (`octave * 12`, so 3 is MIDI 36) —
  deliberately *not* the chord register's `(octave + 1) * 12`, which puts octave 4
  at middle C. The two differ by an octave, and a bass written with the chord
  formula would land where the chord already is.
- A slot's **rhythm grid** decides which sixteenths sound and how hard; the
  slot's articulation decides what each hit is (a block, a strum, an arpeggio
  across that sixteenth). A grid is one bar of 4/4 and tiles over a longer slot,
  a shorter slot uses the steps that fit, and the last hit is trimmed so it never
  hangs into the next chord.
- Levels are velocities relative to the Velocity knob: accent = the knob, normal
  = 80%, ghost = 55%. A grid with no hits is silence; no grid at all means the
  articulation plays the chord across the whole slot, which is what every slot
  written before the grid existed does.
- Chords start on their slot boundary, sample-accurate within the block.
- The **song** is a flat beat timeline: every pass of every section, in
  arrangement order, with repeats expanded. The transport's song position decides
  which pass and which chord, so a section change is just another boundary — the
  scheduler has one timing rule, not one per model.
- The whole form loops on its own length: a 16-beat song starts again at bar 5
  without the host having to loop, and a DAW loop over a shorter range simply
  restarts the form earlier.
- Sections are named by a stable id, not by their position, so reordering or
  deleting one cannot silently point the arrangement at a different section.
- Songs are written and read as `<TrackDraftSong>`: `<section>` elements in
  authoring order plus an `<arrangement>` list of passes. A session from before
  songs existed — one bare progression — loads as a one-section song.
- Every note switched on is switched off — on a slot change, at the gate, on
  transport stop, and on a backwards playhead jump.
- The key/scale/octave/velocity/gate controls are APVTS parameters, so they
  automate and undo like any host parameter. The progression itself is plugin
  state, not a parameter: a chord change is an edit, not a knob.

## Layout

```
Source/Theory/ChordTheory.*    the app's chord + scale tables, ported
Source/Theory/ChordWalk.*      hex neighbours / the walk, ported
Source/Theory/ChordRecognition.*  notes -> chord name, ported
Source/Performance.*           strum / pulse / arp, ported
Source/Song.*                  sections, arrangement, song position, flattened cycle
Source/Bass.*                  the bass voice: root/fifth/walking on a rhythm
Source/ProgressionXml.*        the one XML writer/reader for a progression or a song
Source/PresetStore.*           named progressions and songs on disk, plus factory entries
Source/Import/ChordImport.*    MIDI and JAMS/JSON chord import
Source/Progression.*           slots, cycle length, diatonic seeding
Source/ChordScheduler.*        transport → MIDI events (the testable core)
Source/PluginProcessor.*       APVTS, state, bus/format declarations
Source/PluginEditor.*          native editor
Tests/PluginTests.cpp          console checks
```

`ChordTheory` is a **port**, not a second source of truth: `PluginTests.cpp`
asserts against values pasted from `packages/music-theory/src/chords.ts`, so a
change to the app's tables that is not mirrored here fails the build.
