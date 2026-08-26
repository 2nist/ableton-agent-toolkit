import type { ControllerModes } from "../types";

/**
 * APC mini mk1 Mode Definitions
 *
 * Unlike the other controllers in this package, the MK1 isn't driving
 * Ableton-function mappings directly — it's used as a bank-switchable MIDI
 * CC router (see apps/apc-mk1-utility): each fader bank re-numbers the same
 * 8 physical faders to a different block of output CC values, which the
 * user then MIDI-maps (Cmd+M) straight onto Ableton Live's Clip View
 * Pitch/Time/Transform/Generate tools and clip utilities — none of which
 * are reachable through the Live API/AbletonOSC, only through Live's native
 * MIDI mapping.
 *
 * This mode group only tracks which bank is active; the `mappings` entries
 * are labels for introspection, not Ableton-function targets (there is
 * deliberately no `apc-mini-mk1` mappings file — see index.ts). The actual
 * CC translation lives in the consuming app's router.
 *
 * Bank-select buttons are the unshifted `track_buttons[0..4]` — real
 * hardware notes 64-68 (see elements/apc-mini-mk1.ts).
 */
export const APC_MINI_MK1_MODES: ControllerModes = {
  groups: {
    Fader_Banks: [
      {
        name: "pitch",
        group: "Fader_Banks",
        activationElement: "track_buttons[0]",
        behavior: "latching",
        priority: 10,
        mappings: [{ pitch_controls: "faders" }],
      },
      {
        name: "time",
        group: "Fader_Banks",
        activationElement: "track_buttons[1]",
        behavior: "latching",
        priority: 10,
        mappings: [{ time_controls: "faders" }],
      },
      {
        name: "transform",
        group: "Fader_Banks",
        activationElement: "track_buttons[2]",
        behavior: "latching",
        priority: 10,
        mappings: [{ transform_controls: "faders" }],
      },
      {
        name: "generate",
        group: "Fader_Banks",
        activationElement: "track_buttons[3]",
        behavior: "latching",
        priority: 10,
        mappings: [{ generate_controls: "faders" }],
      },
      {
        name: "clip_tools",
        group: "Fader_Banks",
        activationElement: "track_buttons[4]",
        behavior: "latching",
        priority: 10,
        mappings: [{ clip_tool_controls: "faders" }],
      },
    ],
  },
  defaults: {
    Fader_Banks: "pitch",
  },
};
