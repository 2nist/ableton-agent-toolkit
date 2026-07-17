/** MIDI message type (note, CC, pitch bend, sysex) */
export type MidiMessageType = "note" | "cc" | "pb" | "sysex";

/** A hardware control element definition */
export interface HardwareElement {
  /** MIDI identifier (note number, CC number, PB channel) */
  midi: number;
  /** MIDI channel (0-15) */
  channel: number;
  /** Message type */
  msgType: MidiMessageType;
  /** Human-readable name */
  name: string;
  /** Optional secondary MIDI value (e.g., LED output channel for feedback) */
  ledChannel?: number;
  /** Whether this element supports RGB color */
  isRgb?: boolean;
  /** Sensitivity modifier (for encoders) */
  sensitivityModifier?: number;
  /** Map mode for continuous controls */
  mapMode?: "absolute" | "relativeSignedBit" | "relativeBinaryOffset";
}

/** A matrix of identically-typed controls (pads, buttons) */
export interface ElementMatrix {
  /** 2D array of MIDI identifiers */
  identifiers: number[][];
  /** Width of the matrix */
  width: number;
  /** Height of the matrix */
  height: number;
  /** Element definition for all cells */
  element: Omit<HardwareElement, "midi">;
  /** Whether rows are flipped (top→bottom vs bottom→top) */
  flipRows?: boolean;
}

/** A sysex-based element (custom protocol) */
export interface SysexElement {
  /** Sysex header bytes */
  header: number[];
  /** Name */
  name: string;
  /** Whether first byte of response is the value */
  useFirstByteAsValue?: boolean;
}

/** Complete hardware definition for a controller */
export interface ControllerElements {
  /** Controller model name */
  model: string;
  /** Manufacturer */
  manufacturer: string;
  /** Individual buttons/controls */
  controls: Record<string, HardwareElement>;
  /** Button/pad matrices */
  matrices: Record<string, ElementMatrix>;
  /** Sysex-based elements */
  sysex: Record<string, SysexElement>;
  /** Modifier buttons that alter other controls */
  modifiers: Record<string, HardwareElement>;
  /** Controls modified by shift (original → shifted) */
  modifiedControls: Record<string, string>;
}

/** A mapping from a hardware control to a software target */
export interface ControlMapping {
  /** Hardware element name */
  element: string;
  /** Target component (Mixer, Session, Transport, Device) */
  component: string;
  /** Target property within the component */
  property: string;
}

/** A set of mappings for a component */
export interface ComponentMappings {
  [property: string]: string; // property name → element name
}

/** Complete mapping set for all components */
export interface ControllerMappings {
  /** Mixer component mappings */
  mixer: ComponentMappings;
  /** Session/clip component mappings */
  session: ComponentMappings;
  /** Transport component mappings */
  transport: ComponentMappings;
  /** Device/FX component mappings */
  device: ComponentMappings;
  /** Navigation component mappings */
  navigation: ComponentMappings;
  /** Sub-mode mappings (track buttons, faders, pads) */
  subModes: Record<string, Record<string, ComponentMappings>>;
}

/** Mode behavior type */
export type ModeBehavior =
  | "momentary" // Active while held
  | "latching"  // Toggles on press
  | "reenter";  // Re-enters the mode each press

/** A mode definition — remaps controls when active */
export interface ControllerMode {
  /** Mode name */
  name: string;
  /** Mode group (e.g., "Main_Modes", "Pad_Modes") */
  group: string;
  /** Button that activates this mode */
  activationElement?: string;
  /** Behavior when mode button is pressed */
  behavior: ModeBehavior;
  /** Priority level (higher = overrides lower) */
  priority: number;
  /** Mappings active in this mode */
  mappings: ComponentMappings[];
  /** Sub-modes within this mode */
  subModes?: ControllerMode[];
}

/** Complete mode set for a controller */
export interface ControllerModes {
  /** Mode groups */
  groups: Record<string, ControllerMode[]>;
  /** Default active mode per group */
  defaults: Record<string, string>;
}

/** ReaLearn preset — JSON format for Helgobox ReaLearn import */
export interface ReaLearnPreset {
  /** Format version */
  version: string;
  /** Preset name */
  name: string;
  /** Controller model */
  controller: string;
  /** MIDI mappings */
  mappings: ReaLearnMapping[];
  /** Controller compartment settings */
  controllerCompartment?: {
    /** MIDI input device name */
    inputDevice?: string;
    /** MIDI output device name (for LED feedback) */
    outputDevice?: string;
    /** Whether MIDI feedback is enabled */
    feedbackEnabled?: boolean;
  };
}

/** A single ReaLearn mapping entry */
export interface ReaLearnMapping {
  /** Source: MIDI element on hardware */
  source: {
    /** Type: "midi" or "virtual" */
    type: "midi" | "virtual";
    /** MIDI channel (0-15) */
    channel: number;
    /** MIDI message number (note or CC) */
    number: number;
    /** MIDI message type: "note", "cc", "pb", "sysex" */
    messageType: MidiMessageType;
    /** For CC/pitch bend: 7-bit or 14-bit */
    valueRange?: "7bit" | "14bit";
  };
  /** Target: REAPER action or parameter */
  target: {
    /** Type: "action", "fx_parameter", "track_volume", "track_pan", etc. */
    type: string;
    /** Value: action command ID, parameter index, etc. */
    value: string | number;
    /** For numeric targets: value range */
    valueRange?: [number, number];
  };
  /** Optional glow/feedback settings */
  feedback?: {
    /** LED color mode */
    mode: "velocity" | "note_velocity" | "sysex";
    /** Value range for LED brightness/color */
    valueRange?: [number, number];
  };
  /** Optional grouping for multimodal control */
  group?: string;
  /** Whether this mapping is active by default */
  enabled?: boolean;
  /** Human-readable label */
  label?: string;
}

/** Controller bridge — wraps a controller with its elements, mappings, and modes */
export interface ControllerBridge {
  /** Hardware element definitions */
  elements: ControllerElements;
  /** Software function mappings */
  mappings: ControllerMappings;
  /** Mode definitions */
  modes: ControllerModes;
  /** Export a ReaLearn-compatible preset */
  toReaLearnPreset(): ReaLearnPreset;
  /** Get the MIDI note/CC for a named element */
  getMidi(elementName: string): number | null;
  /** Get all element names */
  getElementNames(): string[];
  /** Validate that all mapped elements exist */
  validate(): { valid: boolean; errors: string[] };
}
