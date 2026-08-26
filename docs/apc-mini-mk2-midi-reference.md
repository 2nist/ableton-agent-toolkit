# APC mini mk2 — MIDI Reference (verified 2026-08)

Everything below was verified against **Ableton's own Remote Script**
(`AbletonLive11_MIDIRemoteScripts/APC_mini_mk2/` — the `gluon` GitHub mirror)
and/or empirically with the live hardware through the `apps/apc-sequencer`
MIDI monitor.

## 1. Hardware MIDI map (from Ableton's `elements.py`)

| Control | Message | Notes |
|---|---|---|
| 8×8 grid (clip launch) | Notes 0-63, ch 0 | flip_rows; physical note 0 = bottom row |
| 8×8 drum pads | Notes 64-127, ch 9 | drum pad mode only |
| 8 track buttons | Notes 100-107, ch 0 | |
| 8 scene buttons | Notes 112-119, ch 0 | |
| Shift | Note 122, ch 0 | momentary modifier |
| 8 faders | **CC 48-55, ch 0, absolute** | |
| Master fader | **CC 56, ch 0** | |
| Pad-mode sysex | `F0 47 7F 4F 62 00 01 <mode> F7` | 0=session, 1=drum, 2=note, 3=note-edit |

Vendor ID **2536** (Akai), product ID **79** = APC mini mk2 (`__init__.py`).

## 2. LED palette (from Ableton's `colors.py`)

Grid LEDs light via **note-on on channel 6** (`0x96`) with **velocity = palette value**.

- Brightness channels: half = 1, **full = 6**, pulse = 10, blink = 14.
- Colors: black 0 · grey 1 · red 5 · amber 9 · yellow 13 · green 21 · ocean 41 · blue 45.

> **Pads only light in SESSION pad mode.** Note/Drum modes don't light the grid on
> ch6. SHIFT+Scene 8 (Stop All Clips) cycles the pad mode; the app forces Session
> via sysex on start.

## 3. Faders (the important part)

The faders are **plain absolute CC 48-55** mapped directly to values — no inversion
or transform in Ableton's script (`mappings.py`):
`volume/pan/send/device` fader modes are selected with **SHIFT + track buttons 1-4**
(exactly what the app's Advanced mode implements).

> **Custom MIDI-mappable pads (not faders):** the bottom-right 2×4 pads of the
> grid (physical rows 7-8, columns 5-8; notes 4-7 & 12-15) are freed from clip
> launch in the script's `elements.py`, so Live's MIDI Map Mode (⌘M) can assign
> them. Those pads no longer launch clips.

- They send a full 0-127 range. A "slow / barely-moves" feel usually means the
  **fader is reversed** (down = higher) — use the app's **Reverse faders** toggle —
  or the observed range needs the **Calibrate faders** button (maps min→max to 0-1).
- A fader streams hundreds of CC messages/sec while moving — that is normal input.

## 4. Per-drum volume — two approaches

**A. Velocity scaling (Basic mode, default)**
The faders scale the note velocity the app sends to the Drum Rack. Zero Live setup,
works always; sounds natural for drums (velocity also affects timbre). Does **not**
move Live's pad-volume faders.

**B. True per-pad volume in Live (Advanced → Device mode)**
Wrap the Drum Rack in an **Instrument Rack** and map 8 **macros → the 8 pad
volumes** (drag each pad's volume knob to a macro in Live, one time). Set the app's
**Device faders** select to **P0-P7 (all macros)**. Faders then drive the macros via
the verified `/live/device/set/parameter/value` path → real per-pad volume in Live.

(Full per-pad volume/pan/send without manual macro-mapping needs an M4L device
exposing the 8 pads as macros — the Phase-4 item.)

## 5. Working iConnectivity (Auricle) routing — NO feedback loop

- **Route A (input):** `USB Host HST1` (APC) → `USB DAW [Jack 1] HST1`
- **Route B (return/LEDs):** `USB DAW [Jack 1] HST1` → `USB Host HST1`

**Rule:** never feed the Mac's output back into the Mac's input. That creates a
ghost loop (the app's own LED notes come back as input → flood/stutter). The app's
**Ping APC (loop test)** detects it: "no loopback" = clean.

## 6. Diagnosing "crashes / jitter / extra sends"

- **Crash/freeze when moving faders** was the diagnostic log re-rendering React on
  every MIDI message (hundreds/sec). Now throttled to ~15/s in `store.ts`
  (`midiUiThrottle`).
- **LED flood** was re-sending all 64 LED notes every render. Now diffed
  (`hub.renderLeds` sends only changed cells).
- **Multiple real Chrome tabs** all receive the same MIDI → duplicate every action.
  Keep exactly ONE real Chrome tab; close the VS Code embedded preview (it has no
  MIDI anyway).

## 7. App-side diagnostics

- **MIDI monitor** — every raw message (hex + resolution), ring buffer of 30.
- **MIDI diagnostics card** — Ping APC (loop test), Input rate/s, Clear monitor,
  Reverse faders, Calibrate faders.

## 8. Source references

- Ableton Live 11 Remote Scripts mirror: `gluon/AbletonLive11_MIDIRemoteScripts`
  → `APC_mini_mk2/{elements,colors,__init__,mappings}.py`
- Installed copy on this Mac:
  `~/Music/Ableton/User Library/Remote Scripts/AbletonOSC` (endpoints used:
  `/live/device/set/parameter/value`, `/live/track/set/volume|panning|send`,
  `/live/track/set/arm`, `/live/view/start_listen/selected_track|device`)
