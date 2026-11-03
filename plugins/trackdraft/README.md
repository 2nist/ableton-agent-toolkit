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
the vocabulary rules and the borrowed-chord fallback), the progression cycle, and
the scheduling rules — a stopped transport emits
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
| **Detect MIDI / Use heard** | Arm listening to the notes the host sends in, then write the recognised chord into the selected slot |

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

## How it plays

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
Source/Progression.*           slots, cycle length, diatonic seeding
Source/ChordScheduler.*        transport → MIDI events (the testable core)
Source/PluginProcessor.*       APVTS, state, bus/format declarations
Source/PluginEditor.*          native editor
Tests/PluginTests.cpp          console checks
```

`ChordTheory` is a **port**, not a second source of truth: `PluginTests.cpp`
asserts against values pasted from `packages/music-theory/src/chords.ts`, so a
change to the app's tables that is not mirrored here fails the build.
