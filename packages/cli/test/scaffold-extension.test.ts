import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldExtension } from "../src/scaffold-extension.js";

// packages/cli/test -> repo root is 3 levels up. These tests render the
// REAL templates copied verbatim from the vendored ableton-create-extension
// tarball — not fixtures — so a change to those templates is caught here.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TEMPLATES_DIR = path.join(REPO_ROOT, "templates", "extension-basic", "templates");

let tmpDir: string;
let targetDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-scaffold-"));
  targetDir = path.join(tmpDir, "my-extension");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("scaffoldExtension — without UI", () => {
  beforeEach(() => {
    scaffoldExtension({
      targetDir,
      extensionName: "My Extension",
      author: "Test Author",
      extensionHostPath: "/fake/path/ExtensionHostNodeModule.node",
      needsUI: false,
      templatesDir: TEMPLATES_DIR,
    });
  });

  it("writes the baseline file set, and nothing UI-specific", () => {
    for (const f of [".gitignore", ".env", "README.md", "manifest.json", "package.json", "build.ts", "tsconfig.json", "src/extension.ts", ".vscode/launch.json", ".vscode/tasks.json"]) {
      expect(fs.existsSync(path.join(targetDir, f)), `expected ${f} to exist`).toBe(true);
    }
    for (const f of ["ui/interface.html", "vite.config.ts", "src/html.d.ts"]) {
      expect(fs.existsSync(path.join(targetDir, f)), `expected ${f} NOT to exist`).toBe(false);
    }
  });

  it("sanitizes the extension name into the npm package name AND Live's displayed manifest name — matching the official tool's own behavior exactly", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, "package.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, "manifest.json"), "utf8"));
    expect(pkg.name).toBe("my-extension");
    expect(manifest.name).toBe("my-extension"); // yes, sanitized here too — verified against the vendored tool's dist/bin.mjs
  });

  it("writes the given extensionHostPath into .env", () => {
    const env = fs.readFileSync(path.join(targetDir, ".env"), "utf8");
    expect(env).toContain("EXTENSION_HOST_PATH=/fake/path/ExtensionHostNodeModule.node");
  });

  it("points dependencies at the shared vendor directory by default", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, "package.json"), "utf8"));
    expect(pkg.dependencies["@ableton-extensions/sdk"]).toBe("file:../../vendor/ableton-extensions-sdk-1.0.0-beta.0.tgz");
  });

  it("applies the platform overlay: shared packages, test/typecheck scripts", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, "package.json"), "utf8"));
    expect(pkg.dependencies["@music-theory/core"]).toBe("0.1.0");
    expect(pkg.devDependencies["@platform/ui-kit"]).toBe("0.0.0");
    expect(pkg.devDependencies["@platform/test-harness"]).toBe("0.0.0");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.typecheck).toBe("tsc --noEmit");
    // Original stock scripts must survive the overlay, not be clobbered.
    expect(pkg.scripts.start).toBe("npm run build:dev && extensions-cli run");
  });

  it("does not use the modal-dialog variant of extension.ts", () => {
    const src = fs.readFileSync(path.join(targetDir, "src/extension.ts"), "utf8");
    expect(src).not.toContain("showModalDialog");
    expect(src).toContain("Hello from");
  });
});

describe("scaffoldExtension — with UI", () => {
  beforeEach(() => {
    scaffoldExtension({
      targetDir,
      extensionName: "My UI Extension",
      author: "Test Author",
      extensionHostPath: "/fake/path/ExtensionHostNodeModule.node",
      needsUI: true,
      templatesDir: TEMPLATES_DIR,
    });
  });

  it("additionally writes ui/interface.html, vite.config.ts, and src/html.d.ts", () => {
    for (const f of ["ui/interface.html", "vite.config.ts", "src/html.d.ts"]) {
      expect(fs.existsSync(path.join(targetDir, f))).toBe(true);
    }
  });

  it("uses the modal-dialog variant of extension.ts", () => {
    const src = fs.readFileSync(path.join(targetDir, "src/extension.ts"), "utf8");
    expect(src).toContain("showModalDialog");
    expect(src).toContain("bundledInterface");
  });

  it("adds vite as a devDependency", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, "package.json"), "utf8"));
    expect(pkg.devDependencies.vite).toBeDefined();
  });
});

describe("scaffoldExtension — safety", () => {
  it("refuses to scaffold into a non-empty directory", () => {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "existing-file.txt"), "hello");

    expect(() =>
      scaffoldExtension({
        targetDir,
        extensionName: "My Extension",
        author: "Test Author",
        extensionHostPath: "/fake/path",
        needsUI: false,
        templatesDir: TEMPLATES_DIR,
      }),
    ).toThrow(/not empty/);
  });
});
