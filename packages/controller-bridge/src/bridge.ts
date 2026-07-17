import type {
  ControllerElements,
  ControllerMappings,
  ControllerModes,
  ControllerBridge as ControllerBridgeInterface,
  ReaLearnPreset,
  ReaLearnMapping,
  HardwareElement,
} from "./types";

/**
 * ControllerBridge — ties together hardware elements, software mappings,
 * and modal control for a single MIDI controller.
 *
 * Architecture pattern from Ableton MIDI Remote Scripts:
 *   Elements (hardware) → Mappings (component bindings) → Modes (context switching)
 *
 * Also exports ReaLearn-compatible presets for Helgobox integration.
 */
export class ControllerBridge implements ControllerBridgeInterface {
  elements: ControllerElements;
  mappings: ControllerMappings;
  modes: ControllerModes;

  constructor(
    elements: ControllerElements,
    mappings: ControllerMappings,
    modes: ControllerModes
  ) {
    this.elements = elements;
    this.mappings = mappings;
    this.modes = modes;
  }

  /**
   * Get the MIDI note/CC number for a named element.
   * Handles both direct controls and matrix-sourced elements.
   */
  getMidi(elementName: string): number | null {
    // Check direct controls
    if (this.elements.controls[elementName]) {
      return this.elements.controls[elementName]!.midi;
    }

    // Check modifiers
    if (this.elements.modifiers[elementName]) {
      return this.elements.modifiers[elementName]!.midi;
    }

    // Check matrix elements (e.g., "track_buttons[3]" → track_buttons matrix, index 3)
    const matrixMatch = elementName.match(/^(\w+)\[(\d+)\]$/);
    if (matrixMatch) {
      const matrixName = matrixMatch[1]!;
      const index = parseInt(matrixMatch[2]!);
      const matrix = this.elements.matrices[matrixName];
      if (matrix?.identifiers[0]?.[index] !== undefined) {
        return matrix.identifiers[0][index]!;
      }
    }

    return null;
  }

  /**
   * Get all element names (flattened).
   */
  getElementNames(): string[] {
    return Object.keys(this.elements.controls).concat(
      Object.keys(this.elements.matrices)
    );
  }

  /**
   * Validate that all mapped elements exist in the element definitions.
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const checkMapping = (mapping: Record<string, string>, label: string) => {
      for (const [prop, elementName] of Object.entries(mapping)) {
        if (elementName === "not_mapped") continue;
        if (this.getMidi(elementName) === null) {
          errors.push(
            `${label}: element "${elementName}" not found in controller "${this.elements.model}"`
          );
        }
      }
    };

    // Check main mappings
    checkMapping(this.mappings.mixer, "Mixer mappings");
    checkMapping(this.mappings.session, "Session mappings");
    checkMapping(this.mappings.transport, "Transport mappings");
    checkMapping(this.mappings.device, "Device mappings");
    checkMapping(this.mappings.navigation, "Navigation mappings");

    // Check sub-mode mappings
    for (const [modeGroup, modes] of Object.entries(this.mappings.subModes)) {
      for (const [modeName, mapping] of Object.entries(modes)) {
        checkMapping(mapping, `Sub-mode ${modeGroup}.${modeName}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Export a ReaLearn-compatible preset for Helgobox integration.
   *
   * ReaLearn is the industry-standard MIDI mapping engine for REAPER (272★).
   * These presets allow users to import controller mappings directly into
   * ReaLearn without manual MIDI learn.
   */
  toReaLearnPreset(): ReaLearnPreset {
    const mappings: ReaLearnMapping[] = [];

    // Map component properties to REAPER targets
    const propertyToTarget: Record<string, { type: string; value: string }> = {
      // Mixer
      volume_controls: { type: "track_volume", value: "selected" },
      master_track_volume_control: { type: "track_volume", value: "master" },
      pan_controls: { type: "track_pan", value: "selected" },
      send_controls: { type: "track_send_volume", value: "selected" },
      track_select_buttons: { type: "action", value: "select_track" },
      solo_buttons: { type: "track_solo", value: "selected" },
      mute_buttons: { type: "track_mute", value: "selected" },
      arm_buttons: { type: "track_arm", value: "selected" },
      // Transport
      play_button: { type: "transport", value: "play" },
      stop_button: { type: "transport", value: "stop" },
      record_button: { type: "transport", value: "record" },
      loop_button: { type: "transport", value: "repeat" },
      metronome_button: { type: "transport", value: "metronome" },
      undo_button: { type: "action", value: "40029" },
      // Session
      clip_launch_buttons: { type: "fx", value: "clip_launch" },
      stop_track_clip_buttons: { type: "fx", value: "clip_stop" },
      scene_launch_buttons: { type: "fx", value: "scene_launch" },
    };

    const addMappings = (
      componentMappings: Record<string, string>,
      group?: string
    ) => {
      for (const [prop, elementName] of Object.entries(componentMappings)) {
        if (elementName === "not_mapped") continue;
        const midi = this.getMidi(elementName);
        if (midi === null) continue;

        const element = this.findElement(elementName);
        const target = propertyToTarget[prop] ?? {
          type: "action",
          value: prop,
        };

        mappings.push({
          source: {
            type: "midi",
            channel: element?.channel ?? 0,
            number: midi,
            messageType: element?.msgType ?? "note",
          },
          target,
          label: `${this.elements.model}: ${prop} → ${elementName}`,
          ...(group ? { group } : {}),
        });
      }
    };

    // Export main mappings
    addMappings(this.mappings.mixer, "mixer");
    addMappings(this.mappings.session, "session");
    addMappings(this.mappings.transport, "transport");
    addMappings(this.mappings.device, "device");
    addMappings(this.mappings.navigation, "navigation");

    // Export sub-mode mappings
    for (const [, modes] of Object.entries(this.mappings.subModes)) {
      for (const [modeName, modeMappings] of Object.entries(modes)) {
        addMappings(modeMappings, modeName);
      }
    }

    return {
      version: "2.16.0",
      name: `${this.elements.model} — ${this.elements.manufacturer}`,
      controller: this.elements.model,
      mappings,
      controllerCompartment: {
        feedbackEnabled: true,
      },
    };
  }

  /**
   * Find a hardware element by name.
   */
  private findElement(name: string): HardwareElement | null {
    // Direct controls
    if (this.elements.controls[name]) return this.elements.controls[name]!;

    // Modifiers
    if (this.elements.modifiers[name]) return this.elements.modifiers[name]!;

    // Matrix elements
    const matrixMatch = name.match(/^(\w+)\[(\d+)\]$/);
    if (matrixMatch) {
      const matrix = this.elements.matrices[matrixMatch[1]!];
      if (matrix) {
        return {
          midi: matrix.identifiers[0]?.[parseInt(matrixMatch[2]!)] ?? 0,
          channel: matrix.element.channel,
          msgType: matrix.element.msgType,
          name: matrix.element.name,
          isRgb: matrix.element.isRgb,
          mapMode: matrix.element.mapMode,
        };
      }
    }

    return null;
  }
}
