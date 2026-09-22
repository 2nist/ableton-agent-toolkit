import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { BlueprintSong } from "../../types/blueprint";
import { beatsPerBar } from "../../types/blueprint";
import type { SectionSpan } from "../../lib/arrangement";
import { useDrumsSelectionStore } from "../../store/drumsSelectionStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import DrumsView, { CLASSIC_BAR_PX } from "../drums/DrumsView";

/** The six lane families a picked range covers — the same ids the Blocks
 *  marquee writes (`DrumLaneId`), so a click here and a marquee there are
 *  the same selection shape. */
const ALL_LANES = ["kick", "snare", "rim", "hat", "cym", "tom"];

/**
 * The workbench's drum LINE VIEW — the classic whole-song canvas (the
 * actual Drums-view renderer, embedded: `DrumsView embedded`), cropped to
 * a window around the focused section with context on both sides, so the
 * transition into and out of the section and any internal detours are all
 * in view. This is the ladder's middle rung (user-specified 2026-09-21:
 * "just the line view with enough space before and after the section").
 *
 * Every click on the lines/glyphs routes to the beat-by-beat rung: the
 * clicked bar — or, when the click lands on a detour's span or the
 * section's transition tail, that whole range — is staged into the drums
 * selection and the Blocks editor opens on it. Zero rendering is
 * duplicated: the canvas IS DrumsView, so the two views can't drift.
 */
export default function DrumLineEmbed({
  song,
  span,
  onEngage,
}: {
  song: BlueprintSong;
  span: SectionSpan;
  /** Called whenever the user clicks the canvas — the workbench flips the
   *  rail to the Drums tools so the thing you just touched is editable. */
  onEngage?: () => void;
}) {
  const navigate = useNavigate();
  const { songId } = useParams<{ songId: string }>();
  const id = songId ?? song.id;
  const setSharedSection = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const setRange = useDrumsSelectionStore((s) => s.setRange);

  // Measure the crop box so the fitted zoom keeps the whole focused
  // section + 4 bars of context on each side inside it.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const zoom = boxW > 0 ? Math.min(1.6, Math.max(0.4, boxW / ((span.bars + 8) * CLASSIC_BAR_PX))) : 1;

  /** A click landed on (span, beatInSection, dive) — resolve it to a RANGE
   *  and STAGE it (section + range become the drum tools' target; the
   *  canvas renders drafts, so tool edits preview right here on the
   *  line). A DOUBLE click additionally dives to the Blocks editor.
   *  Range priority: the detour's own span → the transition tail (manual
   *  bars, or the 1-bar auto-fill zone) → the bar under the cursor. */
  function pick(pickedSpan: SectionSpan, beat: number, dive: boolean) {
    const sec = pickedSpan.section;
    const bpb = beatsPerBar(sec);
    const duration = pickedSpan.durationBeats;

    const vBars = sec.drumVariationBars ?? 1;
    const vSpan = Math.min(vBars * bpb, duration);
    const vStart = sec.drumVariationOutline ? (sec.drumVariationStartBeat ?? duration - vSpan) : null;

    let a: number;
    let b: number;
    if (vStart != null && beat >= vStart - 1e-6 && beat < vStart + vSpan - 1e-6) {
      a = vStart;
      b = Math.min(duration, vStart + vSpan);
    } else {
      const tBars = Math.max(1, sec.drumTransitionModel ? (sec.drumTransitionBars ?? 1) : 1);
      const tStart = Math.max(0, duration - Math.min(duration, tBars * bpb));
      if (beat >= tStart - 1e-6) {
        a = tStart;
        b = duration;
      } else {
        const barStart = Math.floor(beat / bpb) * bpb;
        a = barStart;
        b = Math.min(duration, barStart + bpb);
      }
    }

    // Section first, then the range — the store drops a range when the
    // section changes, so order matters here. Staging makes this section
    // + range the target of the drums tools (rail tab), WITHOUT leaving
    // the workbench; the double-click dives to the Blocks editor.
    setSharedSection(pickedSpan.sectionId);
    setRange({ startBeat: a, endBeat: b, laneKeys: ALL_LANES });
    onEngage?.();
    if (!dive) return;
    try {
      localStorage.setItem("trackdraft-drums-view", "blocks");
    } catch {
      /* ignore */
    }
    navigate(`/song/${id}/drums`);
  }

  return (
    <div className="w-full">
      {/* Caption row — what this is, and what a click does */}
      <div className="flex items-center gap-2 mb-1 px-0.5">
        <span className="text-[9px] font-mono text-inkMuted/50 truncate">
          classic line view — click a bar, detour or transition to edit it with the drum tools (▦ in the rail) · double-click to
          open beat-by-beat on that range
        </span>
        <span className="flex-1" />
        <span className="shrink-0 text-[9px] font-mono text-inkMuted/40 tabular-nums" title="Timeline zoom (fitted so this section + 4 bars of context fit)">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* The crop box — the canvas scrolls itself to keep the focused
          section (plus context) in view; all click routing lives on the
          canvas's own hit surfaces (lanes, boundaries, necklace nodes,
          detour dots → pick a range → beat-by-beat). */}
      <div
        ref={boxRef}
        className="relative w-full overflow-hidden rounded-md border border-edge/60 bg-black"
        title="The classic drum arrangement — click to edit that range beat-by-beat"
      >
        <DrumsView embedded zoom={zoom} highlightSectionId={span.sectionId} onPickRange={pick} />
      </div>
    </div>
  );
}
