/**
 * Design Lab — our shared, hands-on design surface.
 *
 * This is not a mock. Everything on this page renders the CURRENT code:
 * real tokens, real button recipes harvested from the app, real density
 * patterns. The loop is: play here → say what you like in chat → Copilot
 * bakes it into the actual components → hot reload updates this page.
 *
 * Sections map 1:1 to the open design decisions (see the log at the
 * bottom, which mirrors docs/ui-standardization.md §9 and docs/design/).
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ABLETON_DARK, PRESETS, generateFromHue, type PaletteRoles } from "@platform/ui-kit";
import Knob from "../components/common/Knob";

const ROLE_ORDER: (keyof PaletteRoles)[] = [
  "background",
  "panel",
  "text",
  "textMuted",
  "accent",
  "accentHover",
  "accentActive",
  "border",
];

/** Cheap relative-luminance check so a swatch's label reads against its own
 *  background, whether that's a near-black role or a near-white one. */
function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs text-inkMuted uppercase tracking-wide">{title}</h2>
      {sub && <p className="text-[11px] text-inkMuted/70 max-w-3xl">{sub}</p>}
      {children}
    </section>
  );
}

function TemplateCard({ children }: { children: React.ReactNode }) {
  return <div className="border border-edge rounded-lg bg-panel p-4">{children}</div>;
}

function Swatch({ label, hex, sub }: { label: string; hex: string; sub?: string }) {
  return (
    <div className="border border-edge rounded overflow-hidden">
      <div className="h-12 flex flex-col justify-end p-1.5" style={{ background: hex, color: readableOn(hex) }}>
        <span className="text-2xs font-mono leading-tight truncate">{label}</span>
        <span className="text-3xs font-mono leading-tight opacity-80">{hex}</span>
      </div>
      {sub && <div className="px-1.5 py-1 text-3xs text-inkMuted truncate bg-panel">{sub}</div>}
    </div>
  );
}

function PaletteRow({ name, palette }: { name: string; palette: PaletteRoles }) {
  return (
    <div className="border border-edge rounded-lg overflow-hidden">
      <div className="grid grid-cols-4 sm:grid-cols-8">
        {ROLE_ORDER.map((role) => {
          const hex = palette[role];
          return (
            <div
              key={role}
              className="h-14 flex flex-col justify-end p-1.5"
              style={{ background: hex, color: readableOn(hex) }}
              title={`${role}: ${hex}`}
            >
              <span className="text-3xs font-mono leading-tight truncate">{role}</span>
              <span className="text-3xs font-mono leading-tight opacity-80">{hex}</span>
            </div>
          );
        })}
      </div>
      <div className="px-3 py-1.5 bg-panel border-t border-edge">
        <p className="text-xs font-medium">{name}</p>
      </div>
    </div>
  );
}

// Demo-only track colors for the density preview — Live's pastel per-track
// chips, not TrackDraft's own section-role mapping.
const DEMO_TRACKS = [
  { name: "Drums", color: "#a8b4e8" },
  { name: "Percussion", color: "#7fd4c8" },
  { name: "Synth Riser", color: "#e8dd7f" },
  { name: "Chord Pad", color: "#f0b878" },
  { name: "Ambience", color: "#f0a8c8" },
] as const;

