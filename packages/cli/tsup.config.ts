import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
  },
  {
    // No `banner` here — src/cli.ts already has its own #!/usr/bin/env node
    // as its first line. Adding one via tsup's banner option doubled it,
    // producing an invalid second shebang line and a SyntaxError at
    // startup — caught by actually running the built CLI, not by any unit
    // test (unit tests import the modules directly, never exec dist/cli.js).
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    clean: false,
  },
]);
