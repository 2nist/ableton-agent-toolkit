import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useInspectorStore, type InspectorTab } from "../../store/inspectorStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { useLyricsSelectionStore } from "../../store/lyricsSelectionStore";
import IconBtn from "../common/IconBtn";
import Icon, { type IconName } from "../common/Icon";
import SectionStructurePanel from "../workspace/SectionStructurePanel";
import DrumPatternTools from "../drums/DrumPatternTools";
import { HarmonyTools, HarmonyLayers } from "../harmony/HarmonyDockTools";
import LyricsDockTools from "../lyrics/LyricsDockTools";
import BendPanel from "../style/BendPanel";
import SongInfoPanel from "../details/SongInfoPanel";

/** The inspector's facets — one per instrument/system. Icons are the
 *  shared SVG set (components/common/Icon). */
const FACETS: { id: InspectorTab; icon: IconName; label: string }[] = [
  { id: "structure", icon: "structure", label: "Structure — this section's form" },
  { id: "drums", icon: "drums", label: "Drums — pattern · detour · transition" },
  { id: "harmony", icon: "harmony", label: "Harmony — tools, presets & layers" },
  { id: "lyrics", icon: "lyrics", label: "Lyrics — metre, rhyme & writing context" },
  { id: "mix", icon: "mix", label: "Mix / Bend — the style lens" },
  { id: "song", icon: "song", label: "Song info" },
];

/** Which facets apply per view (user rule 2026-09-21: "the right menu
 *  should have some context to the view… only showing tabs that have
 *  controls that can effect that view"). The workbench keeps all six —
 *  every element is in its workspace; specialised views keep their own
 *  instrument plus section context and song identity. Arriving at a view
 *  whose list doesn't include the active facet switches to the view's
 *  DEFAULT facet (below); a deliberate engagement (e.g. clicking a chord
 *  on the spine while in the Drums view) still reveals its facet — the
 *  visible set is allowed ∪ {active}, so a tool you just reached for is
 *  never hidden. */
const VIEW_FACETS: Record<string, InspectorTab[]> = {
  workbench: ["structure", "drums", "harmony", "lyrics", "mix", "song"],
  studio: ["structure", "mix", "song"],
  structure: ["structure", "song"],
  harmony: ["harmony", "structure", "song"],
  drums: ["drums", "structure", "song"],
  lyrics: ["lyrics", "structure", "song"],
  melody: ["structure", "mix", "song"],
  library: ["song"],
  settings: ["song"],
};

/** The facet a view opens on when the active one isn't in its list. */
const VIEW_DEFAULT: Record<string, InspectorTab> = {
  studio: "mix",
  harmony: "harmony",
  drums: "drums",
  lyrics: "lyrics",
};

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
  const location = useLocation();
  const view = location.pathname.split("/")[3] ?? "workbench";
  const allowed = useMemo(
    () => VIEW_FACETS[view] ?? FACETS.map((f) => f.id),
    [view],
  );
  const visible = FACETS.filter((f) => allowed.includes(f.id) || f.id === tab);

  // View context drives the active facet: instrument views (harmony ·
  // drums · lyrics) open on their own tool; other views keep the active
  // facet when it applies, else fall back to their first. A deliberate
  // engagement (e.g. a spine chord click while in the Drums view) still
  // reveals its facet — the visible set is allowed ∪ {active}.
  useEffect(() => {
    const current = useInspectorStore.getState().tab;
    const def = VIEW_DEFAULT[view];
    if (def) {
      useInspectorStore.getState().setTab(def);
    } else if (!allowed.includes(current)) {
      useInspectorStore.getState().setTab(allowed[0] ?? "song");
    }
  }, [view, allowed]);

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
            {visible.map((f) => (
              <IconBtn key={f.id} title={f.label} active={tab === f.id} onClick={() => setTab(f.id)} icon={f.icon} />
            ))}
            <span className="flex-1" />
            <IconBtn title="Collapse the inspector — more room for the canvas (clicks reopen it)" onClick={() => setOpen(false)} icon="chevron-right" />
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
            {tab === "lyrics" && (
              <div className="space-y-3">
                {lyricsMode === "song-text" && (
                  <p className="text-2xs font-mono text-inkMuted/60 italic">
                    Song text mode — the tools below follow the block you last touched.
                  </p>
                )}
                <LyricsDockTools />
              </div>
            )}
            {tab === "mix" && <BendPanel />}
            {tab === "song" && <SongInfoPanel />}
          </div>
        </>
      ) : (
        <button
          type="button"
          className="h-9 shrink-0 flex items-center justify-center text-inkMuted hover:text-ink"
          onClick={() => setOpen(true)}
          title="Open the inspector — the focused object's tools for this view"
        >
          <Icon name="chevron-left" size={13} />
        </button>
      )}
    </aside>
  );
}
