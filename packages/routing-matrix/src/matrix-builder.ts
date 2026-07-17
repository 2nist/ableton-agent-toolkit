import type {
  RoutingNode,
  RoutingConnection,
  RoutingMatrix,
  RouteValidation,
  SignalType,
} from "./types";

/**
 * Create a new routing node.
 */
export function node(
  id: string,
  name: string,
  type: SignalType = "audio",
  kind: RoutingNode["kind"] = "track",
  overrides: Partial<RoutingNode> = {}
): RoutingNode {
  return {
    id,
    name,
    type,
    kind,
    volume: 1.0,
    pan: 0.0,
    muted: false,
    soloed: false,
    recordArmed: false,
    midiInputChannel: -1,
    midiOutputChannel: 0,
    color: 0x808080,
    ...overrides,
  };
}

/**
 * Create a routing connection between two nodes.
 */
export function connect(
  sourceId: string,
  destinationId: string,
  type: RoutingConnection["type"] = "send",
  overrides: Partial<RoutingConnection> = {}
): RoutingConnection {
  return {
    sourceId,
    destinationId,
    volume: 1.0,
    pan: 0.0,
    midiSourceChannel: -1,
    midiDestinationChannel: 0,
    preFader: false,
    preFx: false,
    muted: false,
    type,
    ...overrides,
  };
}

/**
 * Build a complete routing matrix from nodes and connections.
 * Auto-connects tracks to master if no connections specified.
 */
export function buildMatrix(params: {
  nodes: RoutingNode[];
  connections?: RoutingConnection[];
  masterNodeId?: string;
}): RoutingMatrix {
  const nodeMap: Record<string, RoutingNode> = {};
  for (const n of params.nodes) {
    nodeMap[n.id] = n;
  }

  const masterId = params.masterNodeId ?? "master";

  // Auto-create master node if not provided
  if (!nodeMap[masterId]) {
    nodeMap[masterId] = {
      id: masterId,
      name: "Master",
      type: "audio",
      kind: "master",
      volume: 1.0,
      pan: 0.0,
      muted: false,
      soloed: false,
      recordArmed: false,
      midiInputChannel: -1,
      midiOutputChannel: 0,
      color: 0xcccccc,
    };
  }

  const connections = [...(params.connections ?? [])];

  // Auto-connect parent sends: tracks without explicit routing send to master
  const explicitlyRouted = new Set(connections.map((c) => c.sourceId));
  for (const n of params.nodes) {
    if (n.kind === "track" && !explicitlyRouted.has(n.id)) {
      // Check if track has a parent (folder parent)
      const parentId = n.parentId;
      if (parentId && nodeMap[parentId]) {
        connections.push(connect(n.id, parentId, "parent_send"));
      } else {
        connections.push(connect(n.id, masterId, "parent_send"));
      }
    }
  }

  return {
    nodes: nodeMap,
    connections,
    masterNodeId: masterId,
  };
}

/**
 * Validate a routing matrix for errors, warnings, feedback loops,
 * and unconnected nodes.
 */
