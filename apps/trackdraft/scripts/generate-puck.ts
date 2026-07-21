#!/usr/bin/env tsx
/**
 * Thin wrapper that calls the shared @devkit/puck-engine compiler.
 *
 * Usage:
 *   npx tsx scripts/generate-puck.ts
 *   (wired into `predev` / `prebuild` scripts)
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runPuckASTCompiler } from "@devkit/puck-engine";

const __dirname = dirname(fileURLToPath(import.meta.url));

const count = runPuckASTCompiler({
  componentsDir: resolve(__dirname, "../src/components"),
  outputPath: resolve(__dirname, "../src/puck.generated.tsx"),
  importPrefix: "./components/",
});

console.log(`Wrote puck.generated.tsx (${count} components)`);