function DensityPreview() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-2xs text-inkMuted/70 mb-1">Track header + clip grid (compact rows, near-square cells)</p>
        <div className="border border-edge rounded overflow-hidden inline-block">
          <div className="flex">
            {DEMO_TRACKS.map((t) => (
              <div
                key={t.name}
                className="w-24 h-7 flex items-center px-2 text-2xs font-medium truncate border-r border-edge last:border-r-0"
                style={{ background: t.color, color: "#1a1200" }}
              >
                {t.name}
              </div>
            ))}
          </div>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex">
              {DEMO_TRACKS.map((t, i) => (
                <div
                  key={t.name}
                  className="w-24 h-6 border-t border-r border-edge last:border-r-0 flex items-center px-1.5"
                  style={{ background: row === 1 && i < 3 ? `${t.color}55` : "transparent" }}
                >
                  {row === 1 && i < 3 && <span className="text-3xs text-ink/70">▸</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-2xs text-inkMuted/70 mb-1">Flat tab bar</p>
        <div className="flex gap-4 border-b border-edge">
          {["Clip", "Fold", "Scale", "Notes", "Envelopes", "MPE"].map((tab, i) => (
            <span
              key={tab}
              className={`text-xs pb-1.5 ${i === 0 ? "text-ink border-b-2 border-accent -mb-px" : "text-inkMuted"}`}
            >
              {tab}
            </span>
          ))}
        </div>
      </div>

      <div>
        <p className="text-2xs text-inkMuted/70 mb-1">Compact field group</p>
        <div className="flex gap-3">
          {["Start", "End", "Position", "Length"].map((label) => (
            <label key={label} className="space-y-0.5">
              <span className="block text-3xs text-inkMuted uppercase tracking-wide">{label}</span>
              <input
                className="w-16 h-6 bg-panelAlt border border-edge rounded text-2xs px-1.5 font-mono"
                defaultValue="1.1.1"
                readOnly
              />
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="text-2xs text-inkMuted/70 mb-1">Collapsed-by-default groups for secondary controls</p>
        <div className="border border-edge rounded divide-y divide-edge">
          {["Launch", "Pitch & Time", "Transform"].map((section) => (
            <details key={section} className="group">
              <summary className="text-xs px-2.5 py-1.5 cursor-pointer select-none list-none flex items-center justify-between hover:bg-panelAlt">
                {section}
                <span className="text-inkMuted/50 text-3xs">
                  <span className="group-open:hidden">▸</span>
                  <span className="hidden group-open:inline">▾</span>
                </span>
              </summary>
              <div className="px-2.5 py-2 text-2xs text-inkMuted bg-panel/40">Secondary controls for {section}.</div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Current compiled TrackDraft tokens — exactly what tailwind.config.js
 *  resolves (it derives them from ABLETON_DARK; panelAlt is lighten(panel, 14)). */
const TRACKDRAFT_TOKENS: Array<{ label: string; hex: string; sub: string }> = [
  { label: "canvas", hex: "#383838", sub: "app background" },
  { label: "panel", hex: "#4E4E4E", sub: "panels/dock" },
  { label: "panelAlt", hex: "#5C5C5C", sub: "= lighten(panel, 14)" },
  { label: "edge", hex: "#2C2C2C", sub: "borders/dividers" },
  { label: "ink", hex: "#FFFFFF", sub: "primary text" },
  { label: "inkMuted", hex: "#B0B0B0", sub: "secondary text" },
  { label: "accent", hex: "#FFA500", sub: "interactive orange" },
  { label: "accentHover", hex: "#FFB733", sub: "hover state" },
  { label: "accentActive", hex: "#CC8400", sub: "active state" },
];

const VOICE_COLORS: Array<{ voice: string; hex: string; note: string }> = [
  { voice: "kick", hex: "#D96459", note: "your D5 call" },
  { voice: "snare", hex: "#8B94A1", note: "your D5 call" },
  { voice: "rim", hex: "#4FA3A5", note: "your D5 call" },
  { voice: "hat", hex: "#E8B54A", note: "your D5 call" },
  { voice: "cym", hex: "#D9954A", note: "your D5 call" },
  { voice: "tom", hex: "#9678C8", note: "unchanged" },
];

type DecisionStatus = "PENDING" | "PROPOSED" | "DECIDED";
const DECISIONS: Array<{ id: string; item: string; status: DecisionStatus; note: string }> = [
  {
    id: "D1",
    item: "One accent or two?",
    status: "DECIDED",
    note: "Interactive accent = the #FFA500 token; amber keeps the instrument/graphic role. Both named.",
  },
  {
    id: "D2",
    item: "Button variants — which recipes survive?",
    status: "DECIDED",
    note: "Primary = dense 2xs; sm + roomy retired. Toggle-off/secondary = black chips; disabled = inkMuted on panelAlt. Danger unchanged (confirm if not).",
  },
  {
    id: "D3",
    item: "Type scale — 2px smaller?",
    status: "PROPOSED",
    note: "−2px candidate shown above (lg 16 · sm 12 · xs 10 · 2xs 8 · 3xs 7). React — we can tier the small end.",
  },
  {
    id: "D4",
    item: "Tightened padding + radius",
    status: "PROPOSED",
    note: "Tightened-padding candidate above; radius scale unchanged in that demo (still 2/3/4/5px).",
  },
  {
    id: "D5",
    item: "Voice palette assignments",
    status: "DECIDED",
    note: "Baked: theme/palette.ts → voiceStyle.ts + DrumPatternTools. Drums tab draws in the new hues.",
  },
  {
    id: "D6",
    item: "Density & component patterns",
    status: "PROPOSED",
    note: "Compact rows, flat tabs, collapsed groups — the D3/D4 tightening takes a first step; react to the preview.",
  },
  {
    id: "D7",
    item: "Sliders → knobs (Live-style)",
    status: "DECIDED",
    note: "Knob primitive built (common/Knob.tsx, ghost tick included). Mix/Bend converted; Euclidean sliders in Drums/Harmony next.",
  },
];

export default function DesignLab() {
  const [hue, setHue] = useState(28);
  const [copied, setCopied] = useState(false);
  const [drive, setDrive] = useState<number[]>([0.62, 0.4, 0.31, 0.5]);
  const generated = useMemo(() => generateFromHue(hue), [hue]);

  async function copyPalette() {
    const ts = `export const TRACKDRAFT_PALETTE = ${JSON.stringify(generated, null, 2)} as const;`;
    try {
      await navigator.clipboard.writeText(ts);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the palette stays visible on the page anyway.
    }
  }

  return (
    <div className="p-6 max-w-5xl space-y-8">
      <div>
        <Link to="/" className="text-inkMuted text-sm hover:text-ink">
          ← Back to Dashboard
        </Link>
        <h1 className="text-lg font-semibold mb-1 mt-2">Design Lab</h1>
        <p className="text-sm text-inkMuted max-w-3xl">
          Our shared design surface. Everything below renders the <em>current</em> code — real tokens, real button
          recipes harvested from the app, real density patterns. Play here, then tell Copilot what you like
          (&ldquo;the amber should be the main accent&rdquo;, &ldquo;primary button #2 but roomier&rdquo;) — your
          choices get baked into the actual components and this page updates live.
        </p>
      </div>

      {/* ================= D1: the accent fork ================= */}
      <Section
        title="D1 · The accent fork — two accent families are in play"
        sub="The app today runs an interactive orange (the tokenized accent) and a TrackDraft amber (untokenized literals). They currently coexist without names — deciding their roles is the first design call."
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <TemplateCard>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block h-5 w-5 rounded shrink-0" style={{ background: "#FFA500" }} />
              <div>
                <p className="text-xs font-medium">Interactive accent — token `accent`</p>
                <p className="text-3xs font-mono text-inkMuted">#FFA500 · from ABLETON_DARK</p>
              </div>
            </div>
            <p className="text-2xs text-inkMuted mb-3">
              163 class uses (`text-accent`, `bg-accent`, …) + 9 raw draw-code literals. Becomes: primary buttons,
              active tabs, play/loop state, focus emphasis.
            </p>
            <div className="flex items-center gap-2">
              <button className="bg-accent text-black text-xs font-medium px-2.5 py-1 rounded">▶ Play</button>
              <span className="text-xs px-2 py-1 rounded bg-accent text-black">Active tab</span>
              <span className="text-xs px-2 py-1 rounded border border-edge text-inkMuted">Inactive</span>
            </div>
          </TemplateCard>

          <TemplateCard>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block h-5 w-5 rounded shrink-0" style={{ background: "#E8B54A" }} />
              <div>
                <p className="text-xs font-medium">TrackDraft amber — untokenized</p>
                <p className="text-3xs font-mono text-inkMuted">#E8B54A · literals + AMBER consts</p>
              </div>
            </div>
            <p className="text-2xs text-inkMuted mb-3">
              57 tsx occurrences (+50 in the old Drum Blocks prototype). Becomes: drums kick voice, chord-canvas
              rims, slider accent-color, section-role rims, ◆ ghosts. The &ldquo;instrument&rdquo; color.
            </p>
            <div className="flex items-center gap-3">
              <input type="range" defaultValue={62} className="w-28 accent-[#E8B54A] cursor-pointer" />
              <span className="text-xs font-mono text-[#E8B54A]">◆ detect 66%</span>
              <span
                className="inline-block h-5 w-5 rounded-full"
                style={{ background: "#E8B54A", boxShadow: "0 0 6px rgba(232,181,74,0.5)" }}
                title="kick voice"
              />
            </div>
          </TemplateCard>
        </div>
        <p className="text-[11px] text-inkMuted/70">
          ✓ Decided — the interactive accent stays the #FFA500 token; amber keeps its instrument/graphic role.
          Both are named now, and amber gets a real home in the palette module (see D5 below — the kick has a new
          color too).
        </p>
      </Section>

      {/* ================= Current tokens ================= */}
      <Section
        title="Current compiled tokens (what the whole app uses right now)"
        sub="Derived in tailwind.config.js from @platform/ui-kit's ABLETON_DARK. The rest of the app's colors below this row are the candidates that would join them."
      >
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
          {TRACKDRAFT_TOKENS.map((t) => (
            <Swatch key={t.label} label={t.label} hex={t.hex} sub={t.sub} />
          ))}
        </div>
        <PaletteRow name="ABLETON_DARK — the fixed source all of the above derive from" palette={ABLETON_DARK} />
      </Section>

      {/* ================= Hue playground ================= */}
      <Section
        title="Hue playground — the palette generator"
        sub="generateFromHue derives all 8 roles from one hue (this is the ui-kit's reusable piece; the app's fixed tokens are one instantiation of the idea). Drag to explore; Copy exports the palette as a TS snippet to paste in chat."
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={360}
            value={hue}
            onChange={(e) => setHue(Number(e.target.value))}
            className="flex-1 accent-[#E8B54A]"
          />
          <span className="font-mono text-xs text-inkMuted w-12 text-right tabular-nums">{hue}°</span>
          <button
            className="border border-edge text-inkMuted hover:text-ink rounded px-2 py-0.5 text-2xs font-mono"
            onClick={copyPalette}
          >
            {copied ? "Copied!" : "Copy as TS"}
          </button>
        </div>
        <PaletteRow name={`generateFromHue(${hue})`} palette={generated} />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {Object.entries(PRESETS).map(([name, palette]) => (
            <div key={name} className="border border-edge rounded overflow-hidden">
              <div className="flex">
                {ROLE_ORDER.map((role) => (
                  <div key={role} className="h-6 flex-1" style={{ background: palette[role] }} title={role} />
                ))}
              </div>
              <div className="px-2 py-1 text-3xs text-inkMuted bg-panel font-mono">{name}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ================= Type scale ================= */}
      <Section
        title="D3 · Type scale + the mono micro-label recipe"
        sub="Proposed scale is already tokenized (3xs = 9px, 2xs = 10px) — 159 bracket sizes in the app still bypass it. Numbers use font-mono + tabular-nums."
      >
        <TemplateCard>
          <div className="space-y-2">
            {[
              { cls: "text-lg", name: "lg · 18px", use: "page titles", sample: "Design Lab" },
              { cls: "text-sm", name: "sm · 14px", use: "body / descriptions", sample: "Our shared design surface — everything renders the current code." },
              { cls: "text-xs", name: "xs · 12px", use: "controls, buttons, list rows", sample: "Pattern density · Backbeat · Apply template" },
              { cls: "text-2xs", name: "2xs · 10px", use: "compact labels, field text", sample: "Verse 2 · 29 bars · 141.2 BPM" },
              { cls: "text-3xs", name: "3xs · 9px", use: "dense readouts, swatch labels", sample: "kick · 3.4/bar · share 8.1%" },
            ].map((row) => (
              <div key={row.cls} className="flex items-baseline gap-3 border-b border-edge/50 pb-1.5 last:border-b-0">
                <span className="w-20 shrink-0 text-3xs font-mono text-inkMuted">{row.name}</span>
                <span className={`${row.cls} flex-1 truncate`}>{row.sample}</span>
                <span className="text-3xs text-inkMuted/60 shrink-0">{row.use}</span>
              </div>
            ))}
            <div className="flex items-center gap-3 pt-1">
              <span className="w-20 shrink-0 text-3xs font-mono text-inkMuted">mono recipe</span>
              <span className="text-2xs font-mono uppercase tracking-wider text-inkMuted">
                pattern density · backbeat · register
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-3xs font-mono text-inkMuted">numbers</span>
              <span className="text-xs font-mono tabular-nums">141.2 bpm · 66% · 4.36/bar · +0.67</span>
            </div>
          </div>
        </TemplateCard>
      </Section>

      {/* ================= D3/D4 candidate ================= */}
      <Section
        title="D3 + D4 candidate — everything −2px, padding tightened"
        sub="You asked to see it — left is today, orange is the candidate: every size down 2px (lg 16 · sm 12 · xs 10 · 2xs 8 · 3xs 7) and paddings/gaps tightened ~1px a side. Nothing is committed; react and we can tier it (e.g. −2 large, −1 small) if the small end reads too small."
      >
        <TemplateCard>
          <div className="space-y-1.5">
            {[
              { name: "lg", cur: 18, cand: 16, sample: "Design Lab" },
              { name: "sm", cur: 14, cand: 12, sample: "Our shared design surface." },
              { name: "xs", cur: 12, cand: 10, sample: "Pattern density · Backbeat · Apply template" },
              { name: "2xs", cur: 10, cand: 8, sample: "Verse 2 · 29 bars · 141.2 BPM" },
              { name: "3xs", cur: 9, cand: 7, sample: "kick · 3.4/bar · share 8.1%" },
            ].map((row) => (
              <div key={row.name} className="flex items-baseline gap-4">
                <span className="w-10 shrink-0 text-3xs font-mono text-inkMuted">{row.name}</span>
                <span className="flex-1 truncate" style={{ fontSize: row.cur }}>
                  {row.sample}
                </span>
                <span className="flex-1 truncate text-accent" style={{ fontSize: row.cand }}>
                  {row.sample}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-edge/60 grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-2xs text-inkMuted/70 mb-1.5">Today</p>
              <div className="flex items-center gap-2">
                <button className="bg-accent text-black text-xs font-medium px-2.5 py-1 rounded">Apply</button>
                <span className="text-xs px-2 py-1 rounded bg-accent text-black">ON</span>
                <span className="text-xs px-2 py-1 rounded bg-black text-inkMuted">OFF</span>
              </div>
            </div>
            <div>
              <p className="text-2xs text-inkMuted/70 mb-1.5">Tightened candidate</p>
              <div className="flex items-center gap-1.5">
                <button className="bg-accent text-black text-[10px] font-medium px-1.5 py-0.5 rounded">Apply</button>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-black">ON</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-black text-inkMuted">OFF</span>
              </div>
            </div>
          </div>
        </TemplateCard>
      </Section>

      {/* ================= Buttons ================= */}
      <Section
        title="D2 · Buttons — your call, applied"
        sub="Decided: the dense 2xs primary is the survivor (sm + roomy retired; the common xs folds into dense as the app migrates). Toggle-off and secondary become black chips; disabled is muted text on panelAlt. This set becomes Button v1 in the primitives layer."
      >
        <TemplateCard>
          <div className="space-y-3">
            {[
              {
                label: "Primary — dense 2xs (canonical)",
                cls: "bg-accent text-black text-[10px] font-medium px-2 py-0.5 rounded",
                text: "Add Section",
                src: "your D2 call",
              },
              {
                label: "Primary — xs (folds into dense)",
                cls: "bg-accent text-black text-xs font-medium px-2.5 py-1 rounded",
                text: "Apply",
                src: "still in the wild; migrating",
              },
              {
                label: "Toggle pair — ON",
                cls: "bg-accent text-black text-xs px-2 py-1 rounded",
                text: "Per-section",
                src: "accent = active",
              },
              {
                label: "Toggle pair — OFF (black bg)",
                cls: "bg-black text-inkMuted hover:text-ink text-xs px-2 py-1 rounded",
                text: "Song text",
                src: "your D2 call",
              },
              {
                label: "Secondary — black border + bg",
                cls: "bg-black border border-black text-inkMuted hover:text-ink rounded px-2 py-0.5 text-2xs",
                text: "Not found your device?",
                src: "your D2 call",
              },
              {
                label: "Ghost (kept)",
                cls: "border border-edge text-inkMuted hover:text-ink rounded px-2 py-0.5 text-2xs font-mono",
                text: "Test",
                src: "kept as-is",
              },
              {
                label: "Danger (kept — red stays)",
                cls: "bg-red-600 text-white text-[10px] font-medium px-2 py-0.5 rounded",
                text: "● Record",
                src: "flag if this should change",
              },
              {
                label: "Disabled — inkMuted on panelAlt",
                cls: "bg-panelAlt text-inkMuted text-[10px] font-medium px-2 py-0.5 rounded cursor-not-allowed",
                text: "Sync",
                disabled: true,
                src: "your D2 call",
              },
            ].map((b) => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="w-52 shrink-0 text-2xs text-inkMuted">{b.label}</span>
                <button className={b.cls} disabled={b.disabled}>
                  {b.text}
                </button>
                <span className="text-3xs font-mono text-inkMuted/50 ml-auto truncate">{b.src}</span>
              </div>
            ))}
          </div>
        </TemplateCard>
        <p className="text-[11px] text-inkMuted/70">
          Retired: Primary · sm, Primary · roomy. Black chips use #000 against the #4E4E4E panels — if that reads
          too hard we soften to the deep fill (#0B0D11).
        </p>
      </Section>

      {/* ================= Knob primitive ================= */}
      <Section
        title="New · Knob — the Live-style rotary control (first real primitive)"
        sub="Vertical drag turns · shift for fine · double-click resets · arrow keys when focused. The amber tick sitting on the arc is the ◆ detected ghost — the same suggest-don't-impose rule, now on a knob. Lives in components/common/Knob.tsx."
      >
        <TemplateCard>
          <div className="flex items-start gap-8 flex-wrap">
            <div>
              <p className="text-2xs text-inkMuted/70 mb-2">A device panel, like your reference:</p>
              <div className="border border-edge rounded-lg bg-[#14161c] px-4 py-3 grid grid-cols-4 gap-4 w-[360px]">
                {[
                  { label: "Drive Amount", fmt: (t: number) => `${(t * 14 - 2).toFixed(1)} dB` },
                  { label: "Drive Color", fmt: (t: number) => `${Math.round(t * 100)} %` },
                  { label: "Drive Output", fmt: (t: number) => `${(t * 14 - 2).toFixed(1)} dB` },
                  { label: "Dry / Wet", fmt: (t: number) => `${Math.round(t * 100)} %` },
                ].map((k, i) => (
                  <div key={k.label} className="flex flex-col items-center gap-1">
                    <span className="text-3xs text-inkMuted text-center leading-tight">{k.label}</span>
                    <span className="font-mono text-2xs text-ink tabular-nums">{k.fmt(drive[i])}</span>
                    <Knob
                      value={drive[i]}
                      onChange={(v) => setDrive((d) => d.map((x, j) => (j === i ? v : x)))}
                      size={40}
                      defaultValue={0.5}
                      className="text-accent"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-2xs text-inkMuted/70 mb-2">Sizes — 28 / 34 / 40 / 48</p>
                <div className="flex items-center gap-3">
                  {[28, 34, 40, 48].map((s) => (
                    <Knob
                      key={s}
                      value={drive[0]}
                      onChange={(v) => setDrive((d) => [v, ...d.slice(1)])}
                      size={s}
                      className="text-accent"
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-2xs text-inkMuted/70 mb-2">Colors (voice tokens) — and a ◆ ghost tick</p>
                <div className="flex items-center gap-3">
                  <Knob value={drive[0]} onChange={(v) => setDrive((d) => [v, ...d.slice(1)])} size={34} className="text-[#D96459]" />
                  <Knob value={drive[1]} onChange={(v) => setDrive((d) => [d[0], v, ...d.slice(2)])} size={34} className="text-[#4FA3A5]" />
                  <Knob value={drive[2]} onChange={(v) => setDrive((d) => [d[0], d[1], v, d[3]])} size={34} className="text-[#E8B54A]" />
                  <Knob value={drive[3]} onChange={(v) => setDrive((d) => [d[0], d[1], d[2], v])} size={34} ghost={0.72} className="text-accent" />
                  <span className="text-2xs font-mono text-[#E8B54A]">◆ 72%</span>
                </div>
              </div>
              <p className="text-2xs text-inkMuted/70">
                Rollout: Mix/Bend converted now (14 axis knobs + tempo); the Euclidean-ish sliders in Drums/Harmony next.
              </p>
            </div>
          </div>
        </TemplateCard>
      </Section>

      {/* ================= Voice palette ================= */}
      <Section
        title="D5 · Drums voice palette — decided & baked"
        sub="Your call, live in the app: kick red · snare slate · rim teal · hat amber · cym orange · tom purple. Single-sourced in src/theme/palette.ts and consumed by voiceStyle.ts + DrumPatternTools — open the Drums tab and the cells/necklaces already draw in these."
      >
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {VOICE_COLORS.map((v) => (
            <Swatch key={v.voice} label={v.voice} hex={v.hex} sub={v.note || undefined} />
          ))}
        </div>
      </Section>

      {/* ================= Radius + density ================= */}
      <Section title="D4 · Radius scale + density patterns" sub="Radius: proposed 2/3/4/5px (Live-like, near-square). Density: adapted from a real Session View screenshot.">
        <TemplateCard>
          <div className="flex items-center gap-4 mb-4">
            {[
              { cls: "rounded-sm", px: "2px" },
              { cls: "rounded", px: "3px" },
              { cls: "rounded-md", px: "4px" },
              { cls: "rounded-lg", px: "5px" },
            ].map((r) => (
              <div key={r.cls} className="text-center">
                <div className={`w-16 h-10 bg-panelAlt border border-edge ${r.cls}`} />
                <p className="text-3xs font-mono text-inkMuted mt-1">
                  {r.cls} · {r.px}
                </p>
              </div>
            ))}
          </div>
          <DensityPreview />
        </TemplateCard>
      </Section>

      {/* ================= Decisions log ================= */}
      <Section
        title="Design decisions log"
        sub="Mirrors docs/design/ + docs/ui-standardization.md §9. When you decide, say it in chat — the status updates here and the decision gets baked into code."
      >
        <div className="border border-edge rounded-lg overflow-hidden">
          {DECISIONS.map((d, i) => (
            <div
              key={d.id}
              className={`flex items-start gap-3 px-3 py-2 bg-panel ${i > 0 ? "border-t border-edge" : ""}`}
            >
              <span className="text-3xs font-mono text-inkMuted w-8 shrink-0 pt-0.5">{d.id}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{d.item}</p>
                <p className="text-2xs text-inkMuted">{d.note}</p>
              </div>
              <span
                className={`text-3xs font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                  d.status === "PENDING"
                    ? "border-accent/50 text-accent"
                    : d.status === "PROPOSED"
                      ? "border-edge text-inkMuted"
                      : "border-emerald-400/50 text-emerald-400"
                }`}
              >
                {d.status}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
