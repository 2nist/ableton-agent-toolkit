import { FONT_OPTIONS, type FontId, type FontRole, type ThemeEditorState } from "./editor";
import { SliderField, WorkshopGroup } from "./WorkshopControls";

const ROLES: { id: FontRole; label: string; note: string }[] = [
  { id: "printed", label: "Printed / UI", note: "Forms, labels, and reading copy" },
  { id: "mechanical", label: "Mechanical", note: "Counters, keys, tempo, and percentages" },
  { id: "written", label: "Handwritten", note: "Authored values and notes" },
  { id: "marker", label: "Marker on tape", note: "Panel and section identity" },
];

export default function WorkshopTypography({ editor, onChange }: { editor: ThemeEditorState; onChange: (editor: ThemeEditorState) => void }) {
  function size(key: keyof ThemeEditorState["sizes"], value: number) {
    onChange({ ...editor, sizes: { ...editor.sizes, [key]: value } });
  }
  return (
    <div>
      <p className="mb-3 text-2xs leading-5 text-inkMuted">Reassign the four type roles using the self-hosted families, then tune the handwritten and tape hierarchy.</p>
      <WorkshopGroup title="Font assignments" open>
        {ROLES.map((role) => <label key={role.id} className="block border-b border-edge/35 py-2.5 last:border-0"><span className="block text-2xs">{role.label}</span><span className="mt-0.5 block text-3xs text-inkMuted">{role.note}</span><select value={editor.fonts[role.id]} onChange={(event) => onChange({ ...editor, fonts: { ...editor.fonts, [role.id]: event.target.value as FontId } })} className="mt-2 w-full rounded-sm border border-edge bg-panelAlt px-2 py-1.5 font-mono text-2xs">{(Object.keys(FONT_OPTIONS) as FontId[]).map((id) => <option key={id} value={id}>{FONT_OPTIONS[id].name}</option>)}</select></label>)}
      </WorkshopGroup>
      <WorkshopGroup title="Handwritten sizes" open>
        <SliderField label="Written value" value={editor.sizes.written} min={12} max={32} onChange={(value) => size("written", value)} />
        <SliderField label="Written title" value={editor.sizes.title} min={16} max={42} onChange={(value) => size("title", value)} />
      </WorkshopGroup>
      <WorkshopGroup title="Tape sizes" open>
        <SliderField label="Small tape" value={editor.sizes.tapeSm} min={10} max={24} onChange={(value) => size("tapeSm", value)} />
        <SliderField label="Medium tape" value={editor.sizes.tapeMd} min={12} max={30} onChange={(value) => size("tapeMd", value)} />
        <SliderField label="Large tape" value={editor.sizes.tapeLg} min={16} max={38} onChange={(value) => size("tapeLg", value)} />
      </WorkshopGroup>
    </div>
  );
}
