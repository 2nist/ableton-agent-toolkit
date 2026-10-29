#!/usr/bin/env node
/**
 * Build a real `TrackDraft.app` for macOS.
 *
 * The renderer is a Vite bundle and the main process requires only `electron`
 * plus Node builtins, so the packaged app needs NO node_modules — which is what
 * makes this a ~50-line stage-and-package rather than a bundler configuration.
 * Staging a clean directory also keeps the workspace's symlinked packages
 * (`@music-theory/*`) and 437 MB of dev dependencies out of the bundle.
 *
 * Usage:
 *   node scripts/package-mac.mjs                 # x64 for this machine
 *   node scripts/package-mac.mjs --arch arm64    # Apple Silicon
 *   node scripts/package-mac.mjs --arch universal
 *
 * Prerequisite: `dist/` must exist. For a build with songs in it, run
 * `npm run electron:test-build` first (which also stamps the catalog pack).
 *
 * Signing is deliberately not done: an unsigned local build runs fine, but it
 * cannot be handed to another machine without notarisation. See
 * electron/README.md.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const APP_DIR = path.resolve(import.meta.dirname, "..");
const DIST = path.join(APP_DIR, "dist");
const STAGE = path.join(APP_DIR, "build", "electron-stage");
const OUT = path.join(APP_DIR, "release");

function arg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

function archForHost() {
  return process.arch === "arm64" ? "arm64" : "x64";
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

/** Newest mtime of any file under `dir` — the cheap staleness probe above. */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const time = entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs;
    if (time > newest) newest = time;
  }
  return newest;
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

const arch = arg("--arch", archForHost());
const sign = !process.argv.includes("--no-sign");
const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8"));
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(APP_DIR, "..", "..", "node_modules", "electron", "package.json"), "utf8"),
).version;

if (!fs.existsSync(DIST)) {
  console.error(`No dist/ at ${DIST}. Run "npm run build" (or "npm run electron:test-build") first.`);
  process.exit(1);
}

/*
 * A stale renderer is invisible — the .app launches, looks right, and quietly
 * runs last week's code. That bit us: `dist/` was 20 minutes behind `src/` and
 * the packaged app was still showing the old drums. Refuse to package source
 * newer than the bundle unless the caller means it.
 */
if (!process.argv.includes("--allow-stale")) {
  const newestSource = newestMtime(path.join(APP_DIR, "src"));
  const bundleTime = fs.statSync(path.join(DIST, "index.html")).mtimeMs;
  if (newestSource > bundleTime) {
    console.error(
      `dist/ is older than src/ (bundle ${new Date(bundleTime).toISOString()}, ` +
        `source ${new Date(newestSource).toISOString()}).\n` +
        `Run "npm run build" (or re-run with --allow-stale).`,
    );
    process.exit(1);
  }
}

/* What is actually inside dist/ shapes the first-run experience, so say it. */
const catalogDir = path.join(DIST, "catalog");
const catalogSongs = fs.existsSync(catalogDir)
  ? fs.readdirSync(catalogDir).filter((f) => f.endsWith(".trackdraft.json")).length
  : 0;
let distribution = "none";
if (catalogSongs > 0) {
  try {
    distribution = JSON.parse(fs.readFileSync(path.join(catalogDir, "MANIFEST.json"), "utf8")).distribution ?? "unknown";
  } catch {
    distribution = "unknown";
  }
}

console.log(`packaging TrackDraft ${pkg.version} (${arch}) with Electron ${electronVersion}`);
console.log(`  renderer : ${path.relative(APP_DIR, DIST)}`);
console.log(
  catalogSongs > 0
    ? `  catalogue: ${catalogSongs} song(s), distribution=${distribution}${distribution.startsWith("internal") ? "  ← NOT FOR DISTRIBUTION" : ""}`
    : "  catalogue: none (app starts empty)",
);

/* ── stage ─────────────────────────────────────────────────────────────── */
if (fs.existsSync(STAGE)) fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

fs.writeFileSync(
  path.join(STAGE, "package.json"),
  `${JSON.stringify(
    {
      name: "trackdraft",
      productName: "TrackDraft",
      version: pkg.version,
      description: "TrackDraft — song structure, harmony and lyric authoring",
      main: "electron/main.cjs",
      author: "TrackDraft",
      license: "UNLICENSED",
    },
    null,
    2,
  )}\n`,
);

