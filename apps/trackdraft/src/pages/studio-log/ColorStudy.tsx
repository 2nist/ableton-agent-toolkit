import { useState } from "react";
import type { Palette } from "../../theme/palette";
import {
  CSS_TOKENS, INK_TOKENS, INSTRUMENT_TOKENS, MATERIAL_TOKENS, STATUS_TOKENS, SURFACE_TOKENS,
  contrastGrade, contrastRatio, copyText, tokenColor, type CssToken,
} from "./tokens";

function Swatch({ token, hex, ink, onInk, onCopy }: { token: CssToken; hex?: string; ink: string; onInk: string; onCopy: (hex: string) => void }) {
  const lightText = hex ? contrastRatio(ink, hex) < 4.5 : false;
  return (
    <button
      type="button"
      disabled={!hex}
      onClick={() => hex && onCopy(hex)}
      className="group overflow-hidden border border-edge bg-panel text-left disabled:cursor-wait"
      title={hex ? `Copy ${hex}` : "Resolving theme token"}
    >
      <div className="pencil-fill flex h-24 items-end justify-between p-3" style={{ backgroundColor: tokenColor(token), color: lightText ? onInk : ink }}>
        <span className="font-mono text-xs">{token.name}</span>
        <span className="font-type text-xl" aria-hidden="true">Aa</span>
      </div>
      <div className="border-t border-edge/50 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 font-mono text-2xs">
          <span>{hex ?? "…"}</span><span className="text-inkMuted opacity-0 group-hover:opacity-100">COPY</span>
        </div>
        <p className="mt-1 font-mono text-3xs text-inkMuted">{token.variable}</p>
        <p className="mt-2 min-h-8 text-3xs leading-4 text-inkMuted">{token.description}</p>
      </div>
    </button>
  );
}

function TokenGrid({ tokens, resolved, onCopy }: { tokens: CssToken[]; resolved: Record<string, string>; onCopy: (hex: string) => void }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{tokens.map((token) => <Swatch key={token.variable} token={token} hex={resolved[token.variable]} ink={resolved["--c-ink"] ?? "#26221B"} onInk={resolved["--c-accentInk"] ?? "#F8F3E7"} onCopy={onCopy} />)}</div>;
}

