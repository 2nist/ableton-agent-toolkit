/**
 * Extract and manage CSS custom properties (design tokens) so the
 * CssPlayground panel can edit them live.
 */

export interface CssToken {
  name: string;
  value: string;
  category: "color" | "spacing" | "radius" | "font" | "other";
}

/** Default tokens matching trackdraft's tailwind.config.js theme.extend */
export function getDefaultTokens(): CssToken[] {
  return [
    { name: "--tw-color-canvas", value: "#0d0d0f", category: "color" },
    { name: "--tw-color-panel", value: "#1a1a1e", category: "color" },
    { name: "--tw-color-panelAlt", value: "#232328", category: "color" },
    { name: "--tw-color-edge", value: "#2e2e34", category: "color" },
    { name: "--tw-color-ink", value: "#e8e8ea", category: "color" },
    { name: "--tw-color-inkMuted", value: "#8a8a92", category: "color" },
    { name: "--tw-color-accent", value: "#ffa500", category: "color" },
    { name: "--tw-radius", value: "0.5rem", category: "radius" },
    { name: "--tw-spacing-unit", value: "0.25rem", category: "spacing" },
  ];
}

/** Load tokens from localStorage or return defaults */
export function loadTokens(): CssToken[] {
  try {
    const raw = localStorage.getItem("devkit-css-tokens");
    if (raw) return JSON.parse(raw) as CssToken[];
  } catch {
    // ignore
  }
  return getDefaultTokens();
}

/** Save tokens to localStorage */
export function saveTokens(tokens: CssToken[]): void {
  localStorage.setItem("devkit-css-tokens", JSON.stringify(tokens));
}

/** Apply tokens to the :root element of the preview iframe */
export function applyTokensToRoot(root: HTMLElement, tokens: CssToken[]): void {
  for (const token of tokens) {
    root.style.setProperty(token.name, token.value);
  }
}

/** Apply extra Tailwind classes to a wrapper element */
export function applyClassOverrides(element: HTMLElement, classString: string): void {
  // Clear previous dynamic classes
  const prev = element.getAttribute("data-dynamic-classes");
  if (prev) {
    prev.split(/\s+/).forEach((c) => element.classList.remove(c));
  }
  // Apply new ones
  const classes = classString.split(/\s+/).filter(Boolean);
  for (const c of classes) {
    element.classList.add(c);
  }
  element.setAttribute("data-dynamic-classes", classString);
}