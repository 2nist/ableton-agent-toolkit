/**
 * APC mini mk2 Hardware Element Definitions
 *
 * Source: AbletonLive11_MIDIRemoteScripts APC_mini_mk2/elements.py
 *
 * Hardware layout:
 *   - 64 pads (8×8 grid), rows flipped (row 0 = bottom physical row)
 *   - 8 track buttons (below pads)
 *   - 8 scene launch buttons (right side)
 *   - 8 faders
 *   - 1 master fader (encoder)
 *   - Shift button (note 122)
 *   - Pad mode control (sysex)
 */

import type { ControllerElements } from "../types";

export const APC_MINI_MK2: ControllerElements = {
  model: "APC mini mk2",
  manufacturer: "Akai Professional",

  controls: {
    // Shift modifier button
    shift_button: {
      midi: 122,
      channel: 0,
      msgType: "note",
      name: "Shift Button",
      isRgb: false,
    },

    // Master fader (encoder, not a fader strip)
    master_fader: {
      midi: 56,
      channel: 0,
      msgType: "cc",
      name: "Master Fader",
      mapMode: "absolute",
    },
  },

  matrices: {
    // 8×8 clip launch pad grid (rows flipped: 0=top physical)
    clip_launch_buttons: {
      identifiers: Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: 8 }, (_, col) => row * 8 + col)
      ),
      width: 8,
      height: 8,
      element: {
        channel: 0,
        msgType: "note",
        name: "Clip Launch Button",
        isRgb: true,
      },
      flipRows: true,
    },

    // 8×8 drum pad grid (on dedicated channel 9)
    drum_pads: {
      identifiers: Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: 8 }, (_, col) => row * 8 + col + 64)
      ),
      width: 8,
      height: 8,
      element: {
        channel: 9,
        msgType: "note",
        name: "Drum Pad",
        isRgb: true,
      },
      flipRows: true,
    },

    // 8 track buttons (below pads, CC 100-107)
    track_buttons: {
      identifiers: [Array.from({ length: 8 }, (_, i) => 100 + i)],
      width: 8,
      height: 1,
      element: {
        channel: 0,
        msgType: "note",
        name: "Track Button",
        isRgb: false,
      },
    },

    // 8 scene launch buttons (right side, CC 112-119)
    scene_launch_buttons: {
      identifiers: [Array.from({ length: 8 }, (_, i) => 112 + i)],
      width: 8,
      height: 1,
      element: {
        channel: 0,
        msgType: "note",
        name: "Scene Launch Button",
        isRgb: false,
      },
    },

    // 8 faders (CC 48-55)
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

  sysex: {
    // Pad mode control (switches pad matrix between session/drum/note modes)
    pad_mode_control: {
      header: [0xf0, 71, 127, 79, 98, 0, 1],
      name: "Pad Mode Control",
      useFirstByteAsValue: true,
    },
  },

  modifiers: {
    shift_button: {
      midi: 122,
      channel: 0,
      msgType: "note",
      name: "Shift Button",
    },
  },

  modifiedControls: {
    // Track buttons in shift mode: navigation instead of mode buttons
    "track_buttons[4]": "navigate_up",
    "track_buttons[5]": "navigate_down",
    "track_buttons[6]": "navigate_left",
    "track_buttons[7]": "navigate_right",
    // Scene buttons in shift mode: clip stop, solo, mute, arm, select
    "scene_launch_buttons[7]": "stop_all_clips",
    "scene_launch_buttons[0]": "clip_stop_mode",
    "scene_launch_buttons[1]": "solo_mode",
    "scene_launch_buttons[2]": "mute_mode",
    "scene_launch_buttons[3]": "arm_mode",
    "scene_launch_buttons[4]": "track_select_mode",
    // First 4 track buttons in shift: fader mode select
    "track_buttons[0]": "volume_mode",
    "track_buttons[1]": "pan_mode",
    "track_buttons[2]": "send_mode",
    "track_buttons[3]": "device_mode",
  },
};
