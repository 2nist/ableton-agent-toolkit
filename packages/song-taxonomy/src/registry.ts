import narrativeFormsData from "./data/narrative-forms.json" with { type: "json" };
import candidatesData from "./data/candidates.json" with { type: "json" };
import type { NarrativeForm } from "./types.js";
import type { NarrativeCandidate } from "./candidates.js";

/**
 * The taxonomy bundled at build time — what any webview/runtime consumer
 * (TrackDraft's UI) gets. This is a snapshot: growing the taxonomy (by
 * re-running `mine-corpora.ts`, or eventually editing it by hand once the
 * taxonomy tab exists) requires a rebuild to reach this export, matching
 * the precedent in `packages/drum-library/src/presetData.ts`. Scripts
 * that need to read or write the *live* file (`mine-corpora.ts`,
 * `classify-corpora.ts`, `promote-candidates.ts`) work directly against
 * `src/data/*.json` via `fs` instead of through this module, so adding a
 * class from a script needs no rebuild — only the bundled snapshot does.
 */
export const NARRATIVE_FORMS: NarrativeForm[] = narrativeFormsData as NarrativeForm[];
export const NARRATIVE_CANDIDATES: NarrativeCandidate[] = candidatesData as NarrativeCandidate[];
