import { MODE_DATA, pitchClass } from "@music-theory/core";
import type { ScaleType, NoteName } from "@music-theory/core";
import { getDiatonicHexCells, hexToPixel, hexPoints } from "../../lib/harmony/hexGrid";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";

const HEX_SIZE = 34;
const PADDING = 60;

interface HexWheelProps {
  keyName: NoteName;
  scale: ScaleType;
  onSelectDegree: (degree: string, root: number, quality: string) => void;
}

export default function HexWheel({ keyName, scale, onSelectDegree }: HexWheelProps) {
  const keyPc = pitchClass(keyName);
  const cells = getDiatonicHexCells();
  const degreeLabels = MODE_DATA[scale].degrees;

  const positions = cells.map((cell) => ({ ...cell, ...hexToPixel(cell.q, cell.r, HEX_SIZE) }));
  const minX = Math.min(...positions.map((p) => p.x));
  const maxX = Math.max(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y));
  const maxY = Math.max(...positions.map((p) => p.y));
  const width = maxX - minX + PADDING * 2;
  const height = maxY - minY + PADDING * 2;
  const offsetX = -minX + PADDING;
  const offsetY = -minY + PADDING;

  return (
    <svg width={width} height={height}>
      {positions.map((pos) => {
        const label = degreeLabels[pos.degreeIndex];
        const entry = MODE_DATA[scale].map[label];
        if (!entry) return null;
        const absRoot = (keyPc + entry.pc) % 12;
        const name = chordDisplayName(absRoot, entry.triad, keyName);

        return (
          <g
            key={`${pos.q},${pos.r}`}
            transform={`translate(${pos.x + offsetX}, ${pos.y + offsetY})`}
            className="cursor-pointer"
            onClick={() => onSelectDegree(label, entry.pc, entry.triad)}
          >
            <polygon
              points={hexPoints(HEX_SIZE)}
              className="fill-panelAlt stroke-edge hover:fill-accent/20 transition-colors"
              strokeWidth={1.5}
            />
            <text
              y={-6}
              textAnchor="middle"
              className="fill-inkMuted text-[10px] pointer-events-none select-none"
            >
              {label}
            </text>
            <text
              y={10}
              textAnchor="middle"
              className="fill-ink text-xs font-medium pointer-events-none select-none"
            >
              {name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
