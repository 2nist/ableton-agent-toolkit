import { useEffect } from "react";
import { useInspectorStore, type InspectorTab } from "../../store/inspectorStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { useLyricsSelectionStore } from "../../store/lyricsSelectionStore";
import IconBtn from "../common/IconBtn";
import SectionStructurePanel from "../workspace/SectionStructurePanel";
import DrumPatternTools from "../drums/DrumPatternTools";
import { HarmonyTools, HarmonyLayers } from "../harmony/HarmonyDockTools";
import LyricsDockTools from "../lyrics/LyricsDockTools";
import BendPanel from "../style/BendPanel";
import SongInfoPanel from "../details/SongInfoPanel";

/** The inspector's facets — one per instrument/system. Glyphs are
 *  placeholders for the SVG pass. */
const FACETS: { id: InspectorTab; glyph: string; label: string }[] = [
  { id: "structure", glyph: "≣", label: "Structure — this section's form" },
  { id: "drums", glyph: "▦", label: "Drums — pattern · detour · transition" },
  { id: "harmony", glyph: "♪", label: "Harmony — tools, presets & layers" },
  { id: "lyrics", glyph: "✎", label: "Lyrics — metre, rhyme & writing context" },
  { id: "mix", glyph: "◉", label: "Mix / Bend — the style lens" },
  { id: "song", glyph: "ⓘ", label: "Song info" },
];

/**
 * The Inspector — the RIGHT zone of the layout grammar (user decision,
 * 2026-09-21): shell chrome on EVERY song route, holding the focused
 * object's tools. It slides open on engagement (any section selection —
 * spine, canvas, arrows), collapses to a thin strip for canvas room, and
 * its facets are fixed components (no per-view registration — the old
 * dock's coupling — so every view gets the same tool surface).
 */
export default function InspectorRail() {
  const tab = useInspectorStore((s) => s.tab);
  const open = useInspectorStore((s) => s.open);
  const setTab = useInspectorStore((s) => s.setTab);
  const setOpen = useInspectorStore((s) => s.setOpen);
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const lyricsMode = useLyricsSelectionStore((s) => s.mode);

  // Slides open on engagement: selecting anything with controls — a spine
  // block, a canvas element, the ←→ arrows — opens it. A manual collapse
  // still wins until the NEXT selection change.
  useEffect(() => {
    if (selectedSectionId) setOpen(true);
  }, [selectedSectionId, setOpen]);

  return (
    <aside
      className={`shrink-0 border-l border-edge bg-panel min-h-0 flex flex-col ${open ? "w-64" : "w-9"}`}
      aria-label="Inspector — the focused object's tools"
    >
      {open ? (
        <>
          <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1 border-b border-edge/60 shrink-0">
            {FACETS.map((f) => (
              <IconBtn key={f.id} title={f.label} active={tab === f.id} onClick={() => setTab(f.id)}>
                {f.glyph}
              </IconBtn>
            ))}
            <span className="flex-1" />
            <IconBtn title="Collapse the inspector — more room for the canvas (clicks reopen it)" onClick={() => setOpen(false)}>
              ▸
            </IconBtn>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {tab === "structure" && <SectionStructurePanel />}
            {tab === "drums" && <DrumPatternTools />}
            {tab === "harmony" && (
              <div className="space-y-4">
                <HarmonyTools />
                <div className="border-t border-edge/60 pt-3">
                  <HarmonyLayers />
                </div>
              </div>
            )}
            {tab === "lyrics" &&
              (lyricsMode === "per-section" ? (
                <LyricsDockTools />
              ) : (
                <p className="text-2xs font-mono text-inkMuted/60 italic">
                  Lyrics tools work per section — switch the Lyrics view to “Per-section” to use them.
                </p>
              ))}
            {tab === "mix" && <BendPanel />}
            {tab === "song" && <SongInfoPanel />}
          </div>
        </>
      ) : (
        <button
          type="button"
          className="h-9 shrink-0 flex items-center justify-center text-inkMuted hover:text-ink text-xs"
          onClick={() => setOpen(true)}
          title="Open the inspector — the focused object's tools (≣ form · ▦ drums · ♪ harmony · ✎ lyrics · ◉ mix · ⓘ song)"
        >
          ◂
        </button>
      )}
    </aside>
  );
}
