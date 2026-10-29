import { useEffect, useState } from "react";
import { buildEditorCss, type ThemeEditorState } from "./editor";
import { copyText } from "./tokens";
import WorkshopColors from "./WorkshopColors";
import WorkshopLayout from "./WorkshopLayout";
import WorkshopTypography from "./WorkshopTypography";

type Tab = "colors" | "typography" | "layout";

export default function ThemeWorkshop({ editor, tokens, onChange, onReset, onClose }: {
  editor: ThemeEditorState;
  tokens: Record<string, string>;
  onChange: (editor: ThemeEditorState) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("colors");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  async function copyCss() {
    const css = `/* TrackDraft Studio Log — workshop export */\n${buildEditorCss(editor, tokens, '[data-theme="logsheet"]')}\n`;
    setNotice(await copyText(css) ? "CSS copied" : "Clipboard unavailable");
  }
  function exportJson() {
    const payload = { format: "trackdraft-studio-log-theme", version: 1, exportedAt: new Date().toISOString(), theme: { ...editor, colors: tokens } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "studio-log-theme.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("JSON exported");
  }
  return (
    <aside role="dialog" aria-modal="false" aria-label="Studio Log theme workshop" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-edge bg-panel text-ink shadow-[-8px_0_24px_rgb(var(--c-ink)/0.12)]">
      <header className="border-b border-edge px-4 py-4">
        <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-3xs uppercase tracking-[0.16em] text-info">Live editor · saved locally</p><h2 className="mt-1 font-marker text-2xl font-normal">Theme Workshop</h2></div><button autoFocus type="button" onClick={onClose} aria-label="Close theme workshop" className="rounded-sm border border-edge px-2 py-1 font-mono text-xs hover:bg-panelAlt">×</button></div>
        <p className="mt-2 text-2xs leading-5 text-inkMuted">Changes restyle this preview and persist in this browser. Export them to apply to the app source.</p>
      </header>
      <div className="grid grid-cols-3 border-b border-edge" role="tablist" aria-label="Theme editor sections">{(["colors", "typography", "layout"] as Tab[]).map((item) => <button type="button" role="tab" aria-selected={tab === item} key={item} onClick={() => setTab(item)} className={`px-2 py-2.5 font-mono text-3xs uppercase tracking-wide ${tab === item ? "bg-panelAlt text-ink shadow-[inset_0_-2px_0_var(--pencil-red)]" : "text-inkMuted hover:text-ink"}`}>{item}</button>)}</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role="tabpanel">
        {tab === "colors" && <WorkshopColors editor={editor} tokens={tokens} onChange={onChange} />}
        {tab === "typography" && <WorkshopTypography editor={editor} onChange={onChange} />}
        {tab === "layout" && <WorkshopLayout editor={editor} onChange={onChange} />}
      </div>
      <footer className="border-t border-edge bg-panelAlt/30 p-3">
        <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => void copyCss()} className="rounded-sm border border-edge bg-accent px-3 py-2 font-mono text-3xs uppercase tracking-wide text-accentInk hover:bg-accentHover">Copy CSS</button><button type="button" onClick={exportJson} className="rounded-sm border border-edge px-3 py-2 font-mono text-3xs uppercase tracking-wide hover:bg-panelAlt">Export JSON</button></div>
        <div className="mt-2 flex items-center justify-between gap-2"><button type="button" onClick={() => { onReset(); setNotice("Original theme restored"); }} className="font-mono text-3xs uppercase tracking-wide text-danger hover:underline">Reset all</button><span className="font-mono text-3xs text-info" role="status">{notice || "CSS = tokens · JSON = complete theme"}</span></div>
      </footer>
    </aside>
  );
}
