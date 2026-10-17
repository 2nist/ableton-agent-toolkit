import { describe, expect, it } from "vitest";
import { askConfirm, getConfirmRequest, settleConfirm } from "./confirm";

describe("askConfirm", () => {
  it("exposes the pending request and resolves it", async () => {
    const answer = askConfirm({ message: "Delete this?", danger: true });
    expect(getConfirmRequest()?.message).toBe("Delete this?");
    expect(getConfirmRequest()?.danger).toBe(true);
    settleConfirm(true);
    await expect(answer).resolves.toBe(true);
    expect(getConfirmRequest()).toBeNull();
  });

  it("supersedes an earlier prompt instead of stacking", async () => {
    const first = askConfirm({ message: "first" });
    const second = askConfirm({ message: "second" });
    expect(getConfirmRequest()?.message).toBe("second");
    settleConfirm(false);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
  });

  it("ignores a settle when nothing is pending", () => {
    expect(() => settleConfirm(true)).not.toThrow();
  });
});
