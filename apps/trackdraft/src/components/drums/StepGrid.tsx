import { useMemo } from "react";
import type { PackedNote } from "@drum/library";
import { cellsFromNotes, stepsForBar, velocityTier } from "../../lib/drums/gridCells";
import { useDrumLanes } from "./laneStyle";

/**
 * A section's resolved groove as a step sequencer — lanes down, steps across.
 *
 * Three things this gets right that a necklace row could not:
 *
 * 1. **Velocity tiers.** The E-GMD takes are full of ghost notes: 45% of all
 *    snare hits in `standard` sit below velocity 45. Drawn identically they
 *    read as a backbeat twice as busy as the kick — which is exactly what a
 *    listener reported. Ghosts draw dim and short, accents full height, so
 *    the backbeat appears where it actually is.
 * 2. **A bar, not a loop.** Steps come from the section's meter (16ths in
 *    4/4, 12 in 3/4), so a 2-beat source loop still reads against the bar
 *    ruler instead of filling half the row.
 * 3. **Empty is legible.** A section with no groove still draws its lanes, so
 *    the pane says "nothing programmed" instead of going blank.
 */
export default function StepGrid({
  notes,
  beatsPerBar,
  dim = false,
}: {
  notes: readonly PackedNote[];
  beatsPerBar: number;
  /** True when this previews what *would* play (a muted section). */
  dim?: boolean;
}) {
  const lanes = useDrumLanes();
  const { stepsPerBar: steps, stepBeats } = stepsForBar(beatsPerBar);

  // One cell per lane per step; a cell keeps the loudest hit that lands on it.
  // The mapping is the shared one, so this grid and the block editor never
  // disagree about which cell a hit belongs to.
  const cells = useMemo(
    () => cellsFromNotes(notes, lanes, steps, stepBeats),
    [notes, lanes, steps, stepBeats],
  );

  const anyHits = cells.size > 0;

  return (
    <div
      className="w-full overflow-x-auto"
      style={{ opacity: dim ? 0.5 : anyHits ? 1 : 0.55 }}
      title={`Step sequencer — ${steps} steps per bar${dim ? " (preview)" : ""}`}
    >
      <div style={{ minWidth: steps * 6 }}>
        {lanes.map((lane) => {
          const row = cells.get(lane.key);
          return (
            <div key={lane.key} className="flex items-center gap-1 mb-[2px] last:mb-0">
              <span
                className="shrink-0 w-8 text-[8px] font-mono uppercase tracking-wide text-right"
                style={{ color: row ? lane.color : undefined, opacity: row ? 1 : 0.3 }}
              >
                {lane.label}
              </span>
              <div
                className="flex-1 grid gap-[1px]"
                style={{ gridTemplateColumns: `repeat(${steps}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: steps }, (_, i) => {
                  const velocity = row?.get(i);
                  const tier = velocity === undefined ? undefined : velocityTier(velocity);
                  const ghost = tier === "ghost";
                  const accent = tier === "accent";
                  // Beat 1 of each 4 stays visible so the grid reads in 4/4
                  // without a second ruler row.
                  const beat = i % 4 === 0;
                  return (
                    <span
                      key={i}
                      className="h-2 rounded-[1px]"
                      style={{
                        background: velocity === undefined ? (beat ? "rgba(0,0,0,0.13)" : "rgba(0,0,0,0.06)") : lane.color,
                        opacity: ghost ? 0.3 : 1,
                        // Velocity also reads as height: accents taller than
                        // ordinary hits, ghosts smaller still.
                        transform:
                          velocity === undefined ? undefined : `scaleY(${accent ? 1 : ghost ? 0.55 : 0.8})`,
                      }}
                      title={
                        velocity === undefined
                          ? undefined
                          : `${lane.label} · step ${i + 1} · velocity ${velocity}`
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
