# apc-sequencer

APC mini mk2 hardware step sequencer for an **Ableton Drum Rack**. The browser app
reads the controller over **Web MIDI**, sequences up to 32 steps per drum pad
(16 pads, per-pad length set with SHIFT+step), previews samples live, sends notes
into Live through a **virtual MIDI bus (IAC)**, drives **device parameters** with
the faders via **AbletonOSC**, and mirrors everything on the pads' RGB LEDs.

Drum-Rack-style layout:

- **Top 4×8** — the selected pad's 32-step sequencer (row-major). SHIFT + a step
  sets that pad's sequence length (shift + step 16 = 16-step loop).
- **Bottom-left 4×4** — the 16 drum pads, arranged like the rack (kick = bottom-left,
  notes 36–51). Tap = live preview + select.
- **Bottom-right 4×4** — FX pads (toggle).
- **Track buttons** (100–107) — FX (mixed momentary/toggle).
- **Scene buttons** (112–119) — play/stop, solo, mute, resolution, pattern A/B,
  clear pad, follow-Live, commit clip.
- **Faders** (CC 48–55) + **master** (56) — Ableton device control via OSC.
- **Shift** (122) — modifier.

## Run

```bash
cd apps/apc-sequencer
npm install
npm run dev        # http://localhost:5184
```

Use **Chrome** (Web MIDI + sysex). The app degrades to a simulator (mouse clicks
drive the grid) when no MIDI device is present.

### Pad mode = Session (important for LEDs)

The APC mini mk2 only lights its grid RGB LEDs (on LED channel 6) in **Session**
mode — Note and Drum modes won't show the sequencer's lights. The app sends the
Session-mode sysex on start, but if you cycle modes with **SHIFT + Scene 8
(Stop All Clips)** you must end on Session mode for lights to work.

## Live one-time setup

1. **AbletonOSC** — install the Remote Script
   (`~/Music/Ableton/User Library/Remote Scripts/AbletonOSC`) and enable it in a
   Control Surface slot (Live → Preferences → Link, Tempo & MIDI). Verify with
   `~/Music/Ableton/User Library/Remote Scripts/AbletonOSC/logs/abletonosc.log`.
2. **OSC bridge** — `npm run bridge` at the repo root (`packages/osc-bridge`),
   relaying to `ws://127.0.0.1:8081`.
3. **IAC virtual MIDI bus** — macOS Audio MIDI Setup → IAC Driver → add **Bus 1**.
4. **Live routing** — on the Drum Rack track, set **MIDI From** to
   `IAC Driver Bus 1` so the sequencer's note-out triggers the rack in realtime.
5. **Fader device control** — the app sends
   `/live/device/set/parameter/value [track, 0, param, value]` (device 0 on the
   chosen track; set the track number in the app). The Drum Rack (or a wrapper
   Instrument Rack with macros) must be the track's first device.

## Commit pattern → clip

Scene 7 "commit clip" is not wired in v1. The `trackdraft-bridge` extension or OSC
`/live/clip/add/notes` can write a committed pattern to a real clip (Phase 4).

## Layout reference

Static + interactive visual references live in `docs/`:
- `docs/apc-mini-mk2-sequencer-layout.svg`
- `docs/apc-mini-mk2-control-reference.html`

Design + full plan: `docs/apc-mini-mk2-step-sequencer.md`.
