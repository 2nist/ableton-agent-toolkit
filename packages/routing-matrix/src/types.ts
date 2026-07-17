/** Signal type flowing through a routing node */
export type SignalType = "audio" | "midi";

/** A routing node — a track, bus, FX return, or external send */
export interface RoutingNode {
  /** Unique node identifier */
  id: string;
  /** Display name */
  name: string;
  /** Signal type this node handles */
  type: SignalType;
  /** Node kind */
  kind: "track" | "bus" | "fx_return" | "external_send" | "master";
  /** Volume/gain (0-4, REAPER scale, 1.0 = 0dB) */
  volume: number;
  /** Pan (-1 to 1) */
  pan: number;
  /** Whether node is muted */
  muted: boolean;
  /** Whether node is soloed */
  soloed: boolean;
  /** Whether node is record-armed */
  recordArmed: boolean;
  /** MIDI input channel filter (-1 = all, 0-15 = specific) */
  midiInputChannel: number;
  /** MIDI output channel */
  midiOutputChannel: number;
  /** Color (0xRRGGBB) */
  color: number;
  /** Parent folder/group node ID */
  parentId?: string;
}

/** A directed edge — one node sending to another */
export interface RoutingConnection {
  /** Source node ID */
  sourceId: string;
  /** Destination node ID */
  destinationId: string;
  /** Send volume (0-4) */
  volume: number;
  /** Send pan (-1 to 1) */
  pan: number;
  /** MIDI source channel (-1 = all) */
  midiSourceChannel: number;
  /** MIDI destination channel (0-15) */
  midiDestinationChannel: number;
  /** Whether this send is pre-fader */
  preFader: boolean;
  /** Whether this send is pre-FX */
  preFx: boolean;
  /** Whether this send is currently muted */
  muted: boolean;
  /** Connection type */
  type: "send" | "parent_send" | "sidechain" | "midi_only" | "audio_only";
}

/** A complete routing graph */
export interface RoutingMatrix {
  /** All nodes in the graph */
  nodes: Record<string, RoutingNode>;
  /** All connections (directed edges) */
  connections: RoutingConnection[];
  /** Master output node ID */
  masterNodeId: string;
}

/** Route validation result */
export interface RouteValidation {
  /** Whether routing is valid */
  valid: boolean;
  /** List of errors */
  errors: string[];
  /** List of warnings */
  warnings: string[];
  /** Detected feedback loops */
  feedbackLoops: string[][];
  /** Unconnected nodes */
  unconnectedNodes: string[];
}
