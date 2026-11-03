import type { RoleStyle } from "../../lib/roleColors";

/**
 * The docked shelf — parked sections as chrome, not as canvas.
 *
 * §0.12's shelf was a band of world space below the lanes, which meant the only
 * way to see what you had parked was to pan to it (or press `F`). The shelf is
 * a place you *keep* things, not a place you look at, so it is now a strip along
 * the bottom of the canvas at a fixed size: always in view, never in the way of
 * the arrangement, and completely outside the camera.
 *
 * It renders nothing when the shelf is empty, so it costs no height until there
 * is something to park.
 */

export interface PolyShelfItem {
  /** Stage key (`section#2`) — what unparking is keyed by. */
  key: string;
  name: string;
  role: RoleStyle;
  /** "8b · 4×2" — the facts a section needs to be recognisable. */
  summary: string;
  ordinal: number;
}

interface Props {
  items: PolyShelfItem[];
  onRestore: (key: string) => void;
}

export const POLY_SHELF_H = 64;

export default function PolyShelfStrip({ items, onRestore }: Props) {
  if (items.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={`Shelf — ${items.length} parked section${items.length === 1 ? "" : "s"}`}
      className="absolute bottom-0 left-0 right-0 flex items-center gap-1 border-t border-edge/70 bg-panel/95 px-2 backdrop-blur-sm"
      style={{ height: POLY_SHELF_H }}
    >
      <span
        className="shrink-0 pr-1 font-mono text-[9px] uppercase tracking-widest text-inkMuted/70"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        title="Parked sections still play in their own place — to put one back, click it"
      >
        shelf
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            title={`${item.name} · ${item.summary} — click to put it back on the spine`}
            aria-label={`Restore ${item.name} from the shelf`}
            onClick={() => onRestore(item.key)}
            className="flex h-11 min-w-0 shrink-0 items-center gap-2 rounded border px-2 text-left"
            style={{
              borderColor: "rgb(var(--c-edge) / 0.8)",
              background: `${item.role.bg}26`,
              maxWidth: 200,
            }}
          >
            <span
              className="h-7 w-1 shrink-0 rounded-sm"
              style={{ background: item.role.bg }}
            />
            <span className="min-w-0 flex flex-col">
              <span className="truncate text-2xs font-medium text-ink">
                {item.name}
              </span>
              <span className="truncate font-mono text-[9px] text-inkMuted">
                #{item.ordinal} · {item.summary}
              </span>
            </span>
          </button>
        ))}
      </div>
      <span className="shrink-0 pl-1 font-mono text-[9px] text-inkMuted/50">
        click to restore
      </span>
    </div>
  );
}