export function validateRouting(matrix: RoutingMatrix): RouteValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const feedbackLoops: string[][] = [];

  // Check all connections reference valid nodes
  for (const conn of matrix.connections) {
    if (!matrix.nodes[conn.sourceId]) {
      errors.push(`Connection references unknown source node: "${conn.sourceId}"`);
    }
    if (!matrix.nodes[conn.destinationId]) {
      errors.push(`Connection references unknown destination node: "${conn.destinationId}"`);
    }
  }

  // Check master node exists
  if (!matrix.nodes[matrix.masterNodeId]) {
    errors.push(`Master node "${matrix.masterNodeId}" not defined`);
  }

  // Detect feedback loops via DFS cycle detection
  const adj = new Map<string, string[]>();
  for (const conn of matrix.connections) {
    const deps = adj.get(conn.sourceId) ?? [];
    deps.push(conn.destinationId);
    adj.set(conn.sourceId, deps);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(nodeId: string, path: string[]): void {
    if (recStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      const cycle = path.slice(cycleStart).concat(nodeId);
      feedbackLoops.push(cycle);
      return;
    }
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    recStack.add(nodeId);

    const neighbors = adj.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      dfs(neighbor, [...path, nodeId]);
    }

    recStack.delete(nodeId);
  }

  for (const nodeId of Object.keys(matrix.nodes)) {
    if (!visited.has(nodeId)) {
      dfs(nodeId, []);
    }
  }

  if (feedbackLoops.length > 0) {
    for (const loop of feedbackLoops) {
      warnings.push(`Feedback loop detected: ${loop.join(" → ")}`);
    }
  }

  // Find unconnected nodes (no incoming connections, not master)
  const hasIncoming = new Set<string>();
  for (const conn of matrix.connections) {
    hasIncoming.add(conn.destinationId);
  }

  const unconnected: string[] = [];
  for (const n of Object.values(matrix.nodes)) {
    if (n.id !== matrix.masterNodeId && !hasIncoming.has(n.id)) {
      const isSource = adj.has(n.id);
      if (!isSource) {
        unconnected.push(n.name);
      }
    }
  }

  if (unconnected.length > 0) {
    warnings.push(`Unconnected nodes: ${unconnected.join(", ")}`);
  }

  // MIDI-specific checks
  for (const conn of matrix.connections) {
    const src = matrix.nodes[conn.sourceId];
    const dst = matrix.nodes[conn.destinationId];
    if (conn.type === "midi_only" && src && dst && src.type !== "midi" && dst.type !== "midi") {
      warnings.push(`MIDI-only connection between non-MIDI nodes: "${src.name}" → "${dst.name}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    feedbackLoops,
    unconnectedNodes: unconnected,
  };
}

/**
 * Get all connections from a specific source node.
 */
export function getSourceConnections(matrix: RoutingMatrix, nodeId: string): RoutingConnection[] {
  return matrix.connections.filter((c) => c.sourceId === nodeId);
}

/**
 * Get all connections to a specific destination node.
 */
export function getDestinationConnections(matrix: RoutingMatrix, nodeId: string): RoutingConnection[] {
  return matrix.connections.filter((c) => c.destinationId === nodeId);
}

/**
 * Get the signal path from a track to the master output.
 */
export function traceSignalPath(matrix: RoutingMatrix, nodeId: string): string[][] {
  const paths: string[][] = [];
  const visited = new Set<string>();

  function walk(currentId: string, path: string[]) {
    if (visited.has(currentId)) return; // Avoid cycles
    visited.add(currentId);

    const newPath = [...path, currentId];

    if (currentId === matrix.masterNodeId || currentId === "master") {
      paths.push(newPath);
      return;
    }

    const outgoing = getSourceConnections(matrix, currentId);
    if (outgoing.length === 0) {
      paths.push([...newPath, "(dead end)"]);
      return;
    }

    for (const conn of outgoing) {
      walk(conn.destinationId, newPath);
    }
  }

  walk(nodeId, []);
  return paths;
}

/**
 * Build a preset routing template from a declarative spec.
 * Common patterns: sketch mode, full production, live performance.
 */
export function buildPreset(
  name: string,
  nodes: RoutingNode[],
  templateConnections: { from: string; to: string; type: RoutingConnection["type"]; overrides?: Partial<RoutingConnection> }[]
): RoutingMatrix {
  const connections: RoutingConnection[] = templateConnections.map((tc) =>
    connect(tc.from, tc.to, tc.type, tc.overrides)
  );

  return buildMatrix({
    nodes: [...nodes, node("master", "Master", "audio", "master", { volume: 1.0, color: 0xcccccc })],
    connections,
    masterNodeId: "master",
  });
}

/**
 * Sketch Mode routing preset — 8 tracks with Scaler MIDI routing.
 * Matches Activate_Sketch_Mode.lua exactly.
 */
export function sketchModeRouting(): RoutingMatrix {
  const nodes: RoutingNode[] = [
    node("scaler", "Chord Detector (Scaler)", "midi", "track", {
      color: 0xff6600,
      midiInputChannel: -1,
      midiOutputChannel: 0,
    }),
    node("drums", "Drum Sketch", "midi", "track", {
      color: 0xff3333,
      midiInputChannel: -1,
    }),
    node("bass", "Bass Sketch", "audio", "track", {
      color: 0x3366ff,
    }),
    node("chords", "Chord Sketch", "audio", "track", {
      color: 0x33cc33,
    }),
    node("melody", "Melody Sketch", "audio", "track", {
      color: 0xffcc00,
    }),
    node("vocal", "Vocal Sketch", "audio", "track", {
      color: 0xcc66ff,
    }),
    node("scratchpad", "Scratchpad", "audio", "track", {
      color: 0x888888,
    }),
    node("fx_bus", "FX Bus (Muted)", "audio", "bus", {
      muted: true,
      color: 0x666666,
    }),
  ];

  const connections: RoutingConnection[] = [
    // Scaler MIDI → Chord and Melody tracks
    connect("scaler", "chords", "midi_only", {
      midiSourceChannel: -1,
      midiDestinationChannel: 0,
    }),
    connect("scaler", "melody", "midi_only", {
      midiSourceChannel: -1,
      midiDestinationChannel: 0,
    }),
    // Drums, Bass, Chords, Melody, Vocal → Master (auto-connected by buildMatrix)
    // Chords, Melody, Vocal → FX Bus via send
    connect("chords", "fx_bus", "send", { volume: 0.7 }),
    connect("melody", "fx_bus", "send", { volume: 0.5 }),
  ];

  return buildMatrix({ nodes, connections, masterNodeId: "master" });
}

/**
 * Full production routing preset — with subgroup buses.
 */
export function productionRouting(): RoutingMatrix {
  const nodes: RoutingNode[] = [
    // Source tracks
    node("kick", "Kick", "audio", "track", { color: 0xcc0000 }),
    node("snare", "Snare", "audio", "track", { color: 0xcc6600 }),
    node("hats", "Hi-Hats", "audio", "track", { color: 0xcccc00 }),
    node("bass_audio", "Bass", "audio", "track", { color: 0x3366ff }),
    node("guitar1", "Guitar L", "audio", "track", { color: 0x33cc33 }),
    node("guitar2", "Guitar R", "audio", "track", { color: 0x33cc33 }),
    node("keys", "Keys", "audio", "track", { color: 0xcc66ff }),
    node("vox_lead", "Lead Vocal", "audio", "track", { color: 0xff66cc }),
    node("vox_bg1", "BG Vocal 1", "audio", "track", { color: 0xff99cc }),
    // MIDI tracks
    node("midi_keys", "MIDI Keys", "midi", "track", {
      midiInputChannel: 0,
      midiOutputChannel: 0,
    }),
    // Subgroup buses
    node("drums_bus", "Drums Bus", "audio", "bus", { color: 0xaa4444 }),
    node("guitars_bus", "Guitars Bus", "audio", "bus", { color: 0x44aa44 }),
    node("vox_bus", "Vocal Bus", "audio", "bus", { color: 0xaa4488 }),
    // FX returns
    node("reverb", "Reverb Return", "audio", "fx_return", { color: 0x4488cc }),
    node("delay", "Delay Return", "audio", "fx_return", { color: 0x4488cc }),
  ];

  const connections: RoutingConnection[] = [
    // Drums → Drums Bus
    connect("kick", "drums_bus", "parent_send"),
    connect("snare", "drums_bus", "parent_send"),
    connect("hats", "drums_bus", "parent_send"),
    // Guitars → Guitars Bus
    connect("guitar1", "guitars_bus", "parent_send"),
    connect("guitar2", "guitars_bus", "parent_send"),
    // Vocals → Vocal Bus (auto parent send), plus send to reverb
    connect("vox_lead", "reverb", "send", { volume: 0.4 }),
    connect("vox_bg1", "reverb", "send", { volume: 0.3 }),
    connect("keys", "reverb", "send", { volume: 0.25 }),
    connect("keys", "delay", "send", { volume: 0.2 }),
    // MIDI Keys → Keys (sidechain for ducking, or MIDI routing)
    connect("midi_keys", "keys", "midi_only"),
    // Bus → Master (auto parent send via buildMatrix)
  ];

  return buildMatrix({ nodes, connections, masterNodeId: "master" });
}