export default function ColorStudy({ tokens, palette }: { tokens: Record<string, string>; palette: Palette }) {
  const [notice, setNotice] = useState("");
  const panel = tokens["--c-panel"];
  const pairs = [
    ["Primary ink / card", "--c-ink", "--c-panel"], ["Muted ink / card", "--c-inkMuted", "--c-panel"],
    ["Primary ink / sheet", "--c-ink", "--c-canvas"], ["On-accent / accent", "--c-accentInk", "--c-accent"],
    ["Blue biro / card", "--ink-hand", "--c-panel"], ["OK / card", "--c-ok", "--c-panel"],
    ["Warning / card", "--c-warn", "--c-panel"], ["Danger / card", "--c-danger", "--c-panel"],
  ];
  async function copy(value: string, label?: string) {
    const copied = await copyText(value);
    setNotice(copied ? `Copied ${label ?? value}` : "Clipboard unavailable — values remain selectable above.");
    window.setTimeout(() => setNotice(""), 2200);
  }
  function exportTokens() {
    const value = JSON.stringify(Object.fromEntries(CSS_TOKENS.map((token) => [token.variable, tokens[token.variable]])), null, 2);
    void copy(value, "all resolved CSS tokens");
  }
  return (
    <div className="space-y-8">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-3xs uppercase tracking-widest text-inkMuted">Resolved from [data-theme=&quot;logsheet&quot;]</p>
        <div className="flex items-center gap-3"><span className="font-mono text-2xs text-info" role="status">{notice}</span><button type="button" onClick={exportTokens} className="shrink-0 rounded-sm border border-edge bg-panel px-2.5 py-1 font-mono text-3xs uppercase tracking-wide hover:bg-panelAlt">Copy all tokens</button></div>
      </div>
      <section><h3 className="mb-3 font-mono text-2xs uppercase tracking-[0.15em]">A · Paper and structure</h3><TokenGrid tokens={SURFACE_TOKENS} resolved={tokens} onCopy={(hex) => void copy(hex)} /></section>
      <section><h3 className="mb-3 font-mono text-2xs uppercase tracking-[0.15em]">B · Ink and authorship</h3><TokenGrid tokens={INK_TOKENS} resolved={tokens} onCopy={(hex) => void copy(hex)} /></section>
      <section><h3 className="mb-3 font-mono text-2xs uppercase tracking-[0.15em]">C · Status</h3><TokenGrid tokens={STATUS_TOKENS} resolved={tokens} onCopy={(hex) => void copy(hex)} /></section>
      <section><h3 className="mb-3 font-mono text-2xs uppercase tracking-[0.15em]">D · Instrument surfaces</h3><TokenGrid tokens={INSTRUMENT_TOKENS} resolved={tokens} onCopy={(hex) => void copy(hex)} /></section>
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="border border-edge bg-panel">
          <header className="border-b border-edge px-4 py-3"><h3 className="font-marker text-lg font-normal">Text contrast, measured</h3><p className="mt-1 text-2xs text-inkMuted">WCAG 2.x ratios against the actual surface colors.</p></header>
          <div className="divide-y divide-edge/45">{pairs.map(([label, foreground, background]) => {
            const ratio = tokens[foreground] && tokens[background] ? contrastRatio(tokens[foreground], tokens[background]) : 0;
            return <div key={label} className="grid grid-cols-[minmax(0,1fr)_70px_76px] items-center gap-2 px-4 py-2.5"><span className="text-2xs">{label}</span><span className="text-right font-mono text-2xs">{ratio ? `${ratio.toFixed(2)}:1` : "…"}</span><span className={`text-right font-mono text-3xs uppercase ${ratio >= 4.5 ? "text-ok" : "text-warn"}`}>{ratio ? contrastGrade(ratio) : ""}</span></div>;
          })}</div>
        </section>
        <section><h3 className="mb-3 font-mono text-2xs uppercase tracking-[0.15em]">D · Physical materials</h3><TokenGrid tokens={MATERIAL_TOKENS} resolved={tokens} onCopy={(hex) => void copy(hex)} /></section>
      </div>
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-mono text-2xs uppercase tracking-[0.15em]">E · Harmony hues</h3><p className="mt-1 text-2xs text-inkMuted">Fill, rim, and ink stay together as one degree identity.</p></div><span className="font-mono text-3xs text-inkMuted">palette.hues · live workshop</span></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">{palette.hues.map((hue, index) => <button type="button" key={index} onClick={() => void copy(JSON.stringify(hue), `harmony hue ${index + 1}`)} className="pencil-fill border p-3 text-left transition-transform hover:-translate-y-0.5" style={{ backgroundColor: hue.fill, borderColor: hue.rim, color: hue.ink }} title="Copy fill, rim, and ink"><div className="flex items-center justify-between"><span className="font-hand text-3xl">{["I", "ii", "iii", "IV", "V", "vi", "vii°"][index]}</span><span className="h-4 w-4 rounded-full border" style={{ backgroundColor: hue.rim }} /></div><div className="mt-5 space-y-1 font-mono text-3xs"><p>FILL {hue.fill}</p><p>RIM&nbsp;&nbsp; {hue.rim}</p><p>INK&nbsp;&nbsp; {hue.ink}</p>{panel && <p className="pt-1">RIM / PANEL {contrastRatio(hue.rim, panel).toFixed(2)}:1</p>}</div></button>)}</div>
      </section>
      <section>
        <h3 className="mb-3 font-mono text-2xs uppercase tracking-[0.15em]">F · Drum voices</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Object.entries(palette.voices).map(([voice, color]) => <button type="button" key={voice} onClick={() => void copy(color, voice)} className="border border-edge bg-panel text-left"><div className="pencil-fill flex h-16 items-center justify-center" style={{ backgroundColor: color }}><span className="font-mono text-xs uppercase tracking-widest" style={{ color: contrastRatio(color, "#F8F3E7") >= 4.5 ? "#F8F3E7" : "#26221B" }}>{voice}</span></div><p className="flex items-center justify-between px-3 py-2 font-mono text-2xs"><span>{color}</span><span className="text-inkMuted">{panel ? `${contrastRatio(color, panel).toFixed(2)}:1` : ""}</span></p></button>)}</div>
      </section>
    </div>
  );
}
