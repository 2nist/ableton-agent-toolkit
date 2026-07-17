import type { ControllerElements } from "../types";

export const ATOMSQ: ControllerElements = {
  model: "ATOM SQ",
  manufacturer: "PreSonus",

  controls: {
    display_encoder: {
      midi: 29, channel: 0, msgType: "cc",
      name: "Display Encoder", mapMode: "relativeSignedBit",
    },
    shift_button: {
      midi: 31, channel: 0, msgType: "note",
      name: "Shift Button", isRgb: false,
    },
    plus_button: {
      midi: 0, channel: 0, msgType: "note",
      name: "Plus Button", isRgb: true,
    },
    minus_button: {
      midi: 1, channel: 0, msgType: "note",
      name: "Minus Button", isRgb: true,
    },
    song_mode_button: {
      midi: 32, channel: 0, msgType: "note",
      name: "Song Mode Button", isRgb: true,
    },
    instrument_mode_button: {
      midi: 33, channel: 0, msgType: "note",
      name: "Instrument Mode Button", isRgb: true,
    },
    editor_mode_button: {
      midi: 34, channel: 0, msgType: "note",
      name: "Editor Mode Button", isRgb: true,
    },
    user_mode_button: {
      midi: 35, channel: 0, msgType: "note",
      name: "User Mode Button", isRgb: true,
    },
    display_left_button: {
      midi: 42, channel: 0, msgType: "note",
      name: "Display Left Button",
    },
    display_right_button: {
      midi: 43, channel: 0, msgType: "note",
      name: "Display Right Button",
    },
    up_button: {
      midi: 87, channel: 0, msgType: "note",
      name: "Up Button",
    },
    down_button: {
      midi: 89, channel: 0, msgType: "note",
      name: "Down Button",
    },
    left_button: {
      midi: 90, channel: 0, msgType: "note",
      name: "Left Button",
    },
    right_button: {
      midi: 102, channel: 0, msgType: "note",
      name: "Right Button",
    },
    click_button: {
      midi: 105, channel: 0, msgType: "note",
      name: "Click (Metronome) Button",
    },
    record_button: {
      midi: 107, channel: 0, msgType: "note",
      name: "Record Button", isRgb: true,
    },
    play_button: {
      midi: 109, channel: 0, msgType: "note",
      name: "Play Button", isRgb: true,
    },
    stop_button: {
      midi: 111, channel: 0, msgType: "note",
      name: "Stop Button",
    },
    // 8 bank buttons (A-H)
    bank_a_button: {
      midi: 0, channel: 0, msgType: "note",
      name: "Bank A Button", isRgb: true,
    },
    bank_b_button: {
      midi: 1, channel: 0, msgType: "note",
      name: "Bank B Button", isRgb: true,
    },
    bank_c_button: {
      midi: 2, channel: 0, msgType: "note",
      name: "Bank C Button", isRgb: true,
    },
    bank_d_button: {
      midi: 3, channel: 0, msgType: "note",
      name: "Bank D Button", isRgb: true,
    },
    bank_e_button: {
      midi: 4, channel: 0, msgType: "note",
      name: "Bank E Button", isRgb: true,
    },
    bank_f_button: {
      midi: 5, channel: 0, msgType: "note",
      name: "Bank F Button", isRgb: true,
    },
    bank_g_button: {
      midi: 6, channel: 0, msgType: "note",
      name: "Bank G Button", isRgb: true,
    },
    bank_h_button: {
      midi: 7, channel: 0, msgType: "note",
      name: "Bank H Button", isRgb: true,
    },
  },

  matrices: {
    display_buttons: {
      identifiers: [[36, 37, 38, 39, 40, 41]],
      width: 6, height: 1,
      element: {
        channel: 0, msgType: "note",
        name: "Display Button", isRgb: true,
      },
    },
    lower_pads: {
      identifiers: [Array.from({ length: 16 }, (_, i) => 36 + i)],
      width: 16, height: 1,
      element: {
        channel: 0, msgType: "note",
        name: "Lower Pad", isRgb: true,
      },
    },
    upper_pads: {
      identifiers: [Array.from({ length: 16 }, (_, i) => 52 + i)],
      width: 16, height: 1,
      element: {
        channel: 0, msgType: "note",
        name: "Upper Pad", isRgb: true,
      },
    },
    encoders: {
      identifiers: [Array.from({ length: 8 }, (_, i) => 14 + i)],
      width: 8, height: 1,
      element: {
        channel: 0, msgType: "cc",
        name: "Encoder",
        mapMode: "relativeSignedBit",
      },
    },
  },

  sysex: {
    touch_strip: {
      header: [0xf0, 0x00, 0x01, 0x06, 0x02],
      name: "Touch Strip",
      useFirstByteAsValue: true,
    },
    display_track_name: {
      header: [0xf0, 0x00, 0x01, 0x06, 0x02, 0x06],
      name: "Track Name Display",
    },
    display_device_name: {
      header: [0xf0, 0x00, 0x01, 0x06, 0x02, 0x07],
      name: "Device Name Display",
    },
    button_label_displays: {
      header: [0xf0, 0x00, 0x01, 0x06, 0x02],
      name: "Button Label Displays",
    },
  },

  modifiers: {
    shift_button: {
      midi: 31, channel: 0, msgType: "note",
      name: "Shift Button",
    },
  },

  modifiedControls: {
    // Shift-modified controls for secondary functions
    stop_button: "undo",
    record_button: "capture_midi",
    play_button: "loop_toggle",
    up_button: "navigate_up",
    down_button: "navigate_down",
    display_encoder: "tempo_coarse",
  },
};
