import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ABLETON_DARK, PRESETS, generateFromHue, detectHost, type PaletteRoles } from "@platform/ui-kit";

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

/** Cheap relative-luminance check so a swatch's role label reads against
 *  its own background, whether that's a near-black "background" role or a
 *  near-white "text" role — a single fixed label color would be illegible
 *  on half of any given palette. */
function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
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
              className="h-16 flex flex-col justify-end p-1.5"
              style={{ background: hex, color: readableOn(hex) }}
              title={`${role}: ${hex}`}
            >
              <span className="text-[9px] font-mono leading-tight truncate">{role}</span>
              <span className="text-[8.5px] font-mono leading-tight opacity-80">{hex}</span>
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

// Demo-only track colors, purely for the density preview below — Live's own
// pastel per-track chips (Session View), not TrackDraft's ROLE_STYLE (a
// different semantic mapping for song sections).
const DEMO_TRACKS = [
  { name: "Drums", color: "#a8b4e8" },
  { name: "Percussion", color: "#7fd4c8" },
  { name: "Synth Riser", color: "#e8dd7f" },
  { name: "Chord Pad", color: "#f0b878" },
  { name: "Ambience", color: "#f0a8c8" },
] as const;

/** Spacing/density reference lifted from a real Ableton Live screenshot
 *  (Session View clip grid, clip detail panel, device chain) — not
 *  measured pixel-for-pixel, but adapted for the patterns that actually
 *  read as "tight": near-square cells (the new `rounded` scale), compact
 *  fixed row heights, hairline dividers instead of padded card borders,
 *  a flat text tab bar, and collapsed-by-default accordion groups for
 *  secondary controls (exactly the design guide's own "hide optional
 *  controls in expandable sections" principle). */
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

/** Evaluation sandbox for `@platform/ui-kit` (packages/ui-kit) — a shared
 *  token/bridge system built for Ableton Extensions webview modals and M4L
 *  jweb devices, not currently a TrackDraft dependency. Laid out here so
 *  its actual output can be compared side by side with TrackDraft's own
 *  ad hoc 7-color Tailwind palette before deciding whether it's the right
 *  foundation for a global styling pass. */
export default function UiKitSandbox() {
  const [hue, setHue] = useState(28); // starts at ABLETON_DARK's own accent hue (~28°, #FFA500)
  const generated = useMemo(() => generateFromHue(hue), [hue]);
  const host = useMemo(() => detectHost(), []);

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <Link to="/" className="text-inkMuted text-sm hover:text-ink">
          ← Back to Dashboard
        </Link>
        <h1 className="text-lg font-semibold mb-1 mt-2">UI Kit Sandbox</h1>
        <p className="text-sm text-inkMuted">
          Evaluating <code className="text-ink">@platform/ui-kit</code> — a shared design-token system (8 semantic
          roles derived from one hue) plus a host-detecting message bridge for Ableton Extensions/M4L webviews.
          Not wired into any real TrackDraft screen; this page just renders what the package actually produces.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs text-inkMuted uppercase tracking-wide">Fixed palettes</h2>
        <PaletteRow name="ABLETON_DARK — Ableton's own webview chrome" palette={ABLETON_DARK} />
        <p className="text-[11px] text-inkMuted/70">
          Its <code>accent</code> is <code>#FFA500</code> — the exact same hex TrackDraft's own <code>accent</code>{" "}
          token already uses. Not a coincidence worth re-deriving; a real signal that this palette is the same
          lineage.
        </p>
        {Object.entries(PRESETS).map(([name, palette]) => (
          <PaletteRow key={name} name={`PRESETS.${name}`} palette={palette} />
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs text-inkMuted uppercase tracking-wide">generateFromHue(hue) — live</h2>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={360}
            value={hue}
            onChange={(e) => setHue(Number(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono text-xs text-inkMuted w-12 text-right">{hue}°</span>
        </div>
        <PaletteRow name={`generateFromHue(${hue})`} palette={generated} />
      </section>

      <section className="space-y-2">
        <h2 className="text-xs text-inkMuted uppercase tracking-wide">Density — adapted from a Live screenshot</h2>
        <p className="text-[11px] text-inkMuted/70">
          Colors above are now live app-wide (<code>tailwind.config.js</code> sources them from{" "}
          <code>ABLETON_DARK</code>). This part isn't from the package — no spacing/density scale exists in
          ui-kit — it's adapted from a real Session View + clip/device panel screenshot: near-square cells
          (tightened <code>rounded</code> scale), compact fixed row heights, hairline dividers instead of padded
          card borders, flat text tabs, and collapsed-by-default groups for secondary controls.
        </p>
        <div className="border border-edge rounded-lg bg-panel p-4">
          <DensityPreview />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs text-inkMuted uppercase tracking-wide">Bridge (createBridge / detectHost)</h2>
        <div className="border border-edge rounded-lg bg-panel p-3">
          <p className="text-xs">
            Detected host: <span className="font-mono text-accent">{host}</span>
          </p>
          <p className="text-[11px] text-inkMuted/70 mt-1">
            Always "unknown" here — TrackDraft runs standalone in a regular browser tab, not inside an Ableton
            Extensions modal or an M4L jweb device, which is the only context this bridge does anything in.
            Included for completeness of what the package offers, not because it's useful in this app.
          </p>
        </div>
      </section>
    </div>
  );
}
