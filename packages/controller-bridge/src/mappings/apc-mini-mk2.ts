import type { ControllerMappings } from "../types";

export const APC_MINI_MK2_MAPPINGS: ControllerMappings = {
  mixer: {
    master_track_volume_control: "master_fader",
    volume_controls: "faders",
    track_select_buttons: "track_buttons",
    solo_buttons: "track_buttons",
    mute_buttons: "track_buttons",
    arm_buttons: "track_buttons",
  },
  session: {
    clip_launch_buttons: "clip_launch_buttons",
    scene_launch_buttons: "scene_launch_buttons",
    stop_track_clip_buttons: "track_buttons",
    clip_slot_select_button: "shift_button",
  },
  transport: {
    play_button: "not_mapped",
    stop_button: "not_mapped",
    record_button: "not_mapped",
  },
  device: {
    parameter_controls: "faders",
    prev_device_button: "not_mapped",
    next_device_button: "not_mapped",
    device_lock_button: "not_mapped",
  },
  navigation: {
    up_button: "track_buttons[4]",
    down_button: "track_buttons[5]",
    left_button: "track_buttons[6]",
    right_button: "track_buttons[7]",
  },
  subModes: {
    track_button_modes: {
      clip_stop: {
        stop_track_clip_buttons: "track_buttons",
      },
      solo: {
        solo_buttons: "track_buttons",
      },
      mute: {
        mute_buttons: "track_buttons",
      },
      arm: {
        arm_buttons: "track_buttons",
      },
      track_select: {
        track_select_buttons: "track_buttons",
      },
    },
    fader_modes: {
      volume: {
        volume_controls: "faders",
      },
      pan: {
        pan_controls: "faders",
      },
      send: {
        send_controls: "faders",
      },
      device: {
        parameter_controls: "faders",
      },
    },
    pad_modes: {
      session: {
        clip_launch_buttons: "clip_launch_buttons",
      },
      drum: {
        drum_pads: "drum_pads",
      },
    },
  },
};
