/**
 * Renders `templates/extension-basic/templates/*.ejs` — copied byte-for-byte
 * from the vendored `ableton-create-extension` tarball — into a target
 * directory, then applies a platform overlay (workspace package deps, test
 * script). Pure, non-interactive, and independently testable: the official
 * tool's own `scaffold()` function is only reachable through its interactive
 * `prompts()` CLI, so this is a fresh implementation against the same
 * templates rather than a wrapper around theirs.
 *
 * Deliberately deviates from the stock tool in one way: vendor tarballs are
 * referenced via a shared `vendorRelativePath` (default `../../vendor`, this
 * repo's one shared copy) instead of being duplicated into every extension's
 * own `vendor/` folder — appropriate for a monorepo, not appropriate to
 * silently change if this logic is ever extracted for standalone use.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import ejs from "ejs";

export interface ScaffoldExtensionOptions {
  targetDir: string;
  extensionName: string;
  author: string;
  extensionHostPath: string;
  needsUI: boolean;
  /** Absolute path to templates/extension-basic/templates. */
  templatesDir: string;
  apiVersion?: string;
  vendorRelativePath?: string;
}

function sanitizePackageName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function scaffoldExtension(options: ScaffoldExtensionOptions): void {
  const {
    targetDir,
    extensionName,
    author,
    extensionHostPath,
    needsUI,
    templatesDir,
    apiVersion = "1.0.0",
    vendorRelativePath = "../../vendor",
  } = options;

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`Target directory ${targetDir} is not empty. Aborting.`);
  }

  const data = {
    author,
    entryPoint: "dist/extension.js",
    extensionHostPath,
    extensionName: sanitizePackageName(extensionName),
    needsUI,
    sdkDependency: `file:${vendorRelativePath}/ableton-extensions-sdk-1.0.0-beta.0.tgz`,
    cliDependency: `file:${vendorRelativePath}/ableton-extensions-cli-1.0.0-beta.0.tgz`,
    apiVersion,
  };

  const out = (rel: string) => path.join(targetDir, rel);
  const renderTpl = (from: string, to: string) => {
    const rendered = ejs.render(fs.readFileSync(path.join(templatesDir, from), "utf8"), data);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, rendered);
  };
  const copyFile = (from: string, to: string) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(templatesDir, from), to);
  };

  fs.mkdirSync(targetDir, { recursive: true });
  copyFile("gitignore", out(".gitignore"));
  renderTpl("env.ejs", out(".env"));
  renderTpl("README.md.ejs", out("README.md"));
  renderTpl("manifest.json.ejs", out("manifest.json"));
  renderTpl("package.json.ejs", out("package.json"));
  renderTpl("build.ts.ejs", out("build.ts"));
  renderTpl("tsconfig.json.ejs", out("tsconfig.json"));
  renderTpl("src/extension.ts.ejs", out("src/extension.ts"));
  copyFile(".vscode/launch.json", out(".vscode/launch.json"));
  copyFile(".vscode/tasks.json", out(".vscode/tasks.json"));
  if (needsUI) {
    copyFile("src/html.d.ts", out("src/html.d.ts"));
    copyFile("ui/interface.html", out("ui/interface.html"));
    renderTpl("vite.config.ts.ejs", out("vite.config.ts"));
  }

  applyPlatformOverlay(out("package.json"));
}

/**
 * Adds the platform's shared packages and a test script on top of the
 * stock-generated package.json. Kept as a small, separate, visible step —
 * not folded into the EJS templates themselves — so it's obvious this is
 * platform-specific, not part of Ableton's own official template.
 */
function applyPlatformOverlay(packageJsonPath: string): void {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  pkg.dependencies = { ...pkg.dependencies, "@music-theory/core": "0.1.0" };
  pkg.devDependencies = {
    ...pkg.devDependencies,
    "@platform/ui-kit": "0.0.0",
    "@platform/test-harness": "0.0.0",
    vitest: "^3.0.0",
  };
  pkg.scripts = { ...pkg.scripts, test: "vitest run", typecheck: "tsc --noEmit" };

  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
}
