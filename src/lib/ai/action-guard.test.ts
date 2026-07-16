import { describe, expect, it } from "vitest";
import { mapAiError } from "@/lib/ai/action-guard";
import {
  AiDisabledError,
  AiNotConfiguredError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  ProviderNotCapableError,
} from "@/lib/ai/errors";

describe("mapAiError", () => {
  describe("shared errors — identical copy regardless of opts", () => {
    it("maps AiDisabledError", () => {
      expect(mapAiError(new AiDisabledError())).toBe(
        "AI is turned off for your organization.",
      );
    });

    it("maps AiQuotaExceededError", () => {
      expect(mapAiError(new AiQuotaExceededError())).toBe(
        "You've used this month's AI allowance.",
      );
    });

    it("maps ByoKeyMissingError", () => {
      expect(mapAiError(new ByoKeyMissingError())).toBe(
        "Your organization's AI key is missing — ask an admin to update Settings.",
      );
    });

    it("ignores opts for AiDisabledError", () => {
      expect(
        mapAiError(new AiDisabledError(), {
          fallback: "custom fallback",
          notConfigured: "custom not configured",
          providerNotCapable: "custom provider not capable",
        }),
      ).toBe("AI is turned off for your organization.");
    });

    it("ignores opts for AiQuotaExceededError", () => {
      expect(
        mapAiError(new AiQuotaExceededError(), {
          fallback: "custom fallback",
          notConfigured: "custom not configured",
          providerNotCapable: "custom provider not capable",
        }),
      ).toBe("You've used this month's AI allowance.");
    });

    it("ignores opts for ByoKeyMissingError", () => {
      expect(
        mapAiError(new ByoKeyMissingError(), {
          fallback: "custom fallback",
          notConfigured: "custom not configured",
          providerNotCapable: "custom provider not capable",
        }),
      ).toBe(
        "Your organization's AI key is missing — ask an admin to update Settings.",
      );
    });
  });

  describe("AiNotConfiguredError — overridable", () => {
    it("uses the default (dashboard) copy when opts omitted", () => {
      expect(mapAiError(new AiNotConfiguredError())).toBe(
        "AI generation isn't configured.",
      );
    });

    it("uses opts.notConfigured when provided", () => {
      expect(
        mapAiError(new AiNotConfiguredError(), {
          notConfigured: "Add an AI provider key in Settings to use Ask AI.",
        }),
      ).toBe("Add an AI provider key in Settings to use Ask AI.");
    });
  });

  describe("ProviderNotCapableError — overridable", () => {
    it("uses the default generic copy when opts omitted", () => {
      expect(mapAiError(new ProviderNotCapableError("ask_pulse"))).toBe(
        "The configured AI provider can't run this feature.",
      );
    });

    it("uses opts.providerNotCapable when provided", () => {
      expect(
        mapAiError(new ProviderNotCapableError("ask_pulse"), {
          providerNotCapable:
            "Ask AI needs an Anthropic key — dashboards work with any provider.",
        }),
      ).toBe(
        "Ask AI needs an Anthropic key — dashboards work with any provider.",
      );
    });
  });

  describe("unknown errors — fallback", () => {
    it("uses the default fallback for a plain Error", () => {
      expect(mapAiError(new Error("boom"))).toBe(
        "AI generation failed. Please try again.",
      );
    });

    it("uses the default fallback for a non-error value", () => {
      expect(mapAiError("not an error")).toBe(
        "AI generation failed. Please try again.",
      );
    });

    it("uses opts.fallback when provided", () => {
      expect(
        mapAiError(new Error("boom"), {
          fallback: "The AI assistant hit a snag. Please try again.",
        }),
      ).toBe("The AI assistant hit a snag. Please try again.");
    });
  });
});
