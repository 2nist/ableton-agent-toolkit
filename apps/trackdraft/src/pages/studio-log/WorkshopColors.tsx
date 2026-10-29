import type { VoiceColors } from "../../theme/palette";
import type { ThemeEditorState } from "./editor";
import { INK_TOKENS, INSTRUMENT_TOKENS, MATERIAL_TOKENS, STATUS_TOKENS, SURFACE_TOKENS, type CssToken } from "./tokens";
import { ColorField, WorkshopGroup } from "./WorkshopControls";

export default function WorkshopColors({ editor, tokens, onChange }: { editor: ThemeEditorState; tokens: Record<string, string>; onChange: (editor: ThemeEditorState) => void }) {
  function setColor(variable: string, value: string) {
    onChange({ ...editor, colors: { ...editor.colors, [variable]: value } });
  }
  function group(title: string, items: CssToken[], open = false) {
    return <WorkshopGroup key={title} title={title} open={open}>{items.map((token) => <ColorField key={token.variable} label={token.name} note={token.variable} value={editor.colors[token.variable] ?? tokens[token.variable] ?? "#000000"} onChange={(value) => setColor(token.variable, value)} />)}</WorkshopGroup>;
  }
  return (
    <div>
      <p className="mb-3 text-2xs leading-5 text-inkMuted">Edit a color with the picker or type a six-digit hex value. Swatches and contrast ratios update immediately.</p>
      {group("Paper and structure", SURFACE_TOKENS, true)}
      {group("Ink and authorship", INK_TOKENS)}
      {group("Status", STATUS_TOKENS)}
      {group("Instrument surfaces", INSTRUMENT_TOKENS)}
      {group("Tape and stickers", MATERIAL_TOKENS)}
      <WorkshopGroup title="Drum voices">
        {(Object.keys(editor.voices) as (keyof VoiceColors)[]).map((voice) => <ColorField key={voice} label={voice[0]!.toUpperCase() + voice.slice(1)} value={editor.voices[voice]} onChange={(value) => onChange({ ...editor, voices: { ...editor.voices, [voice]: value } })} />)}
      </WorkshopGroup>
      <WorkshopGroup title="Harmony hues · fill / rim / ink">
        {editor.hues.map((hue, index) => <div key={index} className="mb-2 border-l-2 py-1 pl-2" style={{ borderColor: hue.rim }}><p className="font-hand text-xl" style={{ color: hue.ink }}>{["I", "ii", "iii", "IV", "V", "vi", "vii°"][index]}</p>{(["fill", "rim", "ink"] as const).map((part) => <ColorField key={part} label={part} value={hue[part]} onChange={(value) => { const hues = editor.hues.map((item) => ({ ...item })); hues[index] = { ...hues[index]!, [part]: value }; onChange({ ...editor, hues }); }} />)}</div>)}
      </WorkshopGroup>
    </div>
  );
}
