import { useMemo } from "react";
import { meanBeatsPerBar } from "../../../types/blueprint";
import { analyzeSection } from "../../../lib/harmony/analysis";
import { useHarmonyWorkspaceStore, type HarmonyDesk } from "../../../store/harmonyWorkspaceStore";
import TapeLabel from "../../common/TapeLabel";
import ComposeDesk from "./ComposeDesk";
import RehearseDesk from "./RehearseDesk";
import StudyDesk from "./StudyDesk";
import type { HarmonyDeskProps } from "./types";

const DESKS: { id: HarmonyDesk; label: string; hint: string }[] = [
  { id: "compose", label: "Compose", hint: "write here · the strip owns time, the lens owns the map" },
  { id: "rehearse", label: "Rehearse", hint: "read here · nothing edits the song" },
  { id: "study", label: "Study", hint: "ask here · the same events, measured" },
];

export type HarmonyWorkspaceProps = Omit<HarmonyDeskProps, "analysis">;

/** The one band the Harmony page owns: the desk, as a dropdown. It lives
 *  outside the workspace so the page can order it above the tonic strip,
 *  the way the drums view keeps one band above its canvas. */
export function HarmonyDeskBar() {
  const desk = useHarmonyWorkspaceStore((s) => s.desk);
  const setDesk = useHarmonyWorkspaceStore((s) => s.setDesk);
  const active = DESKS.find((entry) => entry.id === desk) ?? DESKS[0];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-edge bg-deep px-2 py-1 font-mono text-[10px]">
      <TapeLabel size="md" className="text-[10px] font-mono uppercase tracking-[0.14em] text-inkMuted">
        Harmony
      </TapeLabel>
      <select
        value={desk}
        aria-label="Harmony desk"
        onChange={(event) => setDesk(event.target.value as HarmonyDesk)}
        className="rounded border border-edge bg-panel px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] text-ink hover:border-accent"
      >
        {DESKS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
      <span className="ml-auto text-[9px] text-inkMuted/60">{active.hint}</span>
    </div>
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
    [props.section.chords, props.keyName, props.scale, props.regions, beatsPerBar],
  );

  const shared = { ...props, analysis };

  return (
    <>
      {desk === "compose" && <ComposeDesk {...shared} />}
      {desk === "rehearse" && <RehearseDesk {...shared} />}
      {desk === "study" && <StudyDesk {...shared} />}
    </>
  );
}
