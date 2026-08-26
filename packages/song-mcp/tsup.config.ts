import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  // Don't bundle @modelcontextprotocol/sdk — the MCP inspector needs it as an external
  external: ["@modelcontextprotocol/sdk"],
});