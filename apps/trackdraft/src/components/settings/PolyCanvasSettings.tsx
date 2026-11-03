import { usePolyStore, type PolyChordLabels } from "../../store/polyStore";
import { POLY_LANES, type PolyLaneId } from "../../lib/poly/layout";
import MicroLabel from "../common/MicroLabel";

/**
 * The poly canvas's reading preferences — how the lanes stack, and whether a
 * chord is a numeral or a name.
 *
 * Deliberately device-global and never part of the song (plan.md §0.14): two
 * machines laying the canvas out differently is correct, and exporting a
 * preference would mean shipping someone's eyesight with their music.
 *
 * Order is editable **within each side only**. The lanes above the time spine
 * sum to the same units in any order, so within-side order cannot move the
 * canvas's extent or any saved placement; crossing the spine would change both.
 */

const LABELS = new Map<PolyLaneId, string>(
  POLY_LANES.map((lane) => [lane.id, lane.label]),
);

const LABEL_MODES: { id: PolyChordLabels; label: string; hint: string }[] = [
  { id: "roman", label: "i · IV · V", hint: "Scale degrees — key-independent" },
  { id: "letter", label: "Am · F · G", hint: "Chord names — absolute" },
];

export default function PolyCanvasSettings() {
  const prefs = usePolyStore((s) => s.prefs);
  const moveLane = usePolyStore((s) => s.moveLane);
  const setChordLabels = usePolyStore((s) => s.setChordLabels);
  const resetPrefs = usePolyStore((s) => s.resetPrefs);

  /** Top of the canvas first: the lane furthest from the spine reads first. */
  const rows: (PolyLaneId | "spine")[] = [
    ...[...prefs.laneOrder.above].reverse(),
    "spine",
    ...prefs.laneOrder.below,
  ];

  const move = (id: PolyLaneId, direction: -1 | 1) => () =>
    moveLane(id, direction);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <MicroLabel
            className="block mb-1"
            title="How the canvas stacks its lanes around the time spine. Remembered on this device, not in the song."
          >
            Lane order
          </MicroLabel>
          <p className="text-2xs text-inkMuted leading-snug">
            Outside in: the top row is furthest above the spine. Lanes stay on
            their own side, so the canvas height never changes.
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 text-[10px] font-mono text-accent/80 hover:text-accent border border-edge/70 rounded px-1.5 py-0.5"
          onClick={resetPrefs}
          title="Back to the designed order and numerals"
        >
          Reset
        </button>
      </div>

      <ol
        className="space-y-0.5"
        aria-label="Lane order, top of the canvas first"
      >
        {rows.map((row) =>
          row === "spine" ? (
            <li
              key="spine"
              className="flex items-center gap-2 py-1"
              aria-hidden={false}
            >
              <span className="h-px flex-1 bg-edge" />
              <span className="font-mono text-[9px] uppercase tracking-widest text-inkMuted">
                Time
              </span>
              <span className="h-px flex-1 bg-edge" />
            </li>
          ) : (
            <li key={row} className="flex items-center gap-2">
              <span className="w-16 text-2xs text-ink">
                {LABELS.get(row) ?? row}
              </span>
              <span className="flex-1" />
              {([-1, 1] as const).map((direction) => {
                const list =
                  prefs.laneOrder[
                    prefs.laneOrder.above.includes(row) ? "above" : "below"
                  ];
                const index = list.indexOf(row);
                // "Up" in the list means further from the spine for the lanes
                // above it and nearer for the lanes below — the buttons move the
                // lane along its own side, which is the thing being edited.
                const disabled =
                  direction === -1 ? index === 0 : index === list.length - 1;
                return (
                  <button
                    key={direction}
                    type="button"
                    disabled={disabled}
                    onClick={move(row, direction)}
                    aria-label={`Move ${LABELS.get(row) ?? row} ${direction === -1 ? "nearer the spine" : "further from the spine"}`}
                    className="w-5 h-5 grid place-items-center rounded border border-edge/70 text-[10px] text-inkMuted enabled:hover:text-ink enabled:hover:border-inkMuted disabled:opacity-30"
                  >
                    {direction === -1 ? "↑" : "↓"}
                  </button>
                );
              })}
            </li>
          ),
        )}
      </ol>

      <div>
        <MicroLabel
          className="block mb-1"
          title="How the chords lane writes a chord. The colour lane always shows its own chord symbol — its roots differ from the chords it colours, so a numeral there would name the wrong chord."
        >
          Chords read as
        </MicroLabel>
        <div className="flex gap-1">
          {LABEL_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setChordLabels(mode.id)}
              aria-pressed={prefs.chordLabels === mode.id}
              title={mode.hint}
              className={`font-mono text-2xs rounded px-2 py-1 border ${
                prefs.chordLabels === mode.id
                  ? "border-inkMuted text-ink"
                  : "border-edge text-inkMuted hover:text-ink"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
