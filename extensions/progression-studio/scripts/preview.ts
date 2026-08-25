/** Dev helper: write a standalone melody-mode preview HTML for browser QA. */
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import { gzipSync } from "node:zlib";
import { PRESET_PROGRESSIONS } from "@music-theory/core";
import { buildStudioHtml } from "../src/studio.js";

const engineData = new URL("../../../packages/progression-engine/data", import.meta.url).pathname;
const modelJson = fs.readFileSync(`${engineData}/transition_model.json`, "utf8");
const tensionJson = fs.readFileSync(`${engineData}/tension.json`, "utf8");
const songsB64 = gzipSync(fs.readFileSync(`${engineData}/song_sections.json`)).toString("base64");

const r = await esbuild.build({
  entryPoints: ["src/webview/app.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
});

const mode = (process.argv[2] as "studio" | "melody") || "melody";
const html = buildStudioHtml(r.outputFiles[0]!.text, modelJson, tensionJson, JSON.stringify(PRESET_PROGRESSIONS), mode, {
  rootNote: 9, // A
  scaleName: "Minor",
  scaleMode: true,
  signatureNumerator: 4,
  signatureDenominator: 4,
}, songsB64);
fs.writeFileSync(new URL("../../../.studio-preview.html", import.meta.url).pathname, html);
console.log(`wrote ${mode} preview: ${html.length} bytes (songs ${(songsB64.length / 1024).toFixed(1)}KB gz)`);
