import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PALETTES } from "../../theme/palette";
import { writeStorage } from "../../store/storage";
import ColorStudy from "./ColorStudy";
import LayoutStudy from "./LayoutStudy";
import TypeStudy from "./TypeStudy";
import ThemeWorkshop from "./ThemeWorkshop";
import { buildEditorCss, EDITOR_STORAGE_KEY, FONT_OPTIONS, loadEditor, normalizeEditor } from "./editor";
import { useResolvedTokens } from "./tokens";

const NAV = [
  { href: "#overview", label: "Overview" },
  { href: "#color", label: "01 · Color" },
  { href: "#typography", label: "02 · Typography" },
  { href: "#layout", label: "03 · Layout & materials" },
];

function StudySection({ id, number, title, intro, children }: {
  id: string;
  number: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-edge/70 py-10 sm:py-14">
      <header className="mb-7 grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)]">
        <p className="font-mono text-2xs uppercase tracking-[0.18em] text-inkMuted">Study {number}</p>
        <div>
          <h2 className="font-marker text-2xl font-normal leading-tight sm:text-3xl">{title}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-inkMuted">{intro}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

export default function StudioLogLab() {
  const scope = useRef<HTMLDivElement>(null);
  const baseline = useResolvedTokens(scope);
  const [editor, setEditor] = useState(loadEditor);
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const tokens = useMemo(() => ({ ...baseline, ...editor.colors }), [baseline, editor.colors]);
  const palette = useMemo(() => ({
    ...PALETTES.logsheet,
    track: tokens["--c-track"] ?? PALETTES.logsheet.track,
    scene: tokens["--c-scene"] ?? PALETTES.logsheet.scene,
    deep: tokens["--c-deep"] ?? PALETTES.logsheet.deep,
    well: tokens["--c-well"] ?? PALETTES.logsheet.well,
    label: tokens["--c-label"] ?? PALETTES.logsheet.label,
    grid: tokens["--c-grid"] ?? PALETTES.logsheet.grid,
    select: tokens["--c-select"] ?? PALETTES.logsheet.select,
    cream: tokens["--c-cream"] ?? PALETTES.logsheet.cream,
    labelFont: FONT_OPTIONS[editor.fonts.printed].stack,
    penFont: FONT_OPTIONS[editor.fonts.written].stack,
    voices: editor.voices,
    hues: editor.hues,
  }), [tokens, editor]);
  useEffect(() => writeStorage(EDITOR_STORAGE_KEY, editor), [editor]);
  return (
    <>
    <div ref={scope} data-theme="logsheet" className="pointer-events-none fixed -left-[10000px] top-0 size-px overflow-hidden" aria-hidden="true" />
    <div data-theme="logsheet" data-studio-log-editor className={`min-h-screen bg-canvas font-type text-ink ${workshopOpen ? "xl:pr-[420px]" : ""}`} style={{ colorScheme: "light" }}>
      <style>{buildEditorCss(editor, tokens)}</style>
      <header className="border-b border-edge/70 bg-panel/45">
        <div className="studio-log-container mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-2 px-4 py-3 font-mono text-3xs uppercase tracking-[0.13em] text-inkMuted sm:px-7">
          <div className="flex items-center gap-4"><Link to="/design-lab" className="hover:text-ink hover:underline">← Design Lab</Link><Link to="/" className="hover:text-ink hover:underline">Dashboard</Link></div>
          <div className="flex items-center gap-3"><span>TD–LS / Live specification</span><button type="button" onClick={() => setWorkshopOpen(true)} className="rounded-sm border border-edge bg-accent px-2.5 py-1 font-mono text-3xs uppercase tracking-wide text-accentInk hover:bg-accentHover">✎ Edit theme</button></div>
        </div>
      </header>

      <div id="overview" className="studio-log-container mx-auto max-w-[1480px] scroll-mt-20 px-4 sm:px-7">
        <section className="grid gap-8 py-10 sm:py-14 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-3"><span className="tape-label tape-label--lg">Studio Log</span><span className="stamp stamp--pencil stamp--tight">Light theme</span></div>
            <h1 className="mt-7 max-w-4xl text-4xl leading-[1.08] tracking-[-0.035em] sm:text-6xl">A working session,<br /><span className="font-hand" style={{ color: "var(--ink-hand)", fontSize: "clamp(3rem, 7vw, 5.8rem)", lineHeight: 1.05 }}>written on paper.</span></h1>
            <p className="mt-6 max-w-2xl text-sm leading-7 text-inkMuted sm:text-base">A deep dive into TrackDraft’s light theme: warm stock, graphite rules, blue-biro authorship, and mechanical readouts. Start with the running app values, then select Edit theme to remix them live.</p>
          </div>
          <aside className="border-l-2 border-[#A03A31]/40 pl-5 lg:mb-2">
            <p className="font-mono text-3xs uppercase tracking-[0.18em] text-inkMuted">Design premise / 001</p>
            <p className="mt-3 text-sm leading-6">Not a dark UI inverted. A different material and a different hierarchy.</p>
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-edge/60 pt-4 font-mono text-3xs text-inkMuted">
              <div><dt className="uppercase">Voices</dt><dd className="mt-1 text-xl text-ink">04</dd></div><div><dt className="uppercase">Harmony</dt><dd className="mt-1 text-xl text-ink">07</dd></div><div><dt className="uppercase">Surfaces</dt><dd className="mt-1 text-xl text-ink">03</dd></div>
            </dl>
          </aside>
        </section>
        <div className="flex h-20 overflow-hidden border-y border-edge" aria-label="Studio Log color overture">
          {[tokens["--c-canvas"], tokens["--c-panel"], tokens["--c-panelAlt"], palette.voices.kick, palette.voices.hat, palette.voices.rim, palette.voices.tom, tokens["--ink-hand"]].map((color, index) => <div key={`${color}-${index}`} className="min-w-0 flex-1" style={{ backgroundColor: color ?? tokens["--c-canvas"] }} />)}
        </div>
      </div>

      <nav className="sticky top-0 z-30 border-b border-edge bg-panel/95 shadow-[0_2px_0_rgb(var(--c-ink)/0.03)] backdrop-blur-sm" aria-label="Theme study sections">
        <div className="studio-log-container mx-auto flex max-w-[1480px] gap-5 overflow-x-auto px-4 sm:px-7">{NAV.map((item) => <a key={item.href} href={item.href} className="whitespace-nowrap py-3 font-mono text-2xs text-inkMuted hover:text-ink hover:underline">{item.label}</a>)}</div>
      </nav>

      <main className="studio-log-container mx-auto max-w-[1480px] px-4 sm:px-7">
        <StudySection id="color" number="01" title="Color is assigned a job, not sprayed on." intro="Paper and ink establish the structure. Ochre identifies instruments, blue marks authorship and selection, and the six drum voices remain recognizable without the dark theme’s glow. Select any swatch to copy its resolved hex value."><ColorStudy tokens={tokens} palette={palette} /></StudySection>
        <StudySection id="typography" number="02" title="Four voices tell you where information came from." intro="The type system distinguishes printed form, handwritten input, machine output, and marker-on-tape identity. All four families are self-hosted, so these specimens also verify the production font loading path."><TypeStudy fonts={editor.fonts} sizes={editor.sizes} /></StudySection>
        <StudySection id="layout" number="03" title="The layout is a desk, not a stack of cards." intro="Near-square geometry, fine pencil rules, dense readouts, and generous authored notes keep the interface practical without losing the studio-sheet metaphor. The specimen below is interactive and uses the same CSS recipes as the app."><LayoutStudy palette={palette} /></StudySection>
        <footer className="flex flex-col gap-3 border-t border-edge/70 py-8 font-mono text-3xs leading-5 text-inkMuted sm:flex-row sm:items-center sm:justify-between"><p>Sources: theme/themes.css · theme/palette.ts · theme/fonts.css · tailwind.config.js</p><Link to="/design-lab" className="text-ink underline underline-offset-4">Return to the general Design Lab →</Link></footer>
      </main>
      {!workshopOpen && <button type="button" onClick={() => setWorkshopOpen(true)} className="fixed bottom-5 right-5 z-40 rounded-sm border border-edge bg-accent px-4 py-3 font-mono text-2xs uppercase tracking-wide text-accentInk shadow-[2px_3px_0_rgb(var(--c-ink)/0.18)] hover:bg-accentHover">✎ Edit theme</button>}
      {workshopOpen && <ThemeWorkshop editor={editor} tokens={tokens} onChange={setEditor} onReset={() => setEditor(normalizeEditor({}))} onClose={() => setWorkshopOpen(false)} />}
    </div>
    </>
  );
}
