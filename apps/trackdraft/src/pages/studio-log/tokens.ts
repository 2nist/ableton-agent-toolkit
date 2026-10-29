import { useEffect, useState, type RefObject } from "react";

export interface CssToken {
  name: string;
  variable: string;
  description: string;
}

/** Metadata only: color values are read from the scoped, live theme below. */
export const SURFACE_TOKENS: CssToken[] = [
  { name: "Canvas / sheet", variable: "--c-canvas", description: "Page background and open space" },
  { name: "Panel / card stock", variable: "--c-panel", description: "Cards, forms, and raised content" },
  { name: "Panel alt / well", variable: "--c-panelAlt", description: "Recessed fields and selected regions" },
  { name: "Edge / pencil rule", variable: "--c-edge", description: "Borders, separators, and structural rules" },
];

export const INK_TOKENS: CssToken[] = [
  { name: "Ink", variable: "--c-ink", description: "Primary type and interactive ink" },
  { name: "Muted ink", variable: "--c-inkMuted", description: "Secondary labels and supporting copy" },
  { name: "Interactive accent", variable: "--c-accent", description: "Primary actions and active controls" },
  { name: "Accent hover", variable: "--c-accentHover", description: "Graphite hover state" },
  { name: "Accent active", variable: "--c-accentActive", description: "Darkest pressed state" },
  { name: "Accent ink", variable: "--c-accentInk", description: "Type placed on the solid accent" },
  { name: "Handwritten ink", variable: "--ink-hand", description: "Blue biro for human-entered values" },
  { name: "Pencil red", variable: "--pencil-red", description: "Active marks and rehearsal annotations" },
];

export const STATUS_TOKENS: CssToken[] = [
  { name: "OK", variable: "--c-ok", description: "Complete and confirmed" },
  { name: "Warning", variable: "--c-warn", description: "Needs attention" },
  { name: "Danger", variable: "--c-danger", description: "Errors and destructive actions" },
  { name: "Info", variable: "--c-info", description: "References and imported information" },
  { name: "Alternate", variable: "--c-accentAlt", description: "Secondary provenance identity" },
];

export const INSTRUMENT_TOKENS: CssToken[] = [
  { name: "Instrument ochre", variable: "--c-track", description: "Graphic accent and instrument identity" },
  { name: "Instrument scene", variable: "--c-scene", description: "Backdrop behind drawn instruments" },
  { name: "Deep plate", variable: "--c-deep", description: "Knob bodies and inset instrument plates" },
  { name: "Instrument well", variable: "--c-well", description: "Recessed controls over an instrument scene" },
  { name: "Instrument label", variable: "--c-label", description: "Axis labels and tick numerals" },
  { name: "Instrument grid", variable: "--c-grid", description: "Hairline rules inside drawn instruments" },
  { name: "Cream / writing", variable: "--c-cream", description: "Instrument lettering; ink on the log sheet" },
  { name: "Selection", variable: "--c-select", description: "Preview and ghost selection" },
];

export const MATERIAL_TOKENS: CssToken[] = [
  { name: "Tape / light", variable: "--tape-a", description: "Top of the masking-tape gradient" },
  { name: "Tape / shade", variable: "--tape-b", description: "Bottom of the masking-tape gradient" },
  { name: "Sticker stock", variable: "--sticker-bg", description: "Machine-printed adhesive labels" },
  { name: "Sticker edge", variable: "--sticker-edge", description: "Hairline around printed stickers" },
];

export const CSS_TOKENS = [...SURFACE_TOKENS, ...INK_TOKENS, ...STATUS_TOKENS, ...INSTRUMENT_TOKENS, ...MATERIAL_TOKENS];

export function tokenColor(token: CssToken): string {
  return token.variable.startsWith("--c-") ? `rgb(var(${token.variable}))` : `var(${token.variable})`;
}

/** CSS channel triplets (\"239 231 214\") and hex both resolve to display hex. */
export function channelsToHex(value: string): string {
  const input = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(input)) return input.toUpperCase();
  const parts = input.split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`Expected three RGB channels or six-digit hex, received: ${value}`);
  }
  return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function hexToChannels(hex: string): string {
  const normalized = channelsToHex(hex).slice(1);
  return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16)).join(" ");
}

function luminance(hex: string): number {
  const normalized = channelsToHex(hex).slice(1);
  const channels = [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2.x contrast ratio, from 1:1 to 21:1. */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function contrastGrade(ratio: number): string {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA large";
  return "Below AA";
}

/** Read the actual values applied by themes.css inside this page's theme scope. */
export function useResolvedTokens(scope: RefObject<HTMLElement | null>): Record<string, string> {
  const [resolved, setResolved] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!scope.current) return;
    const styles = getComputedStyle(scope.current);
    const next: Record<string, string> = {};
    for (const token of CSS_TOKENS) next[token.variable] = channelsToHex(styles.getPropertyValue(token.variable));
    setResolved(next);
  }, [scope]);
  return resolved;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}
