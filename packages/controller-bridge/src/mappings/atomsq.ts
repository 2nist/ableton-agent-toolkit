import type { ControllerMappings } from "../types";

export const ATOMSQ_MAPPINGS: ControllerMappings = {
  mixer: {
    track_select_buttons: "lower_pads",
    target_track_volume_control: "encoders[0]",
    target_track_pan_control: "encoders[1]",
    target_track_send_controls: "encoders_2_thru_7",
    target_track_solo_button: "display_buttons[0]",
    target_track_mute_button: "display_buttons[1]",
    target_track_arm_button: "display_buttons[2]",
    crossfader_control: "touch_strip",
    target_track_track_name_display: "display_track_name",
  },
  session: {
    clip_launch_buttons: "upper_pads",
    stop_track_clip_buttons: "lower_pads",
    scene_0_launch_button: "plus_button",
    clip_launch_button: "display_buttons[3]",
    scene_launch_button: "display_buttons[4]",
    track_stop_button: "display_buttons[5]",
  },
  transport: {
    play_button: "play_button",
    stop_button: "stop_button",
    record_button: "record_button",
    loop_button: "play_button_with_shift",
    metronome_button: "click_button",
    arrangement_position_encoder: "display_encoder",
    tempo_coarse_encoder: "display_encoder_with_shift",
    capture_midi_button: "record_button_with_shift",
    undo_button: "stop_button_with_shift",
    prev_cue_button: "display_left_button",
    next_cue_button: "display_right_button",
  },
  device: {
    parameter_controls: "encoders",
    device_name_display: "display_device_name",
    prev_button: "display_buttons[1]",
    next_button: "display_buttons[2]",
    device_lock_button: "display_buttons[0]",
    device_on_off_button: "display_buttons[3]",
    prev_bank_button: "display_buttons[4]",
    next_bank_button: "display_buttons[5]",
  },
  navigation: {
    next_track_button: "right_button",
    prev_track_button: "left_button",
    next_scene_button: "down_button",
    prev_scene_button: "up_button",
    up_button: "up_button_with_shift",
    down_button: "down_button_with_shift",
  },
  subModes: {
    lower_pad_modes: {
      select: {
        track_select_buttons: "lower_pads",
      },
      stop: {
        stop_track_clip_buttons: "lower_pads",
      },
    },
    main_modes: {
      song: {
        clip_launch_buttons: "upper_pads",
        scene_0_launch_button: "plus_button",
        target_track_volume_control: "encoders[0]",
        target_track_pan_control: "encoders[1]",
        target_track_send_controls: "encoders_2_thru_7",
        target_track_solo_button: "display_buttons[0]",
        target_track_mute_button: "display_buttons[1]",
        target_track_arm_button: "display_buttons[2]",
        main_view_toggle_button: "bank_a_button",
        browser_view_toggle_button: "bank_b_button",
        detail_view_toggle_button: "bank_d_button",
        clip_view_toggle_button: "bank_h_button",
      },
      instrument: {
        parameter_controls: "encoders",
      },
      editor: {
        parameter_controls: "encoders",
        prev_button: "display_buttons[1]",
        next_button: "display_buttons[2]",
        device_lock_button: "display_buttons[0]",
        device_on_off_button: "display_buttons[3]",
        prev_bank_button: "display_buttons[4]",
        next_bank_button: "display_buttons[5]",
      },
      user: {
        // Generic controls (the raw MIDI the bridge relays):
        encoders: "encoders",
        channel_selection_buttons: "display_buttons",
        // Chord / scale semantic targets (User mode, channels 10+):
        // Encoder 0 (CC 14, ch 10) — scale root (C, C#, D, …)
        scale_root_encoder: "encoders[0]",
        // Encoder 1 (CC 15, ch 11) — scale type (ionian, dorian, …)
        scale_type_encoder: "encoders[1]",
        // Encoder 2 (CC 16, ch 12) — chord degree within current section
        chord_degree_encoder: "encoders[2]",
        // Encoder 3 (CC 17, ch 13) — chord quality (major, minor, …)
        chord_quality_encoder: "encoders[3]",
        // Encoder 4 (CC 18, ch 14) — chord inversion
        chord_inversion_encoder: "encoders[4]",
        // Encoder 5 (CC 19, ch 15) — chord voicing / extensions
        chord_voicing_encoder: "encoders[5]",
        // Encoder 6 (CC 20, ch 16) — tempo coarse
        tempo_coarse_encoder: "encoders[6]",
        // Encoder 7 (CC 21, ch 17) — velocity preset
        velocity_preset_encoder: "encoders[7]",
        // Display button 0 (note 36, ch 10) — trigger selected chord
        chord_trigger_button: "display_buttons[0]",
        // Display button 1 (note 37, ch 11) — cycle section focus
        section_next_button: "display_buttons[1]",
        // Display button 2 (note 38, ch 12) — toggle playback
        transport_play_toggle_button: "display_buttons[2]",
      },
    },
  },
};
