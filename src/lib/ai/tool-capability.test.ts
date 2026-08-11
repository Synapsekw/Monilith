import { describe, expect, it } from "vitest";
import {
  assertToolLoopCapable,
  TOOL_LOOP_PROVIDER,
} from "@/lib/ai/tool-capability";
import { ProviderNotCapableError } from "@/lib/ai/errors";

describe("assertToolLoopCapable", () => {
  it("permits anthropic", () => {
    expect(() => assertToolLoopCapable("anthropic", "ask_pulse")).not.toThrow();
  });

  it("rejects every other provider", () => {
    for (const p of ["openai", "google", "mistral", "moonshotai"]) {
      expect(() => assertToolLoopCapable(p, "ask_pulse")).toThrow(
        ProviderNotCapableError,
      );
    }
  });

  it("names the feature in the error, not the provider", () => {
    // The message is user-facing: "the configured provider can't run X" is
    // actionable, "moonshotai is not anthropic" is not.
    try {
      assertToolLoopCapable("openai", "thread_summary");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderNotCapableError);
      expect((e as ProviderNotCapableError).feature).toBe("thread_summary");
      expect((e as Error).message).toContain("thread_summary");
    }
  });

  it("names the single capable provider as a constant, not a literal", () => {
    // The loops construct `new Anthropic()` directly; when Spec 2 generalizes
    // them this constant is the one place that changes.
    expect(TOOL_LOOP_PROVIDER).toBe("anthropic");
  });
});