fs.mkdirSync(path.join(STAGE, "electron"), { recursive: true });
// media.cjs is required by main — anything main `require`s has to be staged.
for (const file of ["main.cjs", "preload.cjs", "media.cjs", "smoke-probe.js"]) {
  fs.copyFileSync(path.join(APP_DIR, "electron", file), path.join(STAGE, "electron", file));
}
copyTree(DIST, path.join(STAGE, "dist"));

console.log(`  staged   : ${path.relative(APP_DIR, STAGE)} (${(dirSize(STAGE) / 1048576).toFixed(1)} MB)`);

/* ── package ───────────────────────────────────────────────────────────── */
fs.mkdirSync(OUT, { recursive: true });

const packagerArgs = [
  "--yes",
  "@electron/packager",
  STAGE,
  "TrackDraft",
  "--platform=darwin",
  `--arch=${arch}`,
  `--out=${OUT}`,
  "--overwrite",
  "--app-bundle-id=app.trackdraft.desktop",
  `--app-version=${pkg.version}`,
  `--electron-version=${electronVersion}`,
  "--ignore=.DS_Store",
];

console.log(`\n$ npx ${packagerArgs.join(" ")}\n`);
try {
  execFileSync("npx", packagerArgs, { stdio: "inherit", cwd: APP_DIR });
} catch {
  console.error("\nPackaging failed. The npx call above prints its own error.");
  process.exit(1);
}

const appBundle = path.join(OUT, `TrackDraft-darwin-${arch}`, "TrackDraft.app");
if (!fs.existsSync(appBundle)) {
  console.error(`Packaging reported success but ${appBundle} is missing.`);
  process.exit(1);
}

/* Icon. @electron/packager warns "could not find icon ….icon" and leaves the
 * default Electron artwork in place, so the .icns is installed here instead —
 * before signing, because rewriting Info.plist invalidates the signature. */
const iconPath = path.join(APP_DIR, "build", "icon.icns");
if (fs.existsSync(iconPath)) {
  const resources = path.join(appBundle, "Contents", "Resources");
  const plist = path.join(appBundle, "Contents", "Info.plist");
  fs.copyFileSync(iconPath, path.join(resources, "icon.icns"));
  for (const [key, value] of [["CFBundleIconFile", "icon.icns"], ["CFBundleIconName", "icon"]]) {
    try {
      execFileSync("/usr/libexec/PlistBuddy", ["-c", `Delete :${key}`, plist], { stdio: "ignore" });
    } catch {
      /* key wasn't there — Add handles it */
    }
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, plist]);
  }
  console.log("  icon    : build/icon.icns");
} else {
  console.log("  icon    : default Electron (run `npm run icon` to build one)");
}

/* Ad-hoc signing costs nothing and needs no certificate, but it is not
 * cosmetic: an arm64 macOS will refuse to launch an unsigned bundle at all,
 * and a signed one fails more gracefully (and can be transferred with the
 * quarantine flag cleared). This is NOT notarisation — Gatekeeper still
 * rejects the app on another machine; see electron/README.md. */
let signNote = "unsigned";
if (sign) {
  try {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appBundle], { stdio: "inherit" });
    signNote = "ad-hoc signed (not notarised)";
  } catch {
    signNote = "signing FAILED — see output above";
    console.warn("\nCould not ad-hoc sign the bundle; it will not launch on Apple Silicon.");
  }
}

const sizeMb = (dirSize(appBundle) / 1048576).toFixed(0);
console.log(`\n✓ ${path.relative(APP_DIR, appBundle)}  (${sizeMb} MB)`);
console.log(`  signing : ${signNote}`);
console.log(`  run:    open "apps/trackdraft/${path.relative(APP_DIR, appBundle)}"`);
console.log(
  `  smoke:  TRACKDRAFT_SMOKE=1 "apps/trackdraft/${path.relative(APP_DIR, appBundle)}/Contents/MacOS/TrackDraft"`,
);
if (signNote.startsWith("ad-hoc")) {
  console.log(
    "  moving it to another Mac needs the quarantine flag cleared (see electron/README.md);\n" +
      "  a different Apple Silicon Mac will refuse an unsigned copy outright.",
  );
}
if (distribution.startsWith("internal")) {
  console.log("\n!! This bundle contains the restricted test catalogue. Do not distribute it. !!");
}
