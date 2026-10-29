import { PALETTES, type HueSet, type VoiceColors } from "../../theme/palette";
import { readStorage } from "../../store/storage";
import { CSS_TOKENS, hexToChannels } from "./tokens";

export const EDITOR_STORAGE_KEY = "trackdraft-studio-log-workshop-v1";
export type FontRole = "printed" | "mechanical" | "written" | "marker";
export type FontId = "courier" | "plex" | "reenie" | "marker";
export const FONT_OPTIONS: Record<FontId, { name: string; stack: string; weights: string }> = {
  courier: { name: "Courier Prime", stack: '"Courier Prime", "Courier New", Courier, monospace', weights: "400 / 700" },
  plex: { name: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, monospace', weights: "400 / 500 / 600" },
  reenie: { name: "Reenie Beanie", stack: '"Reenie Beanie", "Segoe Script", "Bradley Hand", cursive', weights: "400 only" },
  marker: { name: "Permanent Marker", stack: '"Permanent Marker", cursive', weights: "400 only" },
};
export interface EditorSizes { written: number; title: number; tapeSm: number; tapeMd: number; tapeLg: number }
export interface EditorLayout { radius: number; ledger: number; margin: number; contentWidth: number; grain: boolean }
export interface ThemeEditorState {
  colors: Record<string, string>; voices: VoiceColors; hues: HueSet[];
  fonts: Record<FontRole, FontId>; sizes: EditorSizes; layout: EditorLayout;
}
export const DEFAULT_EDITOR: ThemeEditorState = {
  colors: {}, voices: { ...PALETTES.logsheet.voices }, hues: PALETTES.logsheet.hues.map((hue) => ({ ...hue })),
  fonts: { printed: "courier", mechanical: "plex", written: "reenie", marker: "marker" },
  sizes: { written: 17, title: 21, tapeSm: 13, tapeMd: 17, tapeLg: 22 },
  layout: { radius: 2, ledger: 22, margin: 2, contentWidth: 1480, grain: true },
};
const isHex = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const numberIn = (value: unknown, fallback: number, min: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Merge saved partial data defensively: localStorage is user-editable input. */
export function normalizeEditor(saved: Partial<ThemeEditorState>): ThemeEditorState {
  const colors = Object.fromEntries(Object.entries(saved.colors ?? {}).filter(([, value]) => isHex(value)).map(([key, value]) => [key, (value as string).toUpperCase()]));
  const voices = Object.fromEntries(Object.entries(PALETTES.logsheet.voices).map(([voice, fallback]) => {
    const value = saved.voices?.[voice as keyof VoiceColors];
    return [voice, isHex(value) ? value.toUpperCase() : fallback];
  })) as unknown as VoiceColors;
  const hues = PALETTES.logsheet.hues.map((fallback, index) => {
    const hue = saved.hues?.[index];
    return { fill: isHex(hue?.fill) ? hue.fill.toUpperCase() : fallback.fill, rim: isHex(hue?.rim) ? hue.rim.toUpperCase() : fallback.rim, ink: isHex(hue?.ink) ? hue.ink.toUpperCase() : fallback.ink };
  });
  const fonts = { ...DEFAULT_EDITOR.fonts };
  for (const role of Object.keys(fonts) as FontRole[]) {
    const candidate = saved.fonts?.[role];
    if (candidate && candidate in FONT_OPTIONS) fonts[role] = candidate;
  }
  const size = saved.sizes ?? DEFAULT_EDITOR.sizes;
  const layout = saved.layout ?? DEFAULT_EDITOR.layout;
  return {
    colors, voices, hues, fonts,
    sizes: {
      written: numberIn(size.written, 17, 12, 32), title: numberIn(size.title, 21, 16, 42),
      tapeSm: numberIn(size.tapeSm, 13, 10, 24), tapeMd: numberIn(size.tapeMd, 17, 12, 30), tapeLg: numberIn(size.tapeLg, 22, 16, 38),
    },
    layout: {
      radius: numberIn(layout.radius, 2, 0, 10), ledger: numberIn(layout.ledger, 22, 16, 36),
      margin: numberIn(layout.margin, 2, 0, 6), contentWidth: numberIn(layout.contentWidth, 1480, 1100, 1800),
      grain: typeof layout.grain === "boolean" ? layout.grain : true,
    },
  };
}
export function loadEditor(): ThemeEditorState {
  const saved = readStorage<Partial<ThemeEditorState> | null>(EDITOR_STORAGE_KEY, null);
  return normalizeEditor(saved && typeof saved === "object" ? saved : {});
}

/** One stylesheet drives both the live workshop and its exportable CSS. */
export function buildEditorCss(editor: ThemeEditorState, tokens: Record<string, string>, selector = "[data-studio-log-editor]"): string {
  const colors = CSS_TOKENS.map((token) => {
    const value = editor.colors[token.variable] ?? tokens[token.variable];
    if (!isHex(value)) return "";
    return `  ${token.variable}: ${token.variable.startsWith("--c-") ? hexToChannels(value) : value};`;
  }).filter(Boolean).join("\n");
  const { fonts, sizes, layout } = editor;
  return `${selector} {\n${colors}\n  --ui-font: ${FONT_OPTIONS[fonts.printed].stack};\n  --editor-mechanical-font: ${FONT_OPTIONS[fonts.mechanical].stack};\n  --hand-pen: ${FONT_OPTIONS[fonts.written].stack};\n  --marker-pen: ${FONT_OPTIONS[fonts.marker].stack};${layout.grain ? "" : "\n  --paper-grain: none;"}\n}\n${selector} .font-type { font-family: var(--ui-font); }\n${selector} .font-mono { font-family: var(--editor-mechanical-font); }\n${selector} .font-hand { font-family: var(--hand-pen); }\n${selector} .font-marker { font-family: var(--marker-pen); }\n${selector} .hand-value { font-size: ${sizes.written}px; }\n${selector} .hand-value--title { font-size: ${sizes.title}px; }\n${selector} .hand-value--up { font-size: ${sizes.written}px; }\n${selector} .tape-label--sm { --tape-size: ${sizes.tapeSm}px; }\n${selector} .tape-label, ${selector} .tape-label--md { --tape-size: ${sizes.tapeMd}px; }\n${selector} .tape-label--lg { --tape-size: ${sizes.tapeLg}px; }\n${selector} .rounded-sm, ${selector} .rounded, ${selector} .rounded-md, ${selector} .rounded-lg { border-radius: ${layout.radius}px; }\n${selector} .ledger { background-image: repeating-linear-gradient(to bottom, transparent 0 ${layout.ledger - 1}px, var(--ledger-rule) ${layout.ledger - 1}px ${layout.ledger}px); }\n${selector} main { box-shadow: inset ${layout.margin}px 0 0 var(--ledger-margin); }\n${selector} .studio-log-container { max-width: ${layout.contentWidth}px; }`;
}
