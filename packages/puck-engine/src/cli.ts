#!/usr/bin/env node
import { runPuckASTCompiler } from "./compiler.js";
import { resolve } from "node:path";

// Parse --scan and --out from argv
const args = process.argv.slice(2);
let componentsDir: string | undefined;
let outputPath: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--scan=")) {
    componentsDir = resolve(process.cwd(), args[i].slice("--scan=".length));
  } else if (args[i] === "--scan" && i + 1 < args.length) {
    componentsDir = resolve(process.cwd(), args[++i]);
  } else if (args[i].startsWith("--out=")) {
    outputPath = resolve(process.cwd(), args[i].slice("--out=".length));
  } else if (args[i] === "--out" && i + 1 < args.length) {
    outputPath = resolve(process.cwd(), args[++i]);
  }
}

if (!componentsDir || !outputPath) {
  console.error("Usage: puck-engine --scan=./src/components --out=./src/puck.generated.tsx");
  process.exit(1);
}

console.log(`Scanning ${componentsDir} → ${outputPath}`);
const count = runPuckASTCompiler({ componentsDir, outputPath });
console.log(`Done — ${count} components written to puck.generated.tsx`);