import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NON_STORAGE_NAMES, STORAGE_KEYS } from "./keys";

const SRC = join(process.cwd(), "src");
const REGISTRY = join(SRC, "lib/persistence/keys.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

/** `"trackdraft-…"` literals, excluding comments and the registry itself. */
function literalsIn(path: string): string[] {
  const source = readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");
  return [...source.matchAll(/"trackdraft-[a-z0-9-]*"/g)].map((match) => match[0].slice(1, -1));
}

describe("persistence keys — one registry", () => {
  it("has no duplicate key strings", () => {
    const keys = Object.values(STORAGE_KEYS).map((spec) => spec.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares a scope and an owner for every key", () => {
    for (const [name, spec] of Object.entries(STORAGE_KEYS)) {
      expect(spec.scope, `${name} scope`).toMatch(/^(song|device|ui|lab)$/);
      expect(spec.owner, `${name} owner`).not.toBe("");
    }
  });

  it("is the only place a storage key string is written", () => {
    // Only channel/db/window/format names may appear outside the registry —
    // a storage key must be imported, never re-typed.
    const allowed = new Set<string>(NON_STORAGE_NAMES);

    const strays: string[] = [];
    for (const path of walk(SRC)) {
      if (path === REGISTRY || /\.test\.tsx?$/.test(path)) continue;
      for (const literal of literalsIn(path)) {
        if (!allowed.has(literal)) strays.push(`${relative(SRC, path)}: ${literal}`);
      }
    }

    // A new key must be added to the registry (with a scope) before it can be
    // written — that is the whole point of the table.
    expect(strays).toEqual([]);
  });
});
