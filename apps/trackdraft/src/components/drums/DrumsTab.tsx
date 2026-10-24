import DrumBlocksView from "./blocks/DrumBlocksView";

/**
 * The Drums view IS the Blocks surface (user decision 2026-10-24): "classic
 * is read only, steps is obsolete, Blocks is THE view." The Classic canvas
 * survives as the Workbench's embedded Drum Line (`<DrumsView embedded />`),
 * and the view-switcher row is gone — the spine's section blocks switch
 * sections, and the canvas switches bars, without a second nav layer.
 */
export default function DrumsTab() {
  return (
    <div className="px-2 pt-1.5 pb-3">
      <DrumBlocksView />
    </div>
  );
}
