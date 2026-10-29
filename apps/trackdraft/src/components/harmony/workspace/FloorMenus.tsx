import { useState } from "react";
import type { ChordQuality, NoteName, ScaleType } from "@music-theory/core";
import type { Chord } from "../../../types/blueprint";
import type { HarmonyEvent } from "../../../lib/harmony/analysis";
import {
  bassOptions,
  substitutionOptions,
} from "../../../lib/harmony/chordEdits";
import {
  closeRestAt,
  extendIntoRestAt,
  FLOOR_STEP,
} from "../../../lib/harmony/floorLayout";
import { QUALITIES, chordLabel } from "./floorLabel";
import type { Node } from "./floorTypes";

type SubstitutionPick = ReturnType<typeof substitutionOptions>[number];

export interface RestMenuProps {
  beat: number;
  x: number;
  y: number;
  chords: Chord[];
  onChangeChords: (chords: Chord[]) => void;
  onClose: () => void;
  onReadout: (message: string) => void;
}

/** The menu on a silence: give it to the chord before, or take it out. */
export function RestMenu({
  beat,
  x,
  y,
  chords,
  onChangeChords,
  onClose,
  onReadout,
}: RestMenuProps) {
  return (
    <div
      className="absolute z-30 w-[170px] rounded border border-edge bg-panel p-1 shadow-lg"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-1 px-1 font-mono text-[8px] uppercase tracking-wider text-inkMuted/70">
        rest · beat {beat + 1}
      </div>
      <button
        type="button"
        className="w-full rounded border border-edge px-1 py-0.5 text-left font-mono text-[9px] text-inkMuted hover:text-ink"
        title="Give this silence to the chord before it"
        onClick={() => {
          onChangeChords(extendIntoRestAt(chords, beat + 0.01));
          onClose();
          onReadout("silence given to the chord before it");
        }}
      >
        extend previous chord
      </button>
      <button
        type="button"
        className="mt-0.5 w-full rounded border border-edge px-1 py-0.5 text-left font-mono text-[9px] text-inkMuted hover:text-ink"
        title="Remove the silence — everything after moves earlier"
        onClick={() => {
          onChangeChords(closeRestAt(chords, beat + 0.01));
          onClose();
          onReadout("rest closed up");
        }}
      >
        remove rest
      </button>
      <div className="mt-1 px-1 font-mono text-[8px] text-inkMuted/60">
        or click it to place a chord
      </div>
    </div>
  );
}

export interface ChordMenuProps {
  node: Node;
  event: HarmonyEvent | undefined;
  x: number;
  y: number;
  keyName: NoteName;
  scale: ScaleType;
  onQuality: (quality: ChordQuality) => void;
  onBass: (inversion: number) => void;
  onToggleSpread: () => void;
  onSubstitution: (pick: SubstitutionPick) => void;
  /** The two ways this pitch can be read, when it sits between scale steps.
   *  Null for a scale pitch: it has one name and nothing to choose. */
  spellings: { sharp: string; flat: string } | null;
  activeSpelling: "sharp" | "flat" | null;
  onSpelling: (spelling: "sharp" | "flat") => void;
  /** Widen or narrow the silence after the chord (not its length). */
  onNudgeRest: (delta: number) => void;
  onDelete: () => void;
  onRunUp: (span: number) => void;
  onRehome: () => void;
  /** Cut the section in two so this chord starts a new one. */
  onSplitHere?: () => void;
  onClose: () => void;
}

