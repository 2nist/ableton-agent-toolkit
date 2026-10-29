import type { ThemeEditorState } from "./editor";
import { SliderField, WorkshopGroup } from "./WorkshopControls";

export default function WorkshopLayout({ editor, onChange }: { editor: ThemeEditorState; onChange: (editor: ThemeEditorState) => void }) {
  function layout<K extends keyof ThemeEditorState["layout"]>(key: K, value: ThemeEditorState["layout"][K]) {
    onChange({ ...editor, layout: { ...editor.layout, [key]: value } });
  }
  return (
    <div>
      <p className="mb-3 text-2xs leading-5 text-inkMuted">Tune the physical sheet and geometry. Content width affects this study; the other controls map to the app’s theme recipes.</p>
      <WorkshopGroup title="Geometry" open>
        <SliderField label="Card and control radius" value={editor.layout.radius} min={0} max={10} onChange={(value) => layout("radius", value)} />
        <SliderField label="Ledger line spacing" value={editor.layout.ledger} min={16} max={36} onChange={(value) => layout("ledger", value)} />
        <SliderField label="Red page margin" value={editor.layout.margin} min={0} max={6} onChange={(value) => layout("margin", value)} />
      </WorkshopGroup>
      <WorkshopGroup title="Study canvas" open>
        <SliderField label="Maximum content width" value={editor.layout.contentWidth} min={1100} max={1800} step={20} onChange={(value) => layout("contentWidth", value)} />
        <label className="flex cursor-pointer items-center justify-between gap-3 py-3 text-2xs"><span>Paper grain</span><input type="checkbox" checked={editor.layout.grain} onChange={(event) => layout("grain", event.target.checked)} className="h-4 w-4 accent-[#8A6A12]" /></label>
      </WorkshopGroup>
      <div className="mt-4 border border-edge bg-panelAlt/45 p-3 text-2xs leading-5 text-inkMuted">Tip: a radius of 0–2px feels printed and utilitarian; larger values move the interface back toward soft screen cards.</div>
    </div>
  );
}
