import { useMemo, useCallback } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { buildGraph, applyLayeredLayout } from "../lib/dependencyGraph";
import { CATEGORY_COLORS } from "../lib/componentRegistry.generated";

interface Props {
  selectedComponent: string | null;
  onSelectComponent: (name: string) => void;
}

/**  Render an interactive dependency graph using reactflow. */
export default function ComponentGraph({ selectedComponent, onSelectComponent }: Props) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = buildGraph();
    const positioned = applyLayeredLayout(nodes, edges);
    return { initialNodes: positioned, initialEdges: edges };
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Highlight selected node
  const styledNodes = useMemo(() => {
    return nodes.map((n) => {
      const isSelected = n.id === selectedComponent;
      const col = CATEGORY_COLORS[n.data.category as keyof typeof CATEGORY_COLORS] ?? "#888";
      return {
        ...n,
        style: {
          ...n.style,
          border: `2px solid ${col}`,
          background: isSelected ? `${col}33` : `${col}1a`,
          boxShadow: isSelected ? `0 0 12px ${col}66` : undefined,
        },
      };
    });
  }, [nodes, selectedComponent]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectComponent(node.id);
    },
    [onSelectComponent],
  );

  return (
    <div className="h-full w-full bg-canvas rounded-lg border border-edge overflow-hidden">
      <div className="px-3 py-2 border-b border-edge flex items-center justify-between">
        <h2 className="text-xs font-semibold text-inkMuted uppercase tracking-wider">
          Component Graph
        </h2>
        <div className="flex gap-3 text-[10px] text-inkMuted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-harmony" /> Harmony
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-structure" /> Structure
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-lyrics" /> Lyrics
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: "#ec4899" }} /> Layout
          </span>
        </div>
      </div>
      <ReactFlow
        nodes={styledNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        attributionPosition="bottom-left"
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#2e2e34" gap={20} />
        <Controls className="!bg-panel !border-edge !rounded" />
        <MiniMap
          style={{ background: "#1a1a1e", border: "1px solid #2e2e34" }}
          maskColor="rgba(0,0,0,0.5)"
        />
      </ReactFlow>
    </div>
  );
}