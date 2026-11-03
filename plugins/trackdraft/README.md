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
| Key / Scale | Seeds nothing by itself; they are the context for seeding, the walk, and the vocabulary detection prefers |
| **Seed from key** | Fills the slots with the mode's diatonic chords (I, ii, iii… with sevenths where the mode has them) |
| Slot strip | Click a slot to select it; it shows the chord and the beat count, and the slot currently sounding is lit |
| Root / Quality | Set the selected slot directly |
| **Beats** | Length of the selected slot, 1-8. The cycle is the sum, so 4 × 4 beats is four bars of 4/4 |
| **Walk row** | The six hex neighbours of the selected chord. A click writes that chord into the next slot and moves the selection there |
| **Borrowed chord…** | Chords the *other* modes on this tonic would give the key — bIII, iv, bVI, bVII in a major key — derived at the triad, written into the selected slot |
| **Articulation** (Block / Strum / Pulse / Arp) | Per slot. Strum uses the app's millisecond spread, Pulse re-strikes on a subdivision with a triangle accent, Arp walks the tones up, down or up-down |
| **Preview** | Plays the selected slot immediately, transport or not, so you can hear the voicing before committing to it |
| **Drag a slot** | Click-drag reorders the progression; the drop target shows while dragging |
| **Apply articulation to all** | Copies the selected slot's articulation onto every slot — one strum setting for the whole progression |
| **Presets** | Save / Rename / Delete the progression under a name (one `.tdp.xml` per preset in `~/Library/Application Support/TrackDraft/Presets`), pick one to load it. Names are sanitised to a filename and never allowed to define a path. Factory entries (one per mode, plus `bVI–bVII–I` and `i–iv–bVI–V`) are code, not files, and cannot be renamed or deleted |
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

Presets use the same XML the TrackDraft app reads and writes
(`apps/trackdraft/src/lib/harmony/tdpPreset.ts`), so a progression moves between
the two without a translation step:

- **app → plug-in**: *Save for plug-in* in the app's preset panel downloads a
  `<section>.tdp.xml`; drop it into `~/Library/Application Support/TrackDraft/Presets`
  and it appears in the plug-in's preset list.
- **plug-in → app**: *Load plug-in preset…* opens any `.tdp.xml` and applies its
  chords to the section.

Both sides are tested against the same bytes: `TrackDraftTests --dump-xml` prints
the plug-in's output, and `tdpPreset.test.ts` parses that exact string. A golden
each side generated for itself would only prove it agrees with itself.

## How it plays

- Articulation is scheduled on the musical clock, not approximated per block: a
  strum spread stays even at any tempo, and an arp's remaining steps are
  cancelled when the chord changes.
- Audition (`Preview`) runs on its own sample clock, so it works with the
  transport stopped and never leaves a note ringing.
- Chords start on their slot boundary, sample-accurate within the block, and the
  progression loops on its own length (4 slots × 4 beats = one bar of 4/4 per
  slot, so a 16-beat cycle repeats at bar 5 without the host looping).
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
Source/ProgressionXml.*        the one XML writer/reader for a progression
Source/PresetStore.*           named progressions on disk, plus factory entries
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
