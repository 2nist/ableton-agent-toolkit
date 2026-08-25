/** Dev helper: write a standalone Drum Studio preview HTML for browser QA. */
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import { PRESET_DATA } from "@drum/library";
import {
  PATTERN_LABELS,
  BAR_OPTIONS,
  OUTLINE_NUMERATOR_OPTIONS,
  OUTLINE_DENOMINATOR_OPTIONS,
  TRANSITION_LABELS,
  selectablePatterns,
} from "../src/render-drum-studio.js";
import { buildStudioHtml } from "../src/studio.js";

const r = await esbuild.build({
  entryPoints: ["src/webview/app.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
});

const patternOrder = selectablePatterns(PRESET_DATA);
const patterns: Record<string, unknown> = {};
for (const pattern of patternOrder) {
  patterns[pattern] = PRESET_DATA[pattern]!.variants.map((v) => ({
    lengthBeats: v.lengthBeats,
    beatsPerBar: v.beatsPerBar,
    notes: v.notes,
  }));
}

const html = buildStudioHtml(
  r.outputFiles[0]!.text,
  JSON.stringify(patterns),
  patternOrder,
  PATTERN_LABELS,
  BAR_OPTIONS,
  OUTLINE_NUMERATOR_OPTIONS,
  OUTLINE_DENOMINATOR_OPTIONS,
  TRANSITION_LABELS,
  Object.keys(TRANSITION_LABELS),
  { signatureNumerator: 4, signatureDenominator: 4 },
);
fs.writeFileSync(new URL("../../../.drum-studio-preview.html", import.meta.url).pathname, html);
console.log(`wrote preview: ${html.length} bytes, ${patternOrder.length} patterns`);
