import { useState } from "react";
import { FONT_OPTIONS, type EditorSizes, type FontRole, type ThemeEditorState } from "./editor";

const VOICES = [
  { id: "printed", number: "01", name: "Courier Prime", role: "Printed · interface and prose", family: "var(--ui-font)", size: "30px", weights: "400 / 700", usage: "Forms, labels, table heads, hints, and ordinary reading copy." },
  { id: "mechanical", number: "02", name: "IBM Plex Mono", role: "Mechanical · values and readouts", family: "var(--editor-mechanical-font)", size: "28px", weights: "400 / 500 / 600", usage: "Tempo, bar · beat, counters, percentages, keys, and token values." },
  { id: "written", number: "03", name: "Reenie Beanie", role: "Written · human-entered values", family: "var(--hand-pen)", size: "46px", weights: "400 only", usage: "Song titles, section notes, lyrics, and other authored content." },
  { id: "marker", number: "04", name: "Permanent Marker", role: "Marker · tape and view identity", family: "var(--marker-pen)", size: "29px", weights: "400 only", usage: "Tape labels, panel headings, and names written on section strips." },
];

const TYPE_RAMP = [
  { size: 9, name: "Micro", role: "Dense metadata", family: "mono" },
  { size: 10, name: "Small", role: "Labels and table metadata", family: "mono" },
  { size: 12, name: "Body small", role: "Compact controls", family: "type" },
  { size: 14, name: "Body", role: "Comfortable reading", family: "type" },
  { size: 17, name: "Written value", role: "The standard blue-biro hand", family: "hand" },
  { size: 21, name: "Written title", role: "Song and page identity", family: "hand" },
  { size: 22, name: "Tape large", role: "Top-level view identity", family: "marker" },
];

function familyClass(family: string): string {
  if (family === "mono") return "font-mono";
  if (family === "hand") return "font-hand";
  if (family === "marker") return "font-marker";
  return "font-type";
}

function rampSize(step: (typeof TYPE_RAMP)[number], sizes: EditorSizes): number {
  if (step.name === "Written value") return sizes.written;
  if (step.name === "Written title") return sizes.title;
  if (step.name === "Tape large") return sizes.tapeLg;
  return step.size;
}

export default function TypeStudy({ fonts, sizes }: { fonts: ThemeEditorState["fonts"]; sizes: EditorSizes }) {
  const [specimen, setSpecimen] = useState("Midnight takes");
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border border-edge bg-panel p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div>
          <p className="font-mono text-3xs uppercase tracking-[0.16em] text-inkMuted">Live specimen</p>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-inkMuted">One phrase, four voices. The template is printed, the person writes, the machine counts, and tape names things.</p>
        </div>
        <label className="block sm:w-72">
          <span className="mb-1 block font-mono text-3xs uppercase tracking-widest text-inkMuted">Edit the specimen</span>
          <input value={specimen} onChange={(event) => setSpecimen(event.target.value)} maxLength={48} className="hand-value ledger w-full rounded-sm border border-edge bg-canvas px-3 py-1 outline-none focus:border-info" />
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {VOICES.map((voice) => (
          <article key={voice.id} className="overflow-hidden border border-edge bg-panel">
            <div className="flex items-start justify-between gap-4 border-b border-edge/60 px-4 py-3">
              <div><p className="font-mono text-3xs tracking-[0.14em] text-inkMuted">{voice.number} / {voice.role}</p><h3 className="mt-1 text-sm font-bold">{FONT_OPTIONS[fonts[voice.id as FontRole]].name}</h3></div>
              <span className="plabel shrink-0">{FONT_OPTIONS[fonts[voice.id as FontRole]].weights}</span>
            </div>
            <div className="flex min-h-32 items-center overflow-hidden px-4 py-5">
              <p className="min-w-0 break-words leading-none" style={{ fontFamily: voice.family, fontSize: voice.size, color: voice.id === "written" ? "var(--ink-hand)" : undefined }}>{specimen || "Type above"}</p>
            </div>
            <div className="border-t border-edge/60 bg-panelAlt/35 px-4 py-3">
              <p className="overflow-hidden whitespace-nowrap text-xs text-inkMuted" style={{ fontFamily: voice.family }}>ABCDEFGHIJKLM abcdefghijklm 0123456789 · ♭ ♯</p>
              <p className="mt-2 text-2xs leading-relaxed text-inkMuted">{voice.usage}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="border border-edge bg-panel">
          <header className="border-b border-edge px-4 py-3"><h3 className="font-marker text-lg font-normal">Size carries the hierarchy</h3><p className="mt-1 text-2xs text-inkMuted">The handwriting fonts have one real weight. Avoid synthetic bold; change scale instead.</p></header>
          <div className="divide-y divide-edge/45">
            {TYPE_RAMP.map((step) => (
              <div key={`${step.family}-${step.size}`} className="grid grid-cols-[58px_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 sm:grid-cols-[58px_minmax(0,1fr)_190px]">
                <span className="font-mono text-2xs text-inkMuted">{rampSize(step, sizes)}px</span>
                <span className={`${familyClass(step.family)} truncate`} style={{ fontSize: rampSize(step, sizes), lineHeight: 1.25, color: step.family === "hand" ? "var(--ink-hand)" : undefined }}>{specimen || "Type above"}</span>
                <span className="hidden font-mono text-3xs uppercase tracking-wide text-inkMuted sm:block">{step.name} · {step.role}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="ledger ledger--margin border border-edge bg-panel p-5">
          <span className="tape-label tape-label--sm">Session note</span>
          <p className="mt-5 font-mono text-3xs uppercase tracking-[0.16em] text-inkMuted">Song / working title</p>
          <p className="hand-value hand-value--title mt-1">{specimen || "Type above"}</p>
          <div className="mt-4 flex items-center justify-between border-y border-edge/50 py-2"><span className="text-2xs uppercase tracking-wider text-inkMuted">Take</span><span className="counter" aria-label="Take 3"><i>0</i><i>0</i><i>3</i></span></div>
          <p className="mt-3 font-mono text-3xs uppercase tracking-widest text-inkMuted">Engineer’s note</p>
          <p className="hand-value mt-1">Keep the room mic. The imperfections are doing the work.</p>
          <span className="stamp stamp--tight mt-4">Draft</span>
        </section>
      </div>
    </div>
  );
}
