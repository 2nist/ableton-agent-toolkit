#!/usr/bin/env tsx
/**
 * Compiles the Puck component registry from an explicit allow-list.
 *
 * Scans the component tree for prop metadata, then keeps only the components
 * named in `src/puck.manifest.ts`. The scan is still needed (it reads real
 * TypeScript types), but it no longer decides *membership* — a component
 * nothing imports can no longer sneak into the sandbox registry.
 *
 * Usage:
 *   npx tsx scripts/generate-puck.ts
 *   (wired into `predev` / `prebuild` scripts)
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePuckConfig, scanComponentTree } from "@devkit/puck-engine";
import { PUCK_COMPONENTS } from "../src/puck.manifest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const componentsDir = resolve(__dirname, "../src/components");
const outputPath = resolve(__dirname, "../src/puck.generated.tsx");

const scanned = scanComponentTree({ componentsDir, outputPath });
const allowed = new Set<string>(PUCK_COMPONENTS);

const components = scanned.filter((component) => allowed.has(component.name));

const found = new Set(components.map((component) => component.name));
const missing = PUCK_COMPONENTS.filter((name) => !found.has(name));
if (missing.length > 0) {
  // A rename or a deletion would otherwise silently shrink the sandbox.
  throw new Error(
    `generate-puck: manifest names not found in src/components — ${missing.join(", ")}`,
  );
}

compilePuckConfig({ components, outputPath, importPrefix: "./components/" });
console.log(
  `Wrote puck.generated.tsx (${components.length} of ${scanned.length} scanned components)`,
);
