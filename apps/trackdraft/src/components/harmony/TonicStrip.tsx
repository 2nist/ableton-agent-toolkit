import type { NoteName, ScaleType } from "@music-theory/core";
import type { Chord, TonicRegion } from "../../types/blueprint";
import { setTonicAt } from "../../lib/harmony/tonic";

/** The section's home notes, on one line: what the key finder proposed, and
 *  the two controls that correct it. A modulation inside a section is a
 *  musical judgement, so inference is allowed to be wrong here — the author
 *  re-homes at a chord and that boundary is marked, so a later inference run
 *  can't move it. */
export default function TonicStrip({
  chords,
  regions,
  stored,
  keyName,
  scale,
  selectedChordId,
  onChange,
}: {
  chords: Chord[];
  /** In force right now — authored if any, otherwise inferred. */
  regions: TonicRegion[];
  /** Just the authored ones, so "follow the chords" only appears when it fits. */
  stored?: TonicRegion[];
  keyName: NoteName;
  scale: ScaleType;
  selectedChordId: string | null;
  onChange: (regions: TonicRegion[] | undefined) => void;
}) {
  /** Section-relative beat where the selected chord's first pass begins. */
  const selectedStart = (() => {
    if (!selectedChordId) return null;
    let beat = 0;
    for (const chord of chords) {
      if (chord.id === selectedChordId) return beat;
      beat += chord.beats;
    }
    return null;
  })();
  const selectedChord = chords.find((chord) => chord.id === selectedChordId) ?? null;

  function rehomeHere() {
    if (!selectedChord || selectedStart === null) return;
    onChange(setTonicAt(regions, { startBeat: selectedStart, key: selectedChord.root, scale }));
  }

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
      <span className="text-inkMuted/60">home</span>
      {regions.map((region, index) => (
        <span
          key={`${region.startBeat}-${index}`}
          className={`rounded border px-1 py-0.5 ${
            region.source === "authored"
              ? "border-accent/60 bg-accent/10 text-accent"
              : "border-edge/60 bg-panelAlt text-inkMuted"
          }`}
          title={
            region.source === "authored"
              ? "You set this home — inference will not move it"
              : "Inferred from the chords"
          }
        >
          {region.source === "authored" ? "⌂ " : ""}
          {region.key} {region.scale}
          {region.startBeat > 0 ? ` · beat ${region.startBeat}` : ""}
        </span>
      ))}
      {regions.length === 1 && (
        <span className="text-inkMuted/40">— one home for the whole section</span>
      )}
      <button
        type="button"
        className="ml-1 rounded border border-edge/70 px-1 py-0.5 text-inkMuted hover:text-ink disabled:opacity-40"
        disabled={!selectedChord}
        onClick={rehomeHere}
        title={
          selectedChord
            ? `Make ${selectedChord.root} the home from this chord on — a modulation, not a borrowed chord`
            : "Select a chord first"
        }
      >
        ⌂ home from here
      </button>
      {stored && stored.length > 0 && (
        <button
          type="button"
          className="rounded border border-edge/70 px-1 py-0.5 text-inkMuted hover:text-ink"
          onClick={() => onChange(undefined)}
          title="Drop the authored homes and let the key finder decide again"
        >
          follow the chords
        </button>
      )}
      <span className="text-inkMuted/40">{keyName}</span>
    </div>
  );
}
