import { fromBlueprintSong, classifyNarrative, NARRATIVE_FORMS, type NarrativeForm, type FormMatch } from "@music-theory/song-taxonomy";
import type { BlueprintSong } from "../types/blueprint";

export type ConfidenceTier = "high" | "medium" | "new";

export interface SongClassification {
  match: FormMatch;
  /** The matched form's full record (name, definition, exemplars) — null
   *  when nothing scored above threshold (`match.formId === null`). */
  form: NarrativeForm | null;
  /** Display label: the form's name, or a "new form" fallback. */
  label: string;
  /** True when the engine deliberately declined to force-fit a form —
   *  its own "propose, don't force-fit" contract (classify.ts), not an
   *  error state. */
  isNewForm: boolean;
  confidenceTier: ConfidenceTier;
  runnerUpForm: NarrativeForm | null;
}

const FORMS_BY_ID = new Map(NARRATIVE_FORMS.map((form) => [form.id, form]));

function tierFor(match: FormMatch): ConfidenceTier {
  if (match.formId === null) return "new";
  return match.score >= 0.85 ? "high" : "medium";
}

/**
 * Classifies a song's section-role skeleton against the mined narrative-form
 * taxonomy — the same call `songStore.repair.test.ts` already exercises to
 * verify repair doesn't corrupt classification, just wrapped for display use
 * (form name lookup, a friendly label, and a tier) instead of a raw
 * `FormMatch`. This is the whole engine's first UI-facing consumer.
 */
export function classifySong(song: BlueprintSong): SongClassification {
  const match = classifyNarrative(fromBlueprintSong(song), NARRATIVE_FORMS);
  const form = match.formId ? FORMS_BY_ID.get(match.formId) ?? null : null;
  const runnerUpForm = match.runnerUp ? FORMS_BY_ID.get(match.runnerUp.formId) ?? null : null;
  const isNewForm = match.formId === null;

  return {
    match,
    form,
    label: form?.name ?? "New / unclassified form",
    isNewForm,
    confidenceTier: tierFor(match),
    runnerUpForm,
  };
}
