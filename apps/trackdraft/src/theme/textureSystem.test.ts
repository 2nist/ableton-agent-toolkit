import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_CSS = readFileSync(resolve(__dirname, "themes.css"), "utf8");
const PROTOTYPE = readFileSync(resolve(__dirname, "../../../../docs/design/prototypes/sketchbook-theme.html"), "utf8");

describe("Studio Log transparent material textures", () => {
  it("uses the prototype-strength grain asset", () => {
    const app = APP_CSS.match(/--paper-grain:.*?opacity='\.(\d+)'/);
    const mock = PROTOTYPE.match(/--grain:.*?opacity='\.(\d+)'/);
    expect(app?.[1]).toBe("5");
    expect(mock?.[1]).toBe("5");
  });

  it("provides a transparent pencil layer for colored surfaces", () => {
    expect(APP_CSS).toContain("--pencil-hatch: repeating-linear-gradient");
    expect(APP_CSS).toMatch(/\[data-theme="logsheet"\] \.pencil-fill \{\s*background-image: var\(--pencil-hatch\);/);
  });

  it("keeps the played-cell hatch at prototype strength", () => {
    expect(APP_CSS).toContain("rgba(0, 0, 0, 0.26) 0 1.2px");
    expect(APP_CSS).toContain("transparent 1.2px 3.8px");
  });
});
