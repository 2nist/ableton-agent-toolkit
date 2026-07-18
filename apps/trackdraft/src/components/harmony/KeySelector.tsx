import { KEY_ROOTS } from "@music-theory/core";
import type { ScaleType } from "@music-theory/core";

const WHEEL_KEYS = KEY_ROOTS.slice(0, 12); // 12 unique pitch classes, already circle-of-fifths ordered
const SCALES: ScaleType[] = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];
const RADIUS = 90;
const CENTER = 110;

interface KeySelectorProps {
  activeKey: string;
  activeScale: ScaleType;
  onChangeKey: (key: string) => void;
  onChangeScale: (scale: ScaleType) => void;
}

export default function KeySelector({ activeKey, activeScale, onChangeKey, onChangeScale }: KeySelectorProps) {
  return (
    <div className="flex items-start gap-6">
      <svg width={220} height={220} className="shrink-0">
        {WHEEL_KEYS.map((key, i) => {
          const angle = (i / WHEEL_KEYS.length) * 2 * Math.PI - Math.PI / 2;
          const x = CENTER + RADIUS * Math.cos(angle);
          const y = CENTER + RADIUS * Math.sin(angle);
          const isActive = key === activeKey;
          return (
            <g key={key} transform={`translate(${x}, ${y})`}>
              <circle
                r={18}
                className={`cursor-pointer transition-colors ${
                  isActive ? "fill-accent" : "fill-panelAlt hover:fill-edge"
                }`}
                onClick={() => onChangeKey(key)}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                className={`text-xs pointer-events-none select-none ${isActive ? "fill-black font-semibold" : "fill-ink"}`}
              >
                {key}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="space-y-1">
        <p className="text-xs text-inkMuted uppercase tracking-wide">Mode</p>
        <div className="flex flex-col gap-1">
          {SCALES.map((scale) => (
            <button
              key={scale}
              className={`text-left text-sm px-2 py-1 rounded ${
                scale === activeScale ? "bg-accent text-black font-medium" : "text-inkMuted hover:bg-panelAlt"
              }`}
              onClick={() => onChangeScale(scale)}
            >
              {scale}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
