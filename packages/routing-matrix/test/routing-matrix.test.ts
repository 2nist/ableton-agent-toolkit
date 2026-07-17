/**
 * Baseline regression suite for the ported @daw/routing-matrix.
 * See @music-theory/core's test file for why this exists despite not
 * mirroring an upstream suite — there wasn't one to mirror.
 */

import { describe, expect, it } from "vitest";
import {
  buildMatrix,
  buildPreset,
  connect,
  getDestinationConnections,
  getSourceConnections,
  node,
  productionRouting,
  sketchModeRouting,
  traceSignalPath,
  validateRouting,
} from "../src/index.js";

describe("node / connect factories", () => {
  it("applies sensible defaults and allows overrides", () => {
    const n = node("kick", "Kick", "audio", "track", { color: 0xff0000 });
    expect(n).toMatchObject({ id: "kick", volume: 1.0, pan: 0.0, color: 0xff0000 });
  });
});

describe("buildMatrix", () => {
  it("auto-creates a master node when none is provided", () => {
    const matrix = buildMatrix({ nodes: [node("kick", "Kick")] });
    expect(matrix.nodes.master).toBeDefined();
    expect(matrix.masterNodeId).toBe("master");
  });

  it("auto-connects tracks with no explicit routing to the master node", () => {
    const matrix = buildMatrix({ nodes: [node("kick", "Kick")] });
    const conns = getSourceConnections(matrix, "kick");
    expect(conns).toHaveLength(1);
    expect(conns[0]).toMatchObject({ destinationId: "master", type: "parent_send" });
  });

  it("does not double-route a track that already has an explicit connection", () => {
    const matrix = buildMatrix({
      nodes: [node("kick", "Kick"), node("drums_bus", "Drums Bus", "audio", "bus")],
      connections: [connect("kick", "drums_bus", "parent_send")],
    });
    expect(getSourceConnections(matrix, "kick")).toHaveLength(1);
  });

  it("routes a track to its parentId instead of master when one is set", () => {
    const matrix = buildMatrix({
      nodes: [
        node("kick", "Kick", "audio", "track", { parentId: "drums_bus" }),
        node("drums_bus", "Drums Bus", "audio", "bus"),
      ],
    });
    expect(getSourceConnections(matrix, "kick")[0]).toMatchObject({ destinationId: "drums_bus" });
  });
});

describe("validateRouting", () => {
  it("flags connections referencing unknown nodes", () => {
    const matrix = buildMatrix({ nodes: [node("kick", "Kick")] });
    matrix.connections.push(connect("kick", "does-not-exist"));
    const result = validateRouting(matrix);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unknown destination node/);
  });

  it("detects a feedback loop between two nodes", () => {
    const matrix = buildMatrix({
      nodes: [node("a", "A"), node("b", "B")],
      connections: [connect("a", "b"), connect("b", "a")],
    });
    const result = validateRouting(matrix);
    expect(result.feedbackLoops.length).toBeGreaterThan(0);
  });

  it("flags a MIDI-only connection between two non-MIDI nodes as a warning", () => {
    const matrix = buildMatrix({
      nodes: [node("a", "A", "audio"), node("b", "B", "audio")],
      connections: [connect("a", "b", "midi_only")],
    });
    const result = validateRouting(matrix);
    expect(result.warnings.some((w) => w.includes("MIDI-only connection"))).toBe(true);
  });

  it("passes cleanly for a well-formed matrix with no cycles", () => {
    const matrix = buildMatrix({ nodes: [node("kick", "Kick"), node("snare", "Snare")] });
    const result = validateRouting(matrix);
    expect(result.valid).toBe(true);
    expect(result.feedbackLoops).toEqual([]);
  });
});

describe("traceSignalPath", () => {
  it("traces a track's path to master", () => {
    const matrix = buildMatrix({ nodes: [node("kick", "Kick")] });
    const paths = traceSignalPath(matrix, "kick");
    expect(paths).toEqual([["kick", "master"]]);
  });

  it("marks a node with no outgoing connections as a dead end", () => {
    const matrix = buildMatrix({
      nodes: [node("kick", "Kick"), node("orphan", "Orphan")],
      connections: [connect("kick", "master")],
    });
    // orphan has no outgoing connections because it was never auto-routed
    // (buildMatrix only auto-routes "track" kind nodes without explicit connections,
    // and orphan IS a track, so it actually gets auto-connected — use a non-track kind instead)
    const busMatrix = buildMatrix({
      nodes: [node("fx", "FX Return", "audio", "fx_return")],
    });
    const paths = traceSignalPath(busMatrix, "fx");
    expect(paths[0]![paths[0]!.length - 1]).toBe("(dead end)");
  });
});

describe("buildPreset / sketchModeRouting / productionRouting", () => {
  it("sketchModeRouting builds a valid matrix with 8 tracks + master", () => {
    const matrix = sketchModeRouting();
    expect(Object.keys(matrix.nodes)).toHaveLength(9); // 8 defined + auto master
    expect(validateRouting(matrix).valid).toBe(true);
  });

  it("productionRouting builds a valid matrix with subgroup buses", () => {
    const matrix = productionRouting();
    expect(validateRouting(matrix).valid).toBe(true);
    expect(getDestinationConnections(matrix, "drums_bus").length).toBe(3); // kick, snare, hats
  });

  it("buildPreset wires declarative from/to connections and adds a master node", () => {
    const matrix = buildPreset(
      "minimal",
      [node("a", "A")],
      [{ from: "a", to: "master", type: "send" }]
    );
    expect(matrix.nodes.master).toBeDefined();
    expect(getSourceConnections(matrix, "a")).toHaveLength(1);
  });
});
