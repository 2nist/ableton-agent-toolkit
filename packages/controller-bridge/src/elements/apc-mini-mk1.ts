/**
 * APC mini mk1 (original, non-"mk2") Hardware Element Definitions
 *
 * Note/CC numbers are sourced directly from Ableton's own shipped MIDI
 * Remote Script for this device — not guessed. `APC_mini` subclasses
 * `APC_Key_25` and only overrides a few things (SESSION_HEIGHT=8,
 * HAS_TRANSPORT=False, the master fader, the stop-all button). Source:
 * https://github.com/gluon/AbletonLive11_MIDIRemoteScripts
 *   - APC_Key_25/APC_Key_25.py (_create_controls) — shift button, faders,
 *     track buttons, scene buttons, and the clip-launch grid
 *   - APC_mini/APC_mini.py — master fader (CC 56), SESSION_HEIGHT=8
 *   - _APC/SkinDefault.py (BiLedColors) — LED feedback is a 2-color
 *     velocity-encoded scheme (Off=0, Green=1, GreenBlink=2, Red=3,
 *     RedBlink=4, Amber=5), not RGB.
 *
 * Notably, `HAS_TRANSPORT` is `False` for this device: there are no
 * dedicated Play/Stop/Record/Loop/Metronome buttons on the real hardware.
 * The only physical controls are: shift, 8 faders + master, 8 track
 * buttons, 8 scene buttons, and a 64-pad grid. Any transport/marker
 * function has to be assigned to a shift-combination of these by the
 * consuming app (see apps/apc-mk1-utility), the same way Ableton's own
 * script repurposes shift+track for its own volume/pan/send/device bank
 * buttons.
 */

import type { ControllerElements } from "../types";

export const APC_MINI_MK1: ControllerElements = {
  model: "APC mini mk1",
  manufacturer: "Akai Professional",

  controls: {
    shift_button: {
      midi: 98,
      channel: 0,
      msgType: "note",
      name: "Shift Button",
      isRgb: false,
    },

    master_fader: {
      midi: 56,
      channel: 0,
      msgType: "cc",
      name: "Master Fader",
      mapMode: "absolute",
    },
  },

  matrices: {
    clip_launch_buttons: {
      // Ableton's own formula: note = track + 8*(7 - scene), scene 0 = top.
      // identifiers[i] = [i*8 .. i*8+7] with flipRows:true reproduces this
      // exactly — identifiers[0] (notes 0-7) lands on the physical bottom
      // row (scene 7), identifiers[7] (notes 56-63) on the physical top
      // row (scene 0), matching the "row 0 = top" convention used by
      // resolveIncoming()/cellNote() elsewhere in this package.
      identifiers: Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: 8 }, (_, col) => row * 8 + col)
      ),
      width: 8,
      height: 8,
      element: {
        channel: 0,
        msgType: "note",
        name: "Clip Launch Grid",
        // Confirmed 2-color (BiLedColors), not RGB — that was an MK2
        // copy-paste artifact in the earlier draft of this file.
        isRgb: false,
      },
      flipRows: true,
    },

    track_buttons: {
      identifiers: [Array.from({ length: 8 }, (_, i) => 64 + i)],
      width: 8,
      height: 1,
      element: {
        channel: 0,
        msgType: "note",
        name: "Track Button",
        isRgb: false,
      },
    },

    scene_launch_buttons: {
      identifiers: [Array.from({ length: 8 }, (_, i) => 82 + i)],
      width: 8,
      height: 1,
      element: {
        channel: 0,
        msgType: "note",
        name: "Scene Button",
        isRgb: false,
      },
    },

    faders: {
      identifiers: [Array.from({ length: 8 }, (_, i) => 48 + i)],
      width: 8,
      height: 1,
      element: {
        channel: 0,
        msgType: "cc",
        name: "Fader",
        mapMode: "absolute",
      },
    },
  },

  // No pad-mode (or other) sysex is defined by Ableton's script for this
  // device — the earlier draft's "Pad Mode Control" header was copied from
  // the MK2 model and doesn't correspond to real MK1 behavior.
  sysex: {},

  modifiers: {
    shift_button: {
      midi: 98,
      channel: 0,
      msgType: "note",
      name: "Shift Button",
    },
  },

  // Shift-combination semantics for this controller live in the consuming
  // app's router (apps/apc-mk1-utility/src/lib/router.ts), not here — the
  // bank-router use case needs a *learnable/runtime* mapping, not a static
  // "original -> shifted" table.
  modifiedControls: {},
};
