import { RHYTHM_SEEDS, seedRhythmGrid } from "@drum/library";
import { isRhythmGrid, parseRhythmGrid } from "@music-theory/core";

interface RhythmGridEditorProps {
  /** The chord's grid — sixteen digits, or absent for "the articulation plays it". */
  rhythm?: string;
  onChange: (rhythm: string | undefined) => void;
}

/** The step levels, in the order a click cycles them. 0 is silent. */
const CYCLE = [0, 2, 3, 1] as const;
const LEVEL_LABEL = ["off", "ghost", "normal", "accent"];
/** Height of each level's bar, so the shape of the groove is readable. */
const LEVEL_HEIGHT = ["0%", "36%", "66%", "100%"];

/**
 * A chord's rhythm, sixteen sixteenths to a bar.
 *
 * Deliberately the same grid the plug-in shows: click a step to cycle off →
 * normal → accent → ghost, seed it from the Euclidean rule the drum engine
 * already uses, or clear it and let the articulation play the chord across its
 * beats. The digits it writes are the plug-in's wire format, so a rhythm
 * authored here is the rhythm the DAW plays.
 *
 * Seeds produce plain digits rather than a pattern id: nothing in the file has
 * to keep pointing at a table that may change later.
 */
export default function RhythmGridEditor({ rhythm, onChange }: RhythmGridEditorProps) {
  const levels = parseRhythmGrid(rhythm);
  const active = levels !== null;

  function cycle(step: number) {
    // A first click turns the grid on at "normal", so one click already makes a
    // rhythm; after that the step cycles through the levels.
    const next = levels ? [...levels] : new Array<number>(16).fill(0);
    const current = next[step] as (typeof CYCLE)[number];
    const index = CYCLE.indexOf(current);
    next[step] = CYCLE[(index + 1) % CYCLE.length];
    onChange(isRhythmGrid(next.join("")) ? next.join("") : undefined);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-1">
        <p
          className="text-2xs text-inkMuted uppercase tracking-wide"
          title="Sixteenths of the bar. The articulation plays each hit: a block, a strum or an arpeggio."
        >
          Rhythm
        </p>
        <div className="flex items-center gap-1">
          <select
            className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-2xs text-ink"
            value=""
            title="Fill the grid from the drum engine's Euclidean rule"
            onChange={(event) => {
              const seed = RHYTHM_SEEDS[Number(event.target.value)];
              if (seed) onChange(seedRhythmGrid(seed));
            }}
          >
            <option value="">Seed…</option>
            {RHYTHM_SEEDS.map((seed, index) => (
              <option key={seed.name} value={index}>
                {seed.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="text-2xs border border-edge rounded px-1.5 py-0.5 text-inkMuted hover:text-ink hover:border-inkMuted disabled:opacity-40"
            disabled={!active}
            title="Give the chord back to its articulation"
            onClick={() => onChange(undefined)}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex items-end gap-[3px] h-8">
        {Array.from({ length: 16 }, (_, step) => {
          const level = levels?.[step] ?? 0;
          const isBeat = step % 4 === 0;
          return (
            <button
              key={step}
              type="button"
              data-level={level}
              className={`relative flex-1 h-full rounded-sm bg-well border ${
                isBeat ? "border-edge" : "border-edge/40"
              } hover:border-inkMuted`}
              title={`Step ${step + 1}: ${LEVEL_LABEL[level]} — click to cycle off, normal, accent, ghost`}
              onClick={() => cycle(step)}
            >
              <span
                className={`absolute inset-x-0 bottom-0 rounded-sm ${
                  level === 3 ? "bg-accent" : "bg-inkMuted"
                }`}
                style={{ height: LEVEL_HEIGHT[level], opacity: active ? 1 : 0.4 }}
              />
            </button>
          );
        })}
      </div>

      <p className="text-2xs text-inkMuted/80 leading-tight">
        {active
          ? "Hits on the sixteenths above; the effect plays each one."
          : "No grid — the effect plays the chord across its beats."}
      </p>
    </div>
  );
}
