#!/usr/bin/env node
/**
 * Regenerate the app icon.
 *
 *   node scripts/make-icon.cjs            # writes build/icon.png + build/icon.icns
 *
 * The mark is drawn as SVG and rasterised by the Electron we already depend
 * on, so the icon has no design-tool dependency and can be rebuilt from
 * source by anyone. `iconutil` then assembles the .icns macOS wants.
 *
 * Design: the four transport bars from the old Studio glyph, in amber on the
 * dark panel, over five faint staff lines — legible as "music" at 16px, where
 * the staff alone would turn to mush.
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SIZE = 1024;
// macOS grid: the artwork occupies ~81% of the canvas with the rest left as
// transparent padding, and the rounded-rect radius is ~22% of the tile.
const MARGIN = 96;
const TILE = SIZE - MARGIN * 2;
const RADIUS = Math.round(TILE * 0.2237);

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#231C16"/>
      <stop offset="1" stop-color="#14100D"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F0C063"/>
      <stop offset="1" stop-color="#D08F2C"/>
    </linearGradient>
  </defs>

  <rect x="${MARGIN}" y="${MARGIN}" width="${TILE}" height="${TILE}" rx="${RADIUS}" fill="url(#tile)"/>
  <rect x="${MARGIN + 1}" y="${MARGIN + 1}" width="${TILE - 2}" height="${TILE - 2}" rx="${RADIUS - 1}"
        fill="none" stroke="#F2E9DA" stroke-opacity="0.08" stroke-width="2"/>

  <!-- five staff lines, low contrast so they read as paper texture -->
  <g stroke="#F2E9DA" stroke-opacity="0.14" stroke-width="7" stroke-linecap="round">
    ${[0, 1, 2, 3, 4]
      .map((i) => {
        const y = 590 + i * 46;
        return `<line x1="${MARGIN + 120}" y1="${y}" x2="${SIZE - MARGIN - 120}" y2="${y}"/>`;
      })
      .join("\n    ")}
  </g>

  <!-- the transport bars -->
  <g fill="url(#bar)">
    <rect x="292" y="404" width="86" height="288" rx="43"/>
    <rect x="418" y="288" width="86" height="404" rx="43"/>
    <rect x="544" y="356" width="86" height="336" rx="43"/>
    <rect x="670" y="470" width="86" height="222" rx="43"/>
  </g>
</svg>`;

const HTML = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;width:${SIZE}px;height:${SIZE}px;overflow:hidden}</style>
${SVG}`;

app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(async () => {
  const buildDir = path.join(__dirname, "..", "build");
  fs.mkdirSync(buildDir, { recursive: true });

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: false },
  });

  await win.loadURL(`data:text/html;base64,${Buffer.from(HTML).toString("base64")}`);
  await new Promise((r) => setTimeout(r, 350));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const png = image.toPNG();
  const master = path.join(buildDir, "icon.png");
  fs.writeFileSync(master, png);
  console.log(`icon.png      ${SIZE}×${SIZE}  ${(png.length / 1024).toFixed(0)} KB`);

  // iconutil wants an .iconset with these exact names.
  const iconset = path.join(buildDir, "icon.iconset");
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = size * scale;
      const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`;
      execFileSync("sips", ["-z", String(px), String(px), master, "--out", path.join(iconset, name)], {
        stdio: "ignore",
      });
    }
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(buildDir, "icon.icns")]);
  fs.rmSync(iconset, { recursive: true, force: true });
  console.log("icon.icns     built");

  app.exit(0);
});
