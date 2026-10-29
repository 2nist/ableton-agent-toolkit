import { useState } from "react";
import Button from "../../components/common/Button";
import { withAlpha, type Palette } from "../../theme/palette";

const SECTIONS = ["Verse 01", "Pre-chorus", "Chorus", "Verse 02"];
const VIEWS = ["Structure", "Harmony", "Lyrics"];

export default function WorkbenchSpecimen({ palette }: { palette: Palette }) {
  const [view, setView] = useState("Harmony");
  const [playing, setPlaying] = useState(false);
  const [steps, setSteps] = useState(() => new Set([0, 3, 4, 8, 11, 12]));
  const [key, setKey] = useState("F");
  const [bpm, setBpm] = useState(92);
  const [level, setLevel] = useState(68);
  function toggleStep(step: number) {
    setSteps((current) => { const next = new Set(current); if (next.has(step)) next.delete(step); else next.add(step); return next; });
  }
  return (
    <section className="overflow-hidden rounded-md border border-edge bg-panel shadow-[3px_4px_0_rgb(var(--c-ink)/0.07)]" aria-label="Interactive Studio Log workbench specimen">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <div className="flex items-center gap-4"><span className="tape-label">TrackDraft</span><span className="plabel max-w-40">NIGHT_NOTES_04</span></div>
        <div className="flex items-center gap-2"><span className="counter" aria-label="Bar 1, beat 1"><i className={playing ? "" : "dim"}>0</i><i>1</i><i className="dim">:</i><i>1</i></span><Button variant={playing ? "primary" : "secondary"} size="sm" onClick={() => setPlaying((value) => !value)}>{playing ? "■ Stop" : "▶ Play"}</Button></div>
      </header>
      <nav className="flex gap-5 border-b border-edge/60 px-4 py-2.5" aria-label="Specimen views">{VIEWS.map((item) => <button type="button" key={item} onClick={() => setView(item)} className={`text-2xs ${view === item ? "nav-on text-ink" : "text-inkMuted hover:text-ink"}`} aria-pressed={view === item}>{item}</button>)}</nav>
      <div className="grid md:grid-cols-[145px_minmax(0,1fr)] xl:grid-cols-[145px_minmax(0,1fr)_205px]">
        <aside className="border-b border-edge/60 p-3 md:border-b-0 md:border-r">
          <p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">Song map / 04</p>
          <div className="mt-3 space-y-2">{SECTIONS.map((section, index) => <button type="button" key={section} className={`flex w-full items-center justify-between border-l-2 px-2 py-1 text-left ${index === 2 ? "border-[#A03A31] bg-panelAlt/50" : "border-transparent hover:bg-panelAlt/35"}`}><span className="hand-value">{section}</span><span className="font-mono text-3xs text-inkMuted">{index === 2 ? 8 : 4}</span></button>)}</div>
          <span className="stamp stamp--pencil stamp--tight mt-4">Working map</span>
        </aside>
        <div className="min-w-0 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">{view} / Chorus</p><p className="hand-value hand-value--title mt-1">Let the room answer</p></div><span className="font-mono text-2xs text-inkMuted">4 / 4 · 8 BARS</span></div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[0, 1, 2, 3].map((index) => { const hue = palette.hues[index]!; return <div key={index} className="border p-2.5" style={{ backgroundColor: hue.fill, borderColor: hue.rim, color: hue.ink }}><p className="font-hand text-2xl">{["F", "Gm", "Am", "B♭"][index]}</p><div className="mt-2 flex justify-between font-mono text-3xs"><span>{["I", "ii", "iii", "IV"][index]}</span><span>1 BAR</span></div></div>; })}</div>
          <div className="mt-5 flex items-center justify-between"><p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">Hat / 16 steps</p><p className="font-mono text-3xs text-inkMuted">Click to edit</p></div>
          <div className="mt-2 grid grid-cols-8 gap-1.5 sm:grid-cols-[repeat(16,minmax(0,1fr))]">{Array.from({ length: 16 }, (_, step) => { const on = steps.has(step); return <button type="button" key={step} aria-label={`Step ${step + 1}`} aria-pressed={on} onClick={() => toggleStep(step)} className={`hand-cell h-8 border text-[8px] font-mono ${on ? "hand-cell--on" : ""}`} style={{ backgroundColor: on ? palette.voices.hat : withAlpha(palette.voices.hat, 0.08), borderColor: on ? palette.voices.hat : palette.grid, color: on ? "#F8F3E7" : palette.label }}>{step + 1}</button>; })}</div>
          <div className="ledger mt-5 border-t border-edge/50 px-1 pt-2"><p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">Rehearsal note</p><p className="hand-value">Leave two beats of air before the last chorus.</p></div>
        </div>
        <aside className="border-t border-edge/60 p-4 md:col-span-2 xl:col-span-1 xl:border-l xl:border-t-0">
          <p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">Session settings</p>
          <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-1">
            <label className="block"><span className="font-mono text-3xs uppercase text-inkMuted">Key</span><select value={key} onChange={(event) => setKey(event.target.value)} className="mt-1 w-full rounded-sm border border-edge bg-panelAlt px-2 py-1 font-mono text-2xs">{["C", "D", "Eb", "F", "G", "A", "Bb"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="block"><span className="font-mono text-3xs uppercase text-inkMuted">BPM</span><input type="number" min="20" max="300" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} className="mt-1 w-full rounded-sm border border-edge bg-panelAlt px-2 py-1 font-mono text-2xs" /></label>
          </div>
          <label className="mt-5 block"><span className="flex justify-between font-mono text-3xs uppercase text-inkMuted"><span>Room level</span><span>{level}%</span></span><input type="range" min="0" max="100" value={level} onChange={(event) => setLevel(Number(event.target.value))} className="fader mt-2 w-full" /></label>
          <div className="mt-5 border-t border-edge/50 pt-3"><p className="font-mono text-3xs uppercase text-inkMuted">Status</p><div className="mt-2 flex gap-2"><span className="stamp stamp--tight">Draft</span><span className="stamp stamp--pencil stamp--tight">Take 04</span></div></div>
        </aside>
      </div>
    </section>
  );
}
