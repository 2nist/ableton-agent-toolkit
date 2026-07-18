import { describe, expect, it } from "vitest";
import { buildPickerHtml } from "../src/picker.js";

describe("buildPickerHtml", () => {
  it("embeds each song's id in the JSON data blob", () => {
    const html = buildPickerHtml([
      { id: "lalo-chezia-03_twin_fish", title: "Twin Fish" },
      { id: "lalo-chezia-01_static_bloom", title: "Static Bloom" },
    ]);
    expect(html).toContain("lalo-chezia-03_twin_fish");
    expect(html).toContain("lalo-chezia-01_static_bloom");
  });

  it("never contains a literal closing script tag, even if a title tries to inject one", () => {
    const html = buildPickerHtml([{ id: "x", title: "</script><script>alert(1)</script>" }]);
    expect(html).not.toContain("</script><script>alert(1)</script>");
    // The single legitimate closing tag for our own <script> block is fine.
    expect(html.match(/<\/script>/g)?.length).toBe(1);
  });

  it("shows a fallback message and no song list when there are no blueprints", () => {
    const html = buildPickerHtml([]);
    expect(html).toContain("No song blueprints found");
    expect(html).not.toContain('id="list"');
  });

  it("still renders the cancel button when there are no blueprints", () => {
    const html = buildPickerHtml([]);
    expect(html).toContain('id="cancel"');
  });
});
