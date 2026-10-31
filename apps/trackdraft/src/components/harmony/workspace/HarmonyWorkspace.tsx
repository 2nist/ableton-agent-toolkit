import { useMemo } from "react";
import { meanBeatsPerBar } from "../../../types/blueprint";
import { analyzeSection } from "../../../lib/harmony/analysis";
import {
  useHarmonyWorkspaceStore,
  type HarmonyDesk,
} from "../../../store/harmonyWorkspaceStore";
import Segmented from "../../common/Segmented";
import ComposeDesk from "./ComposeDesk";
import RehearseDesk from "./RehearseDesk";
import StudyDesk from "./StudyDesk";
import type { HarmonyDeskProps } from "./types";

const DESKS: { id: HarmonyDesk; label: string; hint: string }[] = [
  {
    id: "compose",
    label: "Compose",
    hint: "write here · the strip owns time, the lens owns the map",
  },
  {
    id: "rehearse",
    label: "Rehearse",
    hint: "read here · nothing edits the song",
  },
  { id: "study", label: "Study", hint: "ask here · the same events, measured" },
];

export type HarmonyWorkspaceProps = Omit<HarmonyDeskProps, "analysis" | "leading">;

/**
 * The desk switcher — an in-view mode, not a door.
 *
 * It used to own a full-width bordered band above every desk: 31px of chrome,
 * a "Harmony" label that repeated the left rail, and a permanent sentence of
 * instructional copy. It is now three words at the head of the row it belongs
 * to, and the sentence lives in the option tooltips.
 */
export function HarmonyDeskSwitch() {
  const desk = useHarmonyWorkspaceStore((s) => s.desk);
  const setDesk = useHarmonyWorkspaceStore((s) => s.setDesk);
  return (
    <span className="shrink-0 text-inkMuted">
      <Segmented
        variant="normal"
        value={desk}
        onChange={setDesk}
        options={DESKS.map((entry) => ({
          id: entry.id,
          label: entry.label,
          hint: entry.hint,
        }))}
      />
    </span>
  );
}

/** The Harmony workspace. One analysis, three desks — the desk changes what
 *  the canvas is for, not which page you are on. */
export default function HarmonyWorkspace(props: HarmonyWorkspaceProps) {
  const desk = useHarmonyWorkspaceStore((s) => s.desk);

  const beatsPerBar = Math.max(1, meanBeatsPerBar(props.section));
  const analysis = useMemo(
    () =>
      analyzeSection(props.section.chords, {
        key: props.keyName,
        scale: props.scale,
        regions: props.regions,
        beatsPerBar,
      }),
    [
      props.section.chords,
      props.keyName,
      props.scale,
      props.regions,
      beatsPerBar,
    ],
  );

  const shared = { ...props, analysis, leading: <HarmonyDeskSwitch /> };

  return (
    <>
      {desk === "compose" && <ComposeDesk {...shared} />}
      {desk === "rehearse" && <RehearseDesk {...shared} />}
      {desk === "study" && <StudyDesk {...shared} />}
    </>
  );
}
