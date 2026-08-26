# APC mini mk1 — Clip Editor Control Map

The mk1 edits the currently-selected clip in Ableton Live **directly, over
AbletonOSC** — not through MIDI mapping. An earlier version of this app used
a MIDI CC bank-router driving Live's native MIDI Map Mode (Cmd/Ctrl+M), and
it worked exactly as designed, but testing showed Live 12's Clip View
Pitch/Time/Transform/Generate tools aren't reachable that way — they aren't
standard MIDI-mappable widgets. AbletonOSC *does* expose the real thing:
direct read/write access to a clip's MIDI notes through the Live Object
Model. The app reads a clip's notes, applies a real transform (transpose,
quantize, reverse, a Euclidean generator, etc.) using the mk1's faders as
parameters, and writes the result back — no per-control Live-side mapping
step at all.

## Sources

- **Hardware note/CC numbers** — Ableton's own shipped remote script for
  this device (`APC_mini` subclasses `APC_Key_25`):
  <https://github.com/gluon/AbletonLive11_MIDIRemoteScripts/tree/main/APC_mini>
  and `APC_Key_25/APC_Key_25.py`. The real hardware has no dedicated
  Play/Stop/Record/Loop/Metronome buttons — that's why transport lives on
  the shift-overlay row below rather than its own buttons.
- **AbletonOSC's clip/view API** —
  <https://github.com/ideoforms/AbletonOSC>, `abletonosc/clip.py` and
  `abletonosc/view.py`. Confirmed: `/live/view/get/selected_clip` returns
  `(track_index, scene_index)`; `/live/clip/get/notes` returns flattened
  `(pitch, start_time, duration, velocity, mute)` tuples; `/live/clip/add/
  notes` and `/live/clip/remove/notes` write/clear them (neither replies —
  fire-and-forget).

## Physical control inventory

| Control | Real MIDI | Role |
|---|---|---|
| Shift | note 98 | Modifier — switches scene buttons to the transport overlay row |
| Faders 1–8 | CC 48–55 | Per-bank transform parameters (local only — nothing is sent on every tick) |
| Master fader | CC 56 | Not wired to anything in v1 |
| Track buttons 1–5 | notes 64–68 | Bank select (Pitch / Time / Transform / Generate / Clip Tools) |
| Track buttons 6–8 | notes 69–71 | Reserved, unused in v1 |
| Scene buttons 1–8 | notes 82–89 | Unshifted: trigger the active bank's transform. Shifted: transport/navigation |
| 8×8 grid | notes 0–63 | Same trigger as any scene button — fires the active bank's transform |

## Banks — what each fader actually does

Deliberately modest for v1: each bank has **one** real transform, using its
first 1–2 faders as parameters (the rest reserved for later). Every scene
button and every grid pad in a bank fires that same transform — there isn't
yet a distinct meaning per physical trigger, just per bank.

| Bank | Fader 1 | Fader 2 | Trigger action |
|---|---|---|---|
| **Pitch** | Transpose, ±24 semitones (centered at fader=64) | Octave shift, ±2 octaves | Shift every note in the clip by fader1 + 12×fader2 |
| **Time** | Quantize strength, 0–100% snap to a 1/16 grid | Swing, ±50% of a 16th on off-beats | Blend/snap note start times |
| **Transform** | Velocity scale, 0–2× (centered at fader=64) | Reverse — above center reverses note order (retrograde) | Scale velocities, optionally reverse |
| **Generate** | Pulse count, 1–16 of 16 steps | Pitch, spans roughly C1–C5 | **Replaces** the clip's notes with a Euclidean rhythm across its full length |
| **Clip Tools** | — | — | Scene button 1 (and any grid pad): duplicate the clip's loop. Scene button 2: clear all notes. 3–8 reserved |

All transforms except Generate **read the clip's existing notes and replace
them** (clear + rewrite) — repeated triggers don't stack duplicates, but
they do compound (e.g. triggering Pitch twice adds the transpose twice).

## Shift + Scene button — transport/navigation overlay

Not banked — same action regardless of the active bank. Calls Ableton's
Song API methods directly (verified real method names from AbletonOSC's own
README):

| Scene | Action | OSC address |
|---|---|---|
| 1 | Play | `/live/song/start_playing` |
| 2 | Stop | `/live/song/stop_playing` |
| 3 | Record | `/live/song/trigger_session_record` |
| 4 | Stop All Clips | `/live/song/stop_all_clips` |
| 5 | Prev Marker | `/live/song/jump_to_prev_cue` |
| 6 | Next Marker | `/live/song/jump_to_next_cue` |
| 7 | Undo | `/live/song/undo` |
| 8 | Redo | `/live/song/redo` |

## One-time setup

1. **AbletonOSC** must be running as a Control Surface in Live (Preferences
   → Link/Tempo/MIDI → Control Surface). If it's already installed and
   assigned to a slot, nothing to do here.
2. **Start the relay**: `packages/osc-bridge`'s WebSocket↔OSC bridge
   (defaults to `ws://127.0.0.1:8081` ↔ AbletonOSC's UDP ports
   11000/11001) — same relay `apps/apc-sequencer` already uses.
3. `cd apps/apc-mk1-utility && npm install && npm run dev`, open
   <http://localhost:5185> in Chrome (Web MIDI + sysex).
4. In the app, pick the mk1 as **mk1 input** and **mk1 LED output**
   (LED output is optional — it only drives the bank-indicator lights).
   Confirm the **OSC Bridge** status shows "connected."
5. In Live, select a MIDI clip. Set a bank's faders, press a scene button
   or grid pad — the transform applies to whatever clip is currently
   selected. Selecting a different clip in Live retargets the next trigger
   automatically (no re-pick needed on the app side).

## Learn Mode (optional safety net)

The default numbers above are sourced from Ableton's own script, so this
shouldn't be necessary. If a specific control doesn't respond, open the
app's Learn panel, click "Learn" next to that control, then move/press it
on the hardware — the app captures the real number and remembers it
(localStorage) without needing a code change.
