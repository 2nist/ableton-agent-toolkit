import { MODE_DATA, pitchClass } from "@music-theory/core";
import type { ScaleType, NoteName } from "@music-theory/core";
import { getDiatonicHexCells, hexToPixel, hexPoints } from "../../lib/harmony/hexGrid";
import { chordDisplayName, functionColorHex } from "../../lib/harmony/chordBuilder";

const HEX_SIZE = 34;
const PADDING = 60;
const ACCENT = "#ffa500";

interface HexWheelProps {
  keyName: NoteName;
  scale: ScaleType;
  usedDegrees: ReadonlySet<string>;
  onSelectDegree: (degree: string, root: number, quality: string) => void;
}

export default function HexWheel({ keyName, scale, usedDegrees, onSelectDegree }: HexWheelProps) {
  const keyPc = pitchClass(keyName);
  const mode = MODE_DATA[scale];
  if (!mode) return null;
  const cells = getDiatonicHexCells();
  const degreeLabels = mode.degrees;

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
        const entry = mode.map[label];
        if (!entry) return null;
        const absRoot = (keyPc + entry.pc) % 12;
        const name = chordDisplayName(absRoot, entry.triad, keyName);
        const isUsed = usedDegrees.has(label);
        const hex = functionColorHex(entry.func) ?? "#8a8a92";
        const stroke = isUsed || entry.isBorrowed ? ACCENT : hex;

        return (
          <g
            key={`${pos.q},${pos.r}`}
            transform={`translate(${pos.x + offsetX}, ${pos.y + offsetY})`}
            className="cursor-pointer transition-opacity hover:opacity-80"
            onClick={() => onSelectDegree(label, entry.pc, entry.triad)}
          >
            <polygon
              points={hexPoints(HEX_SIZE)}
              style={{ fill: hex, fillOpacity: isUsed ? 0.35 : 0.12, stroke, strokeWidth: isUsed ? 2.5 : 1.5 }}
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
