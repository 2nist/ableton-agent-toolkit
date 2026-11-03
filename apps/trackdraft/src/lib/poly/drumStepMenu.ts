/**
 * A painted drum step's right-click menu (§S1.10).
 *
 * §S1.8 and §S1.9 put hold, ratchet and flam on drags and modifiers, because
 * they are the verbs you reach for *while* sketching. Probability is not: it is
 * a generative decision you make once and then leave alone, and a modifier that
 * every click has to be careful of is a bad trade for it. So it gets a menu —
 * the same shape as the chord menu §S1.1 added, which is what the same request
 * ("the right click menu the harmony view has") asked for on the other lane.
 *
 * The menu also carries ratchet, flam and hold as rows. Those are the *legible*
 * versions of the modifiers: discoverable, and reachable when a cell is four
 * pixels wide. Two gestures for one write is deliberate — fast path and
 * explainable path — and both go through the same `patchPaintedStep`, so they
 * cannot disagree.
 *
 * Every function takes a section and returns one, so the component is a button
 * and the edit is a test.
 */

import type { BlueprintSection } from "../../types/blueprint";
import { stepsBlockId } from "./drumSteps";
import type { DrumStepAuthored, DrumStepWindow } from "./drumSteps";
import {
  patchPaintedStep,
  setDrumStepGate,
  MIN_DRUM_GATE,
  RATCHET_LADDER,
  MAX_RATCHET,
} from "./drumSteps";
import { toggleDrumStep } from "./drumSteps";
import type { DrumLaneId } from "@drum/library";

/** The ratchet row: how many sub-hits the gate is split into. */
export const STEP_MENU_RATCHETS: readonly { value: number; label: string }[] =
  RATCHET_LADDER.map((value) => ({
    value,
    label: value === 1 ? "×1" : `×${value}`,
  }));

/** The probability row. Four rungs, because a step is either there or it is a
 *  coin-flip — 25/50/75 covers "sometimes", "half" and "usually". */
export const STEP_MENU_PROBS: readonly { value: number; label: string }[] = [
  { value: 1, label: "always" },
  { value: 0.75, label: "75%" },
  { value: 0.5, label: "50%" },
  { value: 0.25, label: "25%" },
];

/** The hold row, in CELLS — the unit the lane is drawn in, converted to beats by
 *  the caller with the section's own cell length. */
export const STEP_MENU_HOLDS: readonly number[] = [1, 2, 4];

/** What the menu's header says, and what a screen reader hears on the cell. */
export function stepMenuTitle(
  laneLabel: string,
  index: number,
  columns: number,
  authored: DrumStepAuthored | null,
): string {
  const parts = [`${laneLabel} step ${index + 1} of ${columns}`];
  if (authored?.gate !== undefined) parts.push(`${authored.gate} beat hold`);
  if (authored && authored.ratchet > 1) parts.push(`×${authored.ratchet}`);
  if (authored?.flam) parts.push("flam");
  if (authored && authored.prob < 1)
    parts.push(`${Math.round(authored.prob * 100)}%`);
  return parts.join(" · ");
}

type Edit = DrumStepWindow & { lane: DrumLaneId };

function repatch(
  section: BlueprintSection,
  edit: Edit,
  patch: { ratchet?: number; flam?: boolean; prob?: number },
): BlueprintSection {
  const next = patchPaintedStep(
    section.drumBlocks as Parameters<typeof patchPaintedStep>[0],
    { ...edit, patch },
  );
  return next ? { ...section, drumBlocks: next } : section;
}

/** Split the step's gate into `ratchet` sub-hits. */
export function withStepRatchet(
  section: BlueprintSection,
  edit: Edit,
  ratchet: number,
): BlueprintSection {
  return repatch(section, edit, {
    ratchet: Math.max(1, Math.min(MAX_RATCHET, Math.round(ratchet))),
  });
}

/** How often the step plays. 1 is the absent case, not a stored `prob: 1`. */
export function withStepProbability(
  section: BlueprintSection,
  edit: Edit,
  prob: number,
): BlueprintSection {
  return repatch(section, edit, { prob: Math.max(0, Math.min(1, prob)) });
}

/** Grace the step. */
export function withStepFlam(
  section: BlueprintSection,
  edit: Edit,
  flam: boolean,
): BlueprintSection {
  return repatch(section, edit, { flam });
}

/** How long the step holds, in beats. Clamped so it cannot ring past the
 *  section — a hit cannot outlive the bars it lives in. */
export function withStepGate(
  section: BlueprintSection,
  edit: Edit,
  beats: number,
  limitBeats: number,
): BlueprintSection {
  const next = setDrumStepGate(
    section.drumBlocks as Parameters<typeof setDrumStepGate>[0],
    { ...edit, beats: Math.max(MIN_DRUM_GATE, beats), limitBeats },
  );
  return next ? { ...section, drumBlocks: next } : section;
}

/** Take the step out — the same write a plain click makes, so the menu's Clear
 *  and the cell's click are one behaviour. */
export function withoutStep(
  section: BlueprintSection,
  edit: Edit,
): BlueprintSection {
  const next = toggleDrumStep(
    section.drumBlocks as Parameters<typeof toggleDrumStep>[0],
    { ...edit, on: false },
  );
  return { ...section, drumBlocks: next };
}

/** The block id this menu edits — exported so a test can assert the menu and the
 *  cell address the same block. */
export function stepMenuBlockId(edit: Edit): string {
  return stepsBlockId(edit.lane, edit.startBeat, edit.endBeat);
}
