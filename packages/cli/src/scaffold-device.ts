/**
 * Scaffolds a new M4L device by copying `templates/m4l-device-basic/reference.amxd`,
 * patching the two places it references its own placeholder HTML page (the
 * `jweb` object's `url` attribute, and the `read file://...` message box
 * that triggers it on load), and writing the result to `devices/<name>/<name>.amxd`.
 *
 * There is no device-title field to patch anywhere in the patcher JSON — a
 * device's displayed name in Live comes from its filename, confirmed by
 * inspecting every top-level key of the reference file's parsed patcher
 * object (see git history / docs/m4l-scaffolding-risk.md).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseAmxd, serializeAmxd } from "./amxd.js";

interface PatcherBox {
  box: Record<string, unknown>;
}

interface PatcherRoot {
  patcher: {
    boxes: PatcherBox[];
  };
}

export interface ScaffoldDeviceOptions {
  targetDir: string;
  deviceName: string;
  referenceAmxdPath: string;
  /** Absolute path to the placeholder interface.html template to copy into the new device's ui/ folder. */
  referenceHtmlPath: string;
}

export function scaffoldDevice(options: ScaffoldDeviceOptions): void {
  const { targetDir, deviceName, referenceAmxdPath, referenceHtmlPath } = options;

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`Target directory ${targetDir} is not empty. Aborting.`);
  }

  const htmlTargetPath = path.join(targetDir, "ui", "interface.html");
  const newUrl = `file://${htmlTargetPath}`;

  const original = fs.readFileSync(referenceAmxdPath);
  const parsed = parseAmxd(original);
  const patcher = parsed.patcher as PatcherRoot;

  let patchedJweb = false;
  let patchedMessage = false;

  for (const { box } of patcher.patcher.boxes) {
    if (box.maxclass === "jweb") {
      box.url = newUrl;
      patchedJweb = true;
    } else if (box.maxclass === "message" && typeof box.text === "string" && box.text.startsWith("read file://")) {
      box.text = `read ${newUrl}`;
      patchedMessage = true;
    }
  }

  if (!patchedJweb || !patchedMessage) {
    throw new Error(
      `reference.amxd doesn't have the expected shape (jweb found: ${patchedJweb}, message box found: ${patchedMessage}) — ` +
        `was it modified since docs/m4l-scaffolding-risk.md was written? Re-verify before proceeding.`,
    );
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, `${deviceName}.amxd`), serializeAmxd(parsed));

  fs.mkdirSync(path.dirname(htmlTargetPath), { recursive: true });
  fs.copyFileSync(referenceHtmlPath, htmlTargetPath);
}
