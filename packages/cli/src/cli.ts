#!/usr/bin/env node
/**
 * Non-interactive by design. The official `ableton-create-extension` tool is
 * interactive-only (`prompts()`, no answer flags) — which is actively hostile
 * to the platform's whole premise: an agent should be able to scaffold a new
 * tool without a human present to answer prompts. Everything here is a flag
 * with a sensible default instead.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverLiveInstallations } from "./discover-live.js";
import { getGitUserName } from "./git-user.js";
import { scaffoldExtension } from "./scaffold-extension.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Built location is packages/cli/dist/cli.js — three levels up is the repo root.
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

function printUsage(): void {
  console.log(`Usage:
  platform create extension <name> [--ui] [--author "Name"] [--live /path/to/Ableton\\ Live.app]
  platform create device <name>

Examples:
  platform create extension chord-editor --ui
  platform create device hexagon-progression`);
}

function parseFlags(argv: string[]): { author?: string; ui: boolean; live?: string } {
  const flags: { author?: string; ui: boolean; live?: string } = { ui: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ui") flags.ui = true;
    else if (arg === "--author") flags.author = argv[++i];
    else if (arg === "--live") flags.live = argv[++i];
  }
  return flags;
}

function resolveExtensionHostPath(liveFlag: string | undefined): string {
  if (liveFlag) {
    const candidate = path.join(liveFlag, "Contents", "Helpers", "ExtensionHost", "ExtensionHostNodeModule.node");
    if (!fs.existsSync(candidate)) {
      console.error(`No Extension Host found under ${liveFlag} — this Live installation likely doesn't support Extensions.`);
      process.exit(1);
    }
    return candidate;
  }

  const installs = discoverLiveInstallations();
  if (installs.length === 0) {
    console.error("No Ableton Live installation with Extensions support found in /Applications. Pass --live <path-to-.app> explicitly.");
    process.exit(1);
  }
  console.log(`Using Live install: ${installs[0]!.displayName}${installs.length > 1 ? ` (${installs.length} found, picked newest)` : ""}`);
  return installs[0]!.hostModulePath;
}

function createExtension(name: string, rest: string[]): void {
  const flags = parseFlags(rest);
  const author = flags.author ?? getGitUserName() ?? "Unknown";
  const extensionHostPath = resolveExtensionHostPath(flags.live);
  const targetDir = path.join(REPO_ROOT, "extensions", name);

  scaffoldExtension({
    targetDir,
    extensionName: name,
    author,
    extensionHostPath,
    needsUI: flags.ui,
    templatesDir: path.join(REPO_ROOT, "templates", "extension-basic", "templates"),
  });

  console.log(`\nCreated extensions/${name}.\n\n  cd extensions/${name}\n  npm install\n  npm start\n`);
}

function createDevice(name: string): void {
  const referencePatcher = path.join(REPO_ROOT, "templates", "m4l-device-basic", "reference.maxpat");
  if (!fs.existsSync(referencePatcher)) {
    console.error(
      `No reference.maxpat at templates/m4l-device-basic/reference.maxpat.\n\n` +
        `M4L device scaffolding needs a hand-authored reference patcher — it can't be generated from nothing.\n` +
        `See docs/m4l-scaffolding-risk.md for exactly what to build in Max and where to save it.\n` +
        `(This is Phase 5 in the project's plan — deliberately not yet done.)`,
    );
    process.exit(1);
  }
  // Copy/JSON-patch logic lands here once reference.maxpat exists — see docs/m4l-scaffolding-risk.md.
  console.error(`reference.maxpat exists, but 'create device' isn't wired up yet (Phase 5 in progress). Would have created devices/${name}.`);
  process.exit(1);
}

const [, , command, kind, name, ...rest] = process.argv;

if (command !== "create" || (kind !== "extension" && kind !== "device") || !name) {
  printUsage();
  process.exit(command || kind || name ? 1 : 0);
}

if (kind === "extension") createExtension(name, rest);
else createDevice(name);