/** The only chord menu in the app: quality, bass, substitution, lane, length. */
export function ChordMenu({
  node,
  event,
  x,
  y,
  keyName,
  scale,
  onQuality,
  onBass,
  onToggleSpread,
  onSubstitution,
  spellings,
  activeSpelling,
  onSpelling,
  onNudgeRest,
  onDelete,
  onRunUp,
  onRehome,
  onSplitHere,
  onClose,
}: ChordMenuProps) {
  const [hoverQuality, setHoverQuality] = useState<ChordQuality | null>(null);

  const picks = event
    ? substitutionOptions(node.chord, event, keyName, scale)
    : [];
  // A run up to THIS chord eats the tail of whatever comes before, so the
  // chord being run up to never moves.
  const runUpSpan = Math.min(
    2,
    Math.max(FLOOR_STEP, node.start > 0 ? node.start : node.beats - FLOOR_STEP),
  );

  return (
    <div
      className="absolute z-30 w-[236px] rounded border border-edge bg-panel p-1.5 shadow-lg"
      style={{ left: x, top: y }}
      onPointerDown={(event_) => event_.stopPropagation()}
    >
      <div className="mb-1 flex items-baseline gap-1 px-1">
        <b className="font-mono text-[11px] text-ink">{event?.roman}</b>
        <span className="hand-value text-base leading-none text-accent">
          {event?.absoluteName}
        </span>
        <span className="ml-auto font-mono text-[8px] text-inkMuted">
          {node.start + 1}–{node.start + node.beats}
        </span>
      </div>
      <div
        className={`mb-1 px-1 font-mono text-[9px] ${hoverQuality ? "text-track" : "text-inkMuted/60"}`}
      >
        →{" "}
        {hoverQuality
          ? chordLabel(
              keyName,
              scale,
              node.degree,
              node.accidental,
              hoverQuality,
            )
          : (event?.absoluteName ?? "")}
      </div>
      <div className="flex flex-wrap gap-0.5">
        {QUALITIES.map((quality) => (
          <button
            key={quality}
            type="button"
            onClick={() => onQuality(quality)}
            onMouseEnter={() => setHoverQuality(quality)}
            onMouseLeave={() => setHoverQuality(null)}
            className={`rounded border px-1 py-0.5 font-mono text-[9px] ${
              node.chord.quality === quality
                ? "border-accent bg-accent/15 text-accent"
                : "border-edge text-inkMuted hover:text-ink"
            }`}
          >
            {quality}
          </button>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-0.5 border-t border-edge/60 pt-1">
        <span className="mr-1 font-mono text-[8px] uppercase tracking-wider text-inkMuted/70">
          bass
        </span>
        {bassOptions(node.chord).map((option) => (
          <button
            key={option.inversion}
            type="button"
            title="Which chord tone sits in the bass"
            onClick={() => onBass(option.inversion)}
            className={`rounded border px-1 py-0.5 font-mono text-[9px] ${
              (node.chord.voicing?.inversion ?? 0) === option.inversion
                ? "border-accent bg-accent/15 text-accent"
                : "border-edge text-inkMuted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          title="Stack the upper voices open"
          onClick={onToggleSpread}
          className={`rounded border px-1 py-0.5 font-mono text-[9px] ${
            node.chord.voicing?.spread === "open"
              ? "border-accent bg-accent/15 text-accent"
              : "border-edge text-inkMuted hover:text-ink"
          }`}
        >
          spread
        </button>
      </div>

      {picks.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-0.5 border-t border-edge/60 pt-1">
          <span className="mr-1 font-mono text-[8px] uppercase tracking-wider text-inkMuted/70">
            sub
          </span>
          {picks.map((pick) => (
            <button
              key={`${pick.root}-${pick.quality}`}
              type="button"
              title={pick.why}
              onClick={() => onSubstitution(pick)}
              className="rounded border border-edge px-1 py-0.5 font-mono text-[9px] text-inkMuted hover:text-ink"
            >
              {pick.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-1 flex items-center gap-0.5 border-t border-edge/60 pt-1">
        {spellings && (
          <>
            <span className="mr-1 font-mono text-[8px] uppercase tracking-wider text-inkMuted/70">
              spell
            </span>
            {(["sharp", "flat"] as const).map((option) => (
              <button
                key={option}
                type="button"
                title="The same pitch, named the other way — the number in the chart changes, the sound does not"
                onClick={() => onSpelling(option)}
                className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                  activeSpelling === option
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-edge text-inkMuted hover:text-ink"
                }`}
              >
                {spellings[option]}
              </button>
            ))}
          </>
        )}
        <span className="ml-1 font-mono text-[8px] uppercase tracking-wider text-inkMuted/70">
          rest
        </span>
        <button
          type="button"
          onClick={() => onNudgeRest(-FLOOR_STEP)}
          className="rounded border border-edge px-1 py-0.5 font-mono text-[9px] text-inkMuted hover:text-ink"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => onNudgeRest(FLOOR_STEP)}
          className="rounded border border-edge px-1 py-0.5 font-mono text-[9px] text-inkMuted hover:text-ink"
        >
          +
        </button>
        <button
          type="button"
          className="ml-auto rounded border border-edge px-1 py-0.5 font-mono text-[9px] text-inkMuted hover:border-danger hover:text-danger"
          onClick={onDelete}
        >
          delete
        </button>
      </div>
      <div className="mt-1 space-y-0.5 border-t border-edge/60 pt-1">
        <button
          type="button"
          className="w-full rounded border border-edge px-1 py-0.5 text-left font-mono text-[9px] text-inkMuted hover:text-ink"
          onClick={() => {
            onRunUp(runUpSpan);
            onClose();
          }}
        >
          run-up before · {runUpSpan}b
        </button>
        <button
          type="button"
          className="w-full rounded border border-edge px-1 py-0.5 text-left font-mono text-[9px] text-inkMuted hover:text-ink"
          onClick={() => {
            onRehome();
            onClose();
          }}
        >
          rehome here · {node.chord.root}
        </button>
        {onSplitHere && (
          <button
            type="button"
            className="w-full rounded border border-edge px-1 py-0.5 text-left font-mono text-[9px] text-inkMuted hover:border-accent hover:text-ink"
            title="Start a new section at this chord — the bar arithmetic follows automatically"
            onClick={() => {
              onSplitHere();
              onClose();
            }}
          >
            start a section here · beat {node.start + 1}
          </button>
        )}
      </div>
    </div>
  );
}
