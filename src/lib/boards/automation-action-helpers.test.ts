import { describe, it, expect } from "vitest";
import { actionsContainWebhook } from "@/lib/boards/automation-action-helpers";

describe("actionsContainWebhook", () => {
  it("detects a webhook action", () => {
    expect(
      actionsContainWebhook([{ type: "call_webhook", url: "https://x" }]),
    ).toBe(true);
  });
  it("ignores non-webhook actions", () => {
    expect(
      actionsContainWebhook([{ type: "notify" }, { type: "set_option" }]),
    ).toBe(false);
  });
  it("handles non-array input safely", () => {
    expect(actionsContainWebhook(null)).toBe(false);
    expect(actionsContainWebhook("nope")).toBe(false);
  });
});
