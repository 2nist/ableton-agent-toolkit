import Button from "../../components/common/Button";
import type { Palette } from "../../theme/palette";
import WorkbenchSpecimen from "./WorkbenchSpecimen";

const SPACING = [4, 8, 12, 16, 24, 32];

function SurfaceGrammar() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.25fr]">
      <div className="border border-edge bg-canvas p-4">
        <p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">01 / Canvas</p>
        <div className="mt-4 border border-edge bg-panel p-4"><p className="text-xs">Panel on sheet</p><div className="mt-3 border border-edge/70 bg-panelAlt p-3 font-mono text-2xs text-inkMuted">Recessed well</div></div>
      </div>
      <div className="border border-edge bg-panel p-4">
        <p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">02 / Geometry</p>
        <div className="mt-4 flex items-end gap-3">
          {[{ name: "1px", radius: "1px" }, { name: "2px", radius: "2px" }, { name: "3px", radius: "3px" }, { name: "5px", radius: "5px" }].map((item) => <div key={item.name} className="text-center"><div className="h-11 w-11 border border-edge bg-panelAlt" style={{ borderRadius: item.radius }} /><p className="mt-1 font-mono text-3xs text-inkMuted">{item.name}</p></div>)}
        </div>
        <p className="mt-3 text-2xs leading-4 text-inkMuted">Log sheet overrides medium and large card radii to 2px.</p>
      </div>
      <div className="border border-edge bg-panel p-4">
        <p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">03 / Spacing rhythm</p>
        <div className="mt-3 space-y-1.5">{SPACING.map((space) => <div key={space} className="flex items-center gap-3"><span className="w-7 font-mono text-3xs text-inkMuted">{space}</span><span className="block h-2 bg-ink/65" style={{ width: space * 3 }} /><span className="font-mono text-3xs text-inkMuted">px</span></div>)}</div>
      </div>
    </div>
  );
}

export default function LayoutStudy({ palette }: { palette: Palette }) {
  return (
    <div className="space-y-6">
      <SurfaceGrammar />
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3"><div><h3 className="font-marker text-xl font-normal">A page in context</h3><p className="mt-1 text-2xs text-inkMuted">Interactive specimen. Edits stay local to this study.</p></div><span className="font-mono text-3xs uppercase tracking-widest text-inkMuted">Responsive / three regions</span></div>
      <WorkbenchSpecimen palette={palette} />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="border border-edge bg-panel p-4"><p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">Tape and stamps</p><div className="mt-4 flex flex-wrap items-center gap-2"><span className="tape-label tape-label--sm">Small / 13px</span><span className="tape-label tape-label--md tape-label--end">Medium / 17px</span><span className="tape-label tape-label--lg tape-label--flat">Large / 22px</span></div><div className="mt-5 flex flex-wrap gap-3"><span className="stamp">Draft</span><span className="stamp stamp--pencil">Inferred</span><span className="plabel">PRINTED_ID_004</span></div></section>
        <section className="border border-edge bg-panel p-4"><p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">Controls and states</p><div className="mt-4 flex flex-wrap gap-2"><Button variant="primary" size="sm">Primary</Button><Button size="sm">Secondary</Button><Button variant="ghost" size="sm">Ghost</Button><Button variant="danger" size="sm">Danger</Button></div><label className="mt-4 block"><span className="flex justify-between font-mono text-3xs uppercase text-inkMuted"><span>Fader / mechanical</span><span>62%</span></span><input aria-label="Example fader" type="range" defaultValue="62" className="fader mt-2 w-full" /></label><select aria-label="Example select" defaultValue="F" className="mt-3 w-full rounded-sm border border-edge bg-panelAlt px-2 py-1 font-mono text-2xs"><option>C</option><option>F</option><option>Bb</option></select></section>
        <section className="border border-edge bg-panel p-4"><p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">Dense information</p><div className="mt-3 divide-y divide-edge/45 border-y border-edge/45">{[["VER 01", "4 bars", "82%"], ["PRE", "2 bars", "64%"], ["CHO", "8 bars", "91%"]].map((row) => <div key={row[0]} className="grid grid-cols-[1fr_60px_45px] gap-2 py-2 font-mono text-2xs"><span>{row[0]}</span><span className="text-inkMuted">{row[1]}</span><span className="text-right">{row[2]}</span></div>)}</div><p className="mt-3 text-2xs leading-4 text-inkMuted">Rules separate dense rows; handwriting is reserved for the content a person authored.</p></section>
      </div>
    </div>
  );
}
