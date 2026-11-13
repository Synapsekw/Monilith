import { describe, expect, it } from "vitest";
import { brainLine, monoAccessibleLabel, ownerPossessive } from "./labels";

describe("mono labels", () => {
  it("names the owner by first name", () => {
    expect(ownerPossessive("Danijel Jovanovic")).toBe("Danijel's Mono");
    expect(ownerPossessive("  ")).toBe("A teammate's Mono");
    expect(ownerPossessive(null)).toBe("A teammate's Mono");
  });

  it("builds the accessible label", () => {
    expect(monoAccessibleLabel("Nova", "Mira Kovač")).toBe("Nova, Mira's Mono");
  });

  it("says the brain in plain words", () => {
    expect(brainLine("none", null)).toBe("Asleep");
    expect(brainLine("key", "anthropic")).toBe(
      "Runs on your Anthropic key. Chat with it here.",
    );
    expect(brainLine("key", "openai")).toBe(
      "Runs on your OpenAI key. Chat with it here.",
    );
    expect(brainLine("connected", null)).toBe(
      "Connected to your Claude or ChatGPT subscription",
    );
  });
});
