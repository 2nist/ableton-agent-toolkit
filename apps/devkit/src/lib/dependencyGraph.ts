import type { Node, Edge } from "reactflow";
import registry, { CATEGORY_COLORS, type ComponentEntry } from "./componentRegistry.generated";

/** Build reactflow nodes & edges from the component registry */
export function buildGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodeMap = new Map<string, ComponentEntry>();
  for (const c of registry) nodeMap.set(c.name, c);

  // Create nodes
  const nodes: Node[] = registry.map((c, i) => {
    const col = CATEGORY_COLORS[c.category];
    return {
      id: c.name,
      type: "default",
      position: { x: 0, y: 0 }, // layout will arrange these
      data: {
        label: c.name,
        category: c.category,
        description: c.description,
        color: col,
      },
      style: {
        border: `2px solid ${col}`,
        background: `${col}1a`,
        color: col,
        borderRadius: "8px",
        padding: "12px 16px",
        fontSize: "13px",
        fontWeight: 600,
        width: "auto",
      },
    };
  });

  // Create edges from deps
  const edges: Edge[] = [];
  for (const c of registry) {
    for (const depName of c.deps) {
      if (nodeMap.has(depName)) {
        edges.push({
          id: `${depName}→${c.name}`,
          source: depName,
          target: c.name,
          animated: true,
          style: {
            stroke: "#4a4a55",
            strokeWidth: 1.5,
          },
        });
      }
    }
  }

  return { nodes, edges };
}

/** Simple layered layout: put leaves at the bottom, root containers at the top */
export function applyLayeredLayout(nodes: Node[], edges: Edge[]): Node[] {
  // Kahn's algorithm for topological sort → assign layers
  const indegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  for (const n of nodes) {
    indegree.set(n.id, 0);
    outEdges.set(n.id, []);
  }
  for (const e of edges) {
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    outEdges.get(e.source)?.push(e.target);
  }

  const layers = new Map<string, number>();
  const queue: string[] = [];

  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id);
  }

  let maxLayer = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    const layer = layers.get(id) ?? 0;
    for (const child of outEdges.get(id) ?? []) {
      const childLayer = Math.max(layers.get(child) ?? 0, layer + 1);
      layers.set(child, childLayer);
      maxLayer = Math.max(maxLayer, childLayer);
      const rem = (indegree.get(child) ?? 1) - 1;
      indegree.set(child, rem);
      if (rem === 0) queue.push(child);
    }
  }

  const H_GAP = 220;
  const V_GAP = 120;

  // Group nodes by layer
  const layerGroups = new Map<number, string[]>();
  for (const n of nodes) {
    const l = layers.get(n.id) ?? 0;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(n.id);
  }

  // Assign positions
  const positioned = nodes.map((n) => {
    const layer = layers.get(n.id) ?? 0;
    const group = layerGroups.get(layer) ?? [];
    const idx = group.indexOf(n.id);
    const totalWidth = (group.length - 1) * H_GAP;
    const startX = -totalWidth / 2;

    return {
      ...n,
      position: {
        x: startX + idx * H_GAP,
        y: layer * V_GAP,
      },
    };
  });

  return positioned;
}