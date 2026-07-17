import type { ControllerModes } from "./types";

/**
 * APC mini mk2 Mode Definitions
 *
 * Implements the same multimodal architecture as Ableton's MIDI Remote Scripts:
 *   - Track_Button_Modes: clip_stop, solo, mute, arm, track_select
 *   - Fader_Modes: volume, pan, send, device
 *   - Pad_Modes: session, drum, note
 *   - Main_Modes: default, shift
 *
 * Source: AbletonLive11_MIDIRemoteScripts APC_mini_mk2/mappings.py
 */
export const APC_MINI_MK2_MODES: ControllerModes = {
  groups: {
    Main_Modes: [
      {
        name: "default",
        group: "Main_Modes",
        activationElement: "shift_button",
        behavior: "momentary",
        priority: 0,
        mappings: [
          {
            scene_launch_buttons: "scene_launch_buttons",
          },
        ],
      },
      {
        name: "shift",
        group: "Main_Modes",
        behavior: "momentary",
        priority: 100,
        mappings: [
          {
            stop_all_clips_button: "scene_launch_buttons[7]",
            clip_stop_button: "scene_launch_buttons[0]",
            solo_button: "scene_launch_buttons[1]",
            mute_button: "scene_launch_buttons[2]",
            arm_button: "scene_launch_buttons[3]",
            track_select_button: "scene_launch_buttons[4]",
            volume_button: "track_buttons[0]",
            pan_button: "track_buttons[1]",
            send_button: "track_buttons[2]",
            device_button: "track_buttons[3]",
            up_button: "track_buttons[4]",
            down_button: "track_buttons[5]",
            left_button: "track_buttons[6]",
            right_button: "track_buttons[7]",
          },
        ],
      },
    ],
    Track_Button_Modes: [
      {
        name: "clip_stop",
        group: "Track_Button_Modes",
        activationElement: "scene_launch_buttons[0]",
        behavior: "latching",
        priority: 10,
        mappings: [
          { stop_track_clip_buttons: "track_buttons" },
        ],
      },
      {
        name: "solo",
        group: "Track_Button_Modes",
        activationElement: "scene_launch_buttons[1]",
        behavior: "latching",
        priority: 10,
        mappings: [
          { solo_buttons: "track_buttons" },
        ],
      },
      {
        name: "mute",
        group: "Track_Button_Modes",
        activationElement: "scene_launch_buttons[2]",
        behavior: "latching",
        priority: 10,
        mappings: [
          { mute_buttons: "track_buttons" },
        ],
      },
      {
        name: "arm",
        group: "Track_Button_Modes",
        activationElement: "scene_launch_buttons[3]",
        behavior: "latching",
        priority: 10,
        mappings: [
          { arm_buttons: "track_buttons" },
        ],
      },
      {
        name: "track_select",
        group: "Track_Button_Modes",
        activationElement: "scene_launch_buttons[4]",
        behavior: "latching",
        priority: 10,
        mappings: [
          { track_select_buttons: "track_buttons" },
        ],
      },
    ],
    Fader_Modes: [
      {
        name: "volume",
        group: "Fader_Modes",
        activationElement: "track_buttons[0]",
        behavior: "latching",
        priority: 10,
        mappings: [
          { volume_controls: "faders" },
        ],
      },
      {
        name: "pan",
        group: "Fader_Modes",
        activationElement: "track_buttons[1]",
        behavior: "latching",
        priority: 10,
        mappings: [
          { pan_controls: "faders" },
        ],
      },
      {
        name: "send",
        group: "Fader_Modes",
        activationElement: "track_buttons[2]",
        behavior: "reenter",
        priority: 10,
        mappings: [
          { send_controls: "faders" },
        ],
      },
      {
        name: "device",
        group: "Fader_Modes",
        activationElement: "track_buttons[3]",
        behavior: "latching",
        priority: 10,
        mappings: [
          { parameter_controls: "faders" },
        ],
      },
    ],
    Pad_Modes: [
      {
        name: "session",
        group: "Pad_Modes",
        behavior: "latching",
        priority: 0,
        mappings: [
          { clip_launch_buttons: "clip_launch_buttons" },
        ],
      },
      {
        name: "drum",
        group: "Pad_Modes",
        behavior: "latching",
        priority: 0,
        mappings: [
          { drum_pads: "drum_pads" },
        ],
      },
    ],
  },
  defaults: {
    Main_Modes: "default",
    Track_Button_Modes: "track_select",
    Fader_Modes: "volume",
    Pad_Modes: "session",
  },
};

/**
 * ATOMSQ Mode Definitions
 *
 * Source: AbletonLive11_MIDIRemoteScripts ATOMSQ/mappings.py
 */
export const ATOMSQ_MODES: ControllerModes = {
  groups: {
    Main_Modes: [
      {
        name: "song",
        group: "Main_Modes",
        activationElement: "song_mode_button",
        behavior: "latching",
        priority: 0,
        mappings: [
          { clip_launch_buttons: "upper_pads" },
          { target_track_volume_control: "encoders[0]" },
          { target_track_pan_control: "encoders[1]" },
          { target_track_send_controls: "encoders_2_thru_7" },
        ],
        subModes: [
          {
            name: "view_toggle",
            group: "Main_Modes.song",
            behavior: "latching",
            priority: 5,
            mappings: [
              {
                main_view_toggle_button: "bank_a_button",
                browser_view_toggle_button: "bank_b_button",
                detail_view_toggle_button: "bank_d_button",
                clip_view_toggle_button: "bank_h_button",
              },
            ],
          },
        ],
      },
      {
        name: "instrument",
        group: "Main_Modes",
        activationElement: "instrument_mode_button",
        behavior: "latching",
        priority: 0,
        mappings: [
          { parameter_controls: "encoders" },
        ],
      },
      {
        name: "editor",
        group: "Main_Modes",
        activationElement: "editor_mode_button",
        behavior: "latching",
        priority: 0,
        mappings: [
          { parameter_controls: "encoders" },
          {
            prev_button: "display_buttons[1]",
            next_button: "display_buttons[2]",
            device_lock_button: "display_buttons[0]",
            device_on_off_button: "display_buttons[3]",
          },
        ],
      },
      {
        name: "user",
        group: "Main_Modes",
        activationElement: "user_mode_button",
        behavior: "latching",
        priority: 0,
        mappings: [
          { encoders: "encoders" },
          { channel_selection_buttons: "display_buttons" },
        ],
      },
    ],
    Lower_Pad_Modes: [
      {
        name: "select",
        group: "Lower_Pad_Modes",
        activationElement: "minus_button",
        behavior: "latching",
        priority: 5,
        mappings: [
          { track_select_buttons: "lower_pads" },
        ],
      },
      {
        name: "stop",
        group: "Lower_Pad_Modes",
        activationElement: "minus_button",
        behavior: "latching",
        priority: 5,
        mappings: [
          { stop_track_clip_buttons: "lower_pads" },
        ],
      },
    ],
  },
  defaults: {
    Main_Modes: "song",
    Lower_Pad_Modes: "select",
  },
};
