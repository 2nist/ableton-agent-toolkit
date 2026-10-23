import { useEffect, useMemo, useState } from "react";
import type { BlueprintSection, BlueprintSong, TonicRegion } from "../../types/blueprint";
import { borrowedChordIds, detectModeSuggestion, type ModeSuggestion } from "../../lib/harmony/modeInference";

/**
 * ModeInferenceCard — the Harmony tab's "are you borrowing or switching
 * modes?" teaching moment. Derived, not event-fired: it recomputes from the
 * section's live chord set on every render, so it appears when a single
 * confident mode candidate explains the foreign tones and evaporates the
 * moment the chord is deleted or resolved. It never gates a chord add and
 * never applies anything itself — matching the Mix/Bend "suggest, don't
 * impose" ghost.
 *
 * Three exits: Set section to <mode> (one undoable override write), Keep
 * borrowed (records a per-section acknowledgment so it never re-asks for the
 * same candidate), or × (transient dismiss, ~8s auto-dismiss).
 */

interface ModeInferenceCardProps {
  song: BlueprintSong;
  section: BlueprintSection;
  keyName: BlueprintSong["key"];
  scale: BlueprintSong["scale"];
  /** Tonic regions. A modulation already *explains* chords that leave the
   *  song key, so the card must not offer a mode switch for them. */
  regions?: TonicRegion[];
  /** Apply the suggested mode as a per-section scale override (undoable). */
  onAdoptMode: (scale: ModeSuggestion["scale"]) => void;
  /** Record that the user is deliberately keeping this borrowed sound. */
  onKeepBorrowed: (candidateId: string) => void;
}

const AUTO_DISMISS_MS = 8000;

export default function ModeInferenceCard({
  song,
  section,
  keyName,
  scale,
  regions,
  onAdoptMode,
  onKeepBorrowed,
}: ModeInferenceCardProps) {
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  // Derived: recompute the suggestion straight from the section's chords —
  // but only from the ones that are outside their *own* home. Chords that a
  // modulation explains are not borrowing, and must not trigger a mode
  // suggestion (that was the bug: after a key change every diatonic chord of
  // the new key looked foreign to the old one).
  const suggestion = useMemo(() => {
    const borrowed = borrowedChordIds(section.chords, regions, { key: keyName, scale });
    const foreign = section.chords.filter((chord) => borrowed.has(chord.id));
    if (foreign.length === 0) return null;
    return detectModeSuggestion(foreign, keyName, scale);
  }, [section.chords, regions, keyName, scale]);

  const acknowledged = (song.blueprintAcks ?? {})[`${section.id}:${suggestion?.candidateId ?? ""}`];
  const visible = suggestion !== null && !acknowledged && dismissedId !== suggestion.candidateId;

  // Transient dismiss auto-clears; reset whenever a new candidate appears.
  useEffect(() => {
    if (!suggestion) return;
    const id = suggestion.candidateId;
    const t = setTimeout(() => setDismissedId(id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [suggestion?.candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible || !suggestion) return null;

  const names = suggestion.chordNames.join(", ");

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex items-center gap-3 rounded-md border border-accent/40 bg-well px-3 py-2 shadow-lg"
    >
      <span className="text-accent text-sm leading-none" aria-hidden="true">◆</span>
      <p className="flex-1 text-xs text-ink">
        <span className="font-medium">{names}</span>
        <span className="text-inkMuted">{" "}isn't in {keyName} {scale} — it fits{" "}</span>
        <span className="font-medium text-accent">{keyName} {suggestion.label}</span>.
      </p>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          className="rounded border border-accent/60 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/20"
          onClick={() => onAdoptMode(suggestion.scale)}
          title={`Set this section to ${keyName} ${suggestion.label} (undoable)`}
        >
          Set section to {suggestion.label}
        </button>
        <button
          className="rounded border border-edge px-2 py-0.5 text-[11px] text-inkMuted hover:text-ink"
          onClick={() => onKeepBorrowed(`${section.id}:${suggestion.candidateId}`)}
          title="Keep these as borrowed chords — don't suggest this again"
        >
          Keep borrowed
        </button>
        <button
          className="rounded px-1.5 py-0.5 text-[11px] text-inkMuted/70 hover:text-ink"
          onClick={() => setDismissedId(suggestion.candidateId)}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
