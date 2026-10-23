import type { BlueprintSection } from "../../types/blueprint";
import { describeProgressionFit, meanBeatsPerBar } from "../../types/blueprint";

/** Trims a beat count to at most 2 decimal places (chord beats can be
 *  half-steps, and non-4/4 time signatures can make beatsPerBar itself
 *  fractional) without showing "4.00" for the common whole-number case. */
function fmtBeats(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/** The progression-vs-section-length relationship, computed with the exact
 *  same arithmetic loopChordsToFill() applies at export time — surfaced in
 *  the hex workspace's bottom-right corner so a progression's actual fit
 *  is never a surprise. "Fit" always means "set bars to exactly one clean
 *  pass of the current progression," a single unambiguous action
 *  regardless of whether the section currently loops or overflows it. */
export default function FitStatus({
  section,
  onSetBars,
}: {
  section: BlueprintSection;
  onSetBars: (bars: number) => void;
}) {
  const fit = describeProgressionFit(section);
  if (!fit) return null;

  const fitBars = Math.max(1, Math.ceil(fit.cycleBeats / meanBeatsPerBar(section)));

  let message: string;
  let showFitButton = false;

  if (fit.overflowBeats > 0) {
    message = `${fmtBeats(fit.cycleBeats)} beats — overflows this ${section.bars}-bar section by ${fmtBeats(fit.overflowBeats)} beats; the extra will be cut off at export.`;
    showFitButton = true;
  } else if (fit.remainderBeats > 0) {
    message = `Loops ×${fit.wholeCycles} plus a ${fmtBeats(fit.remainderBeats)}-beat partial repeat to fill this section.`;
    showFitButton = true;
  } else if (fit.wholeCycles > 1) {
    message = `Loops ×${fit.wholeCycles} to fill this section exactly.`;
  } else {
    message = "Fills this section exactly.";
  }

  return (
    <span className="flex items-center gap-2 font-mono text-[9px] tracking-wide text-inkMuted/70">
      {message}
      {showFitButton && (
        <button
          className="text-accent border border-accent/50 rounded px-1.5 py-0.5 hover:bg-accent/10 normal-case tracking-normal"
          onClick={() => onSetBars(fitBars)}
        >
          Fit to {fitBars} bars
        </button>
      )}
    </span>
  );
}
