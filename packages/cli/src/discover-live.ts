/**
 * Finds local Ableton Live installations that support Extensions, mirroring
 * the discovery logic read directly out of the vendored
 * `ableton-create-extension` tarball's `dist/bin.mjs` (MacEnvironmentDiscoverer
 * / WindowsEnvironmentDiscoverer) — same signal (presence of
 * ExtensionHostNodeModule.node), reimplemented here as a pure, non-interactive
 * function rather than something buried inside an interactive `prompts()` flow.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const NODE_MODULE_FILE = "ExtensionHostNodeModule.node";

export interface LiveInstallation {
  /** Path to the .app bundle (macOS) or install root (Windows). */
  path: string;
  /** Path to the Extension Host's native module — this is what EXTENSION_HOST_PATH points at. */
  hostModulePath: string;
  displayName: string;
}

function fromMacAppPath(appPath: string): LiveInstallation | null {
  if (!appPath.endsWith(".app")) return null;
  const candidate = path.join(appPath, "Contents", "Helpers", "ExtensionHost", NODE_MODULE_FILE);
  return fs.existsSync(candidate) ? { path: appPath, hostModulePath: candidate, displayName: path.basename(appPath) } : null;
}

function readDirOrEmpty(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export function findMacLiveInstallations(appsDir = "/Applications"): LiveInstallation[] {
  return readDirOrEmpty(appsDir)
    .filter((entry) => entry.startsWith("Ableton Live") && entry.endsWith(".app"))
    .map((entry) => fromMacAppPath(path.join(appsDir, entry)))
    .filter((install): install is LiveInstallation => install !== null)
    .sort((a, b) => b.path.localeCompare(a.path));
}

/**
 * Windows discovery, mirroring the official tool's own WindowsEnvironmentDiscoverer.
 * UNVERIFIED on this machine (macOS-only development so far) — flagged here
 * rather than silently presented as tested.
 */
export function findWindowsLiveInstallations(abletonDir = "C:\\ProgramData\\Ableton"): LiveInstallation[] {
  const found: LiveInstallation[] = [];
  const editions = readDirOrEmpty(abletonDir).filter((d) => d.startsWith("Live "));
  for (const edition of editions) {
    const programDir = path.join(abletonDir, edition, "Program");
    for (const file of readDirOrEmpty(programDir)) {
      if (!file.startsWith("Ableton Live") || !file.endsWith(".exe")) continue;
      const candidate = path.join(programDir, "ExtensionHost", NODE_MODULE_FILE);
      if (fs.existsSync(candidate)) {
        found.push({ path: path.join(programDir, file), hostModulePath: candidate, displayName: file });
      }
    }
  }
  return found.sort((a, b) => b.path.localeCompare(a.path));
}

export function discoverLiveInstallations(platform: NodeJS.Platform = process.platform): LiveInstallation[] {
  if (platform === "darwin") return findMacLiveInstallations();
  if (platform === "win32") return findWindowsLiveInstallations();
  return [];
}
