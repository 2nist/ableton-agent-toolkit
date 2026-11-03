import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { KEY_ROOTS } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import { SCALES } from "../../lib/scales";
import type { BlueprintSong } from "../../types/blueprint";
import { meterLabel, tempoFromDrag } from "../../lib/poly/clock";

/**
 * The song's clock, in the canvas's own corner: tempo, key, scale, meter.
 *
 * Everything here goes through the same `updateCurrentSong` the workbench's
 * settings strip uses, so an edit made on the canvas is the same edit — one
 * undo step, autosaved, and read by the lanes, the ruler and the MIDI export.
 *
 * Presentational on purpose: `onChange` is a patch, so the caller owns the
 * write and a test can watch it without a store.
 */
export default function PolyClockChip({
  song,
  bottom,
  onChange,
}: {
  song: BlueprintSong;
  /** Distance from the stage's bottom edge — the shelf moves this up. */
  bottom: number;
  onChange: (patch: Partial<BlueprintSong>) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Which list is open, if any. A popover rather than a select: the canvas is
  // the only surface here, and a native select on a canvas reads as a web form.
  const [open, setOpen] = useState<"key" | "scale" | null>(null);
  // Scrubbing is a draft until release, exactly like resizing a section: one
  // undo step for the whole drag rather than one per pixel.
  const [scrub, setScrub] = useState<{
    pointerId: number;
    startX: number;
    startBpm: number;
    bpm: number;
  } | null>(null);

  const bpm = scrub ? scrub.bpm : song.bpm;

  // A popover with no dismiss gesture feels stuck: any press outside closes it.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const el = rootRef.current;
      if (el && event.target instanceof Node && el.contains(event.target))
        return;
      setOpen(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  function onTempoDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrub({
      pointerId: event.pointerId,
      startX: event.clientX,
      startBpm: song.bpm,
      bpm: song.bpm,
    });
  }

  function onTempoMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!scrub || scrub.pointerId !== event.pointerId) return;
    setScrub({
      ...scrub,
      bpm: tempoFromDrag(scrub.startBpm, event.clientX - scrub.startX),
    });
  }

  function onTempoUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!scrub || scrub.pointerId !== event.pointerId) return;
    const next = scrub.bpm;
    setScrub(null);
    if (next !== song.bpm) onChange({ bpm: next });
  }

  return (
    <div
      ref={rootRef}
      className="absolute left-2 z-20 flex items-center gap-1 rounded border border-edge bg-panel/85 px-1 py-0.5 font-mono text-[10px] text-inkMuted backdrop-blur-sm"
      style={{ bottom }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        title="Drag left or right to set the tempo — one undo step when you let go"
        aria-label={`Tempo ${bpm} BPM — drag to change`}
        onPointerDown={onTempoDown}
        onPointerMove={onTempoMove}
        onPointerUp={onTempoUp}
        onPointerCancel={() => setScrub(null)}
        className={`cursor-ew-resize tabular-nums px-1 rounded hover:bg-panelAlt ${
          scrub ? "text-ink" : ""
        }`}
        style={{ touchAction: "none" }}
      >
        {bpm} bpm
      </button>

      <button
        type="button"
        title="Key — the tonic every chord is read against"
        onClick={() => setOpen(open === "key" ? null : "key")}
        className="px-1 rounded hover:bg-panelAlt"
      >
        {song.key}
      </button>

      <button
        type="button"
        title="Scale — the mode the harmony tools read"
        onClick={() => setOpen(open === "scale" ? null : "scale")}
        className="px-1 rounded hover:bg-panelAlt"
      >
        {song.scale}
      </button>

      <span className="px-1 opacity-60" title="The song's meter">
        {meterLabel(song)}
      </span>

      {open ? (
        <div
          className="absolute bottom-full left-0 mb-1 rounded border border-edge bg-panel shadow-xl"
          style={{ width: open === "key" ? 116 : 148 }}
        >
          {open === "key" ? (
            <div className="grid grid-cols-4 gap-x-0.5 p-1">
              {KEY_ROOTS.slice(0, 12).map((root) => (
                <button
                  key={root}
                  type="button"
                  onClick={() => {
                    setOpen(null);
                    if (root !== song.key) onChange({ key: root as NoteName });
                  }}
                  className={`rounded px-1 py-1 text-left text-[10px] hover:bg-panelAlt/70 ${
                    root === song.key ? "text-ink" : ""
                  }`}
                >
                  {root}
                </button>
              ))}
            </div>
          ) : (
            <div className="p-1">
              {SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  onClick={() => {
                    setOpen(null);
                    if (scale !== song.scale) {
                      onChange({ scale: scale as ScaleType });
                    }
                  }}
                  className={`flex w-full rounded px-1 py-0.5 text-left text-[10px] hover:bg-panelAlt/70 ${
                    scale === song.scale ? "text-ink" : ""
                  }`}
                >
                  {scale}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
