import { useMemo, useState } from "react";
import { drumPocket, pocketSummary, buildEuclideanOutline, twoThreeCellCounts } from "@drum/library";
import { beatsPerBar, type BlueprintSection } from "../../../types/blueprint";
import { usePalette, withAlpha } from "../../../theme/palette";

/**
 * GROOVE-AS-GLUE — the drums' pocket, made visible and clickable.
 *
 * Two halves of the same idea, both of which lived in the engine (and in the
 * Harmony inspector) but never on the drum surface itself:
 *
 *  1. **Pocket** — measure the section's drums (`drumPocket`) and impose that
 *     timing + velocity feel on the bass and/or the chord comping
 *     (`glueToPocket`). Persisted as `section.grooveGlue`; applied by the
 *     shared planners, so .mid ≡ live-out ≡ Ableton.
 *  2. **Harmony lock** — whether the chord progression advances on its own
 *     `beats`, on a Euclidean outline, or on the DRUMS' meter. The same
 *     three modes the Harmony facet offers, surfaced where you can hear the
 *     drums you are locking to.
 *
 * The chip reads the pocket live (mean offset + how many of the grid's slots
 * the drums actually touch), so "behind the beat" is a number, not a vibe.
 */
export default function GrooveGlue({
  section,
  drumBeats,
  onWrite,
}: {
  section: BlueprintSection;
  /** The section's resolved hits — what you are gluing TO. */
  drumBeats: readonly { beat: number; velocity: number }[];
  onWrite: (mutate: (sec: BlueprintSection) => BlueprintSection) => void;
}) {
  const P = usePalette();
  const [open, setOpen] = useState(false);
  const glue = section.grooveGlue;
  const targets = [glue?.bass ? "B" : null, glue?.chords ? "C" : null].filter(Boolean).join("·");

  const pocket = useMemo(
    () => (drumBeats.length > 0 ? pocketSummary(drumPocket(drumBeats, beatsPerBar(section))) : null),
    [drumBeats, section],
  );

  const mode: "beats" | "euclid" | "drums" = section.harmonyMeterOutline
    ? "euclid"
    : section.harmonyFollowsDrums === false
      ? "beats"
      : section.harmonyFollowsDrums === true
        ? "drums"
        : section.drumMeterOutline
          ? "drums"
          : "beats";

  const setGlue = (next: Partial<NonNullable<BlueprintSection["grooveGlue"]>>) =>
    onWrite((sec) => {
      const merged = { ...(sec.grooveGlue ?? {}), ...next };
      const on = merged.bass || merged.chords;
      return { ...sec, grooveGlue: on ? merged : undefined };
    });

  const setMode = (m: "beats" | "euclid" | "drums") =>
    onWrite((sec) => {
      if (m === "beats") return { ...sec, harmonyMeterOutline: undefined, harmonyFollowsDrums: false };
      if (m === "drums") return { ...sec, harmonyMeterOutline: undefined, harmonyFollowsDrums: true };
      return {
        ...sec,
        harmonyFollowsDrums: undefined,
        harmonyMeterOutline:
          sec.harmonyMeterOutline ?? buildEuclideanOutline(7, 8, twoThreeCellCounts(7)[0]!, 0),
      };
    });

  const active = !!glue?.bass || !!glue?.chords;
  const strength = Math.round((glue?.strength ?? 1) * 100);

  const btn = (on: boolean, label: string, onClick: () => void, title: string) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="font-mono text-2xs rounded-sm px-1.5 py-0.5 border"
      style={{
        borderColor: on ? P.track : P.grid,
        color: on ? P.track : P.label,
        background: on ? withAlpha(P.track, 0.14) : "transparent",
      }}
    >
      {label}
    </button>
  );

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          "Groove glue — put the bass and the chords in the drums' pocket" +
          "\nand lock the harmony's rhythm to the drums"
        }
        className="font-mono text-2xs rounded-sm px-1.5 py-0.5 border flex items-center gap-1"
        style={{
          borderColor: active ? P.track : P.grid,
          color: active ? P.track : P.label,
          background: active ? withAlpha(P.track, 0.12) : "transparent",
        }}
      >
        <span aria-hidden>⛓</span>
        GLUE{targets ? ` ${targets}` : ""}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onPointerDown={() => setOpen(false)} />
          <div
            className="absolute z-40 rounded border p-2 flex flex-col gap-1.5"
            style={{ top: 24, left: 0, width: 260, background: P.deep, borderColor: P.grid }}
          >
            <span className="font-mono uppercase" style={{ fontSize: 7, letterSpacing: "0.14em", color: P.label, opacity: 0.65 }}>
              drums' pocket · what we glue to
            </span>
            <span className="font-mono tabular-nums" style={{ fontSize: 10, color: pocket ? P.track : P.label, opacity: pocket ? 1 : 0.6 }}>
              {pocket
                ? `${pocket.meanOffsetMs === 0 ? "on the grid" : `${pocket.meanOffsetMs > 0 ? "+" : ""}${pocket.meanOffsetMs} ms ${pocket.behind ? "behind" : "ahead"}`} · ${pocket.slots} slots played`
                : "no hits to measure"}
            </span>

            <span className="font-mono uppercase mt-1" style={{ fontSize: 7, letterSpacing: "0.14em", color: P.label, opacity: 0.65 }}>
              put in the pocket
            </span>
            <span className="flex items-center gap-1">
              {btn(!!glue?.bass, "BASS", () => setGlue({ bass: !glue?.bass }), "Move the bass line onto the drums' pocket (exported + Ableton)")}
              {btn(!!glue?.chords, "CHORDS", () => setGlue({ chords: !glue?.chords }), "Move the chord comping onto the drums' pocket (exported + Ableton)")}
            </span>

            <label className="flex items-center gap-2 mt-0.5" style={{ opacity: active ? 1 : 0.45 }}>
              <span className="font-mono" style={{ fontSize: 8, color: P.label }}>STRENGTH</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={strength}
                disabled={!active}
                onChange={(e) => setGlue({ strength: Number(e.target.value) / 100 })}
                className="flex-1"
                style={{ accentColor: P.track, height: 10 }}
                title="How much of the drums' measured feel to impose — 0% leaves the parts on the grid"
              />
              <span className="font-mono tabular-nums" style={{ fontSize: 9, color: P.track, width: 26, textAlign: "right" }}>
                {strength}%
              </span>
            </label>

            <span className="font-mono uppercase mt-1" style={{ fontSize: 7, letterSpacing: "0.14em", color: P.label, opacity: 0.65 }}>
              harmony rhythm (euclid lock)
            </span>
            <span className="flex items-center gap-1">
              {btn(mode === "beats", "BEATS", () => setMode("beats"), "Chords advance on their own beats")}
              {btn(mode === "euclid", "EUCLID", () => setMode("euclid"), "Chords advance on a Euclidean 2s/3s outline")}
              {btn(mode === "drums", "DRUMS", () => setMode("drums"), "Chords advance on the drums' meter — the drums drive the harmony")}
            </span>
            <span className="font-mono" style={{ fontSize: 7.5, color: P.label, opacity: 0.55, lineHeight: 1.35 }}>
              Glue is exported (preview = .mid = live out = Ableton). Harmony lock is a rhythm choice, not a pocket.
            </span>
          </div>
        </>
      )}
    </span>
  );
}
