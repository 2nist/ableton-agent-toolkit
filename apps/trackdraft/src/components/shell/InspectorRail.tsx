import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useInspectorStore, type InspectorTab } from "../../store/inspectorStore";
import { useLyricsSelectionStore } from "../../store/lyricsSelectionStore";
import IconBtn from "../common/IconBtn";
import Icon, { type IconName } from "../common/Icon";
import SectionStructurePanel from "../workspace/SectionStructurePanel";
import DrumPatternTools from "../drums/DrumPatternTools";
import { HarmonyTools, HarmonyLayers } from "../harmony/HarmonyDockTools";
import LyricsDockTools from "../lyrics/LyricsDockTools";
import BendPanel from "../style/BendPanel";
import SongInfoPanel from "../details/SongInfoPanel";
import SyncFacet from "./SyncFacet";

/** The inspector's facets — one per instrument/system. Icons are the
 *  shared SVG set (components/common/Icon). */
const FACETS: { id: InspectorTab; icon: IconName; label: string }[] = [
  { id: "structure", icon: "structure", label: "Structure — this section's form" },
  { id: "drums", icon: "drums", label: "Drums — pattern · detour · transition" },
  { id: "harmony", icon: "harmony", label: "Harmony — tools, presets & layers" },
  { id: "lyrics", icon: "lyrics", label: "Lyrics — metre, rhyme & writing context" },
  { id: "mix", icon: "mix", label: "Mix / Bend — the style lens" },
  { id: "song", icon: "song", label: "Song info" },
  { id: "sync", icon: "sync", label: "Sync — clock, MIDI out & Live" },
];

/** Which facets apply per view (user rule 2026-09-21: "the right menu
 *  should have some context to the view… only showing tabs that have
 *  controls that can effect that view"). The workbench keeps every facet —
 *  every element is in its workspace; specialised views keep their own
 *  instrument plus section context and song identity, and Sync is on all of
 *  them because the clock and the MIDI port affect every view. Arriving at a view
 *  whose list doesn't include the active facet switches to the view's
 *  DEFAULT facet (below); a deliberate engagement (e.g. clicking a chord
 *  on the spine while in the Drums view) still reveals its facet — the
 *  visible set is allowed ∪ {active}, so a tool you just reached for is
 *  never hidden. */
const VIEW_FACETS: Record<string, InspectorTab[]> = {
  workbench: ["structure", "drums", "harmony", "lyrics", "mix", "song", "sync"],
  // The poly canvas selects sections, so every element facet is meaningful.
  poly: ["structure", "drums", "harmony", "lyrics", "mix", "song", "sync"],
  structure: ["structure", "song", "sync"],
  harmony: ["harmony", "structure", "song", "sync"],
  drums: ["drums", "structure", "song", "sync"],
  lyrics: ["lyrics", "structure", "song", "sync"],
  melody: ["structure", "mix", "song", "sync"],
  library: ["song", "sync"],
  settings: ["song", "sync"],
};

/** The facet a view opens on when the active one isn't in its list. */
const VIEW_DEFAULT: Record<string, InspectorTab> = {
  harmony: "harmony",
  drums: "drums",
  lyrics: "lyrics",
};

/**
 * The Inspector — the RIGHT zone of the layout grammar (user decision,
 * 2026-09-21): shell chrome on EVERY song route, holding the focused
 * object's tools. MINIMIZED BY DEFAULT since 2026-10-24: the thin strip
 * carries the facets as glyphs (the same grammar as the left nav rail), a
 * click opens the rail on that facet, and `engage()` is how a surface asks
 * for the rail outright. Its facets are fixed components (no per-view
 * registration — the old dock's coupling — so every view gets the same
 * tool surface).
 */
export default function InspectorRail() {
  const tab = useInspectorStore((s) => s.tab);
  const open = useInspectorStore((s) => s.open);
  const setTab = useInspectorStore((s) => s.setTab);
  const setOpen = useInspectorStore((s) => s.setOpen);
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

  // No blanket auto-open (2026-10-24): the minimized rail already names its
  // facets, so opening is a deliberate act — a facet icon, or `engage(tab)`
  // from a surface that really means "edit this now" (a spine chord, the
  // workbench's drums row, the melody generator's mix lens). Auto-opening on
  // every section selection is what made "minimized" impossible to keep.

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
            {tab === "sync" && <SyncFacet />}
          </div>
        </>
      ) : (
        /* Minimized: the facets themselves — the same glyph strip the left
           rail uses, so the icon says what this side does before you open
           it. Clicking a facet opens the rail ON that facet. */
        <div className="flex flex-col items-center">
          {/* The expander sits at the TOP, matching the left rail — both
              strips then read chevron-then-glyphs. */}
          <button
            type="button"
            className="h-9 w-9 shrink-0 flex items-center justify-center text-inkMuted hover:text-ink"
            onClick={() => setOpen(true)}
            title="Open the inspector — the focused object's tools for this view"
          >
            <Icon name="chevron-left" size={13} />
          </button>
          {visible.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setTab(f.id);
                setOpen(true);
              }}
              title={`${f.label} — click to open`}
              className={`w-9 h-8 flex items-center justify-center ${
                tab === f.id ? "text-accent bg-panelAlt" : "text-inkMuted hover:text-ink"
              }`}
            >
              <Icon name={f.icon} size={16} />
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
