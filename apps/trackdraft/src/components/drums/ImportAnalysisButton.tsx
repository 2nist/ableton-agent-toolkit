import { useRef, useState } from "react";
import { useSongStore } from "../../store/songStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { useDrumsDraftStore } from "../../store/drumsDraftStore";
import { parseAnalysisFile } from "../../lib/drumImport/analysisFile";
import { applySectionPatch, planSectionImport } from "../../lib/drumImport/runner";
import IconBtn from "../common/IconBtn";

/**
 * ⤓ Import analysis — the drum importer's UI half, in the shell toolbar.
 *
 * A drum-analysis grid (see lib/drumImport/analysisFile.ts — what the
 * audio→grid side writes) for the SELECTED section stages straight into the
 * drums draft store, so the Blocks canvas previews it exactly like any other
 * drum edit and the usual Apply/Revert commits or discards it. It lived in
 * the Drums tab's view-switcher row until that row dissolved (2026-10-24) —
 * it is a section-scoped action, so the spine strip is its home.
 */
export default function ImportAnalysisButton() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);

  const onAnalysisFile = async (file: File) => {
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new Error("Not a JSON file.");
      }
      const parsed = parseAnalysisFile(raw);
      const current = useSongStore.getState().currentSong();
      if (!current) throw new Error("No song open.");
      if (parsed.songId !== undefined && parsed.songId !== current.id) {
        throw new Error(`Analysis is for "${parsed.songId}" — open that song (or re-export the analysis) before importing.`);
      }
      const target = current.sections.find((s) => s.id === selectedSectionId) ?? current.sections[0];
      if (!target) throw new Error("This song has no sections yet.");
      const staged = useDrumsDraftStore.getState();
      if (staged.sectionId !== null && staged.sectionId !== target.id) {
        throw new Error("Another section has staged edits — Apply or Revert them first.");
      }
      const result = planSectionImport(parsed, target);
      if (!result) {
        const names = parsed.sections.slice(0, 8).map((e) => e.sectionId ?? e.sectionName ?? "?").join(", ");
        throw new Error(`No span in the analysis matches "${target.name}" — the file covers: ${names}${parsed.sections.length > 8 ? ", …" : ""}.`);
      }
      useDrumsDraftStore.getState().setDraft(target.id, applySectionPatch(target, result.patch));
      setSelectedSectionId(target.id);
      const st = result.report.stats;
      setStatus({
        ok: true,
        text: `Imported "${target.name}": ${result.patch.drumBlocks.length} blocks (${st.euclidBlocks} euclid · ${st.stepsBlocks} steps · ${st.clearBlocks} clears${st.motionBlocks > 0 ? ` · ${st.motionBlocks} motion` : ""}) — preview staged · Apply to keep, Revert to discard`,
      });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onAnalysisFile(file);
        }}
      />
      <IconBtn
        icon="import"
        onClick={() => inputRef.current?.click()}
        title={
          "Import a drum-analysis JSON grid (12 or 16 steps per bar) for the SELECTED section" +
          "\nIt stages as a preview on the Drums canvas: Apply keeps it, Revert discards it." +
          "\nNothing is written to the song until you press Apply."
        }
      />
      {status && (
        <button
          type="button"
          onClick={() => setStatus(null)}
          title={`${status.text}\n\nClick to dismiss`}
          className={`min-w-0 max-w-[340px] truncate text-left font-mono text-[9px] leading-none ${
            status.ok ? "text-track" : "text-danger"
          }`}
        >
          {status.text}
        </button>
      )}
    </>
  );
}
