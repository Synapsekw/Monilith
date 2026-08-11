import { describe, expect, it } from "vitest";
import {
  AiDisabledError,
  AiNotConfiguredError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  NoUsableModelError,
  PersonalAiKeyMissingError,
  ProviderNotCapableError,
} from "@/lib/ai/errors";

describe("ai errors", () => {
  it("each error has a stable name for instanceof-free checks", () => {
    expect(new AiDisabledError().name).toBe("AiDisabledError");
    expect(new ByoKeyMissingError().name).toBe("ByoKeyMissingError");
    expect(new AiQuotaExceededError().name).toBe("AiQuotaExceededError");
    expect(new ProviderNotCapableError("ask_pulse").name).toBe(
      "ProviderNotCapableError",
    );
    expect(new NoUsableModelError("google").name).toBe("NoUsableModelError");
  });

  it("the key errors name the provider whose key is missing", () => {
    // The UI has to say WHICH key to add: an org keyed for Anthropic that
    // pinned an agent to Kimi is missing the Kimi key, not "the AI key".
    expect(new ByoKeyMissingError("moonshotai")).toMatchObject({
      provider: "moonshotai",
      message: "No organization API key for moonshotai.",
    });
    expect(new PersonalAiKeyMissingError("mistral")).toMatchObject({
      provider: "mistral",
      message: "No personal API key for mistral.",
    });
  });

  it("keeps the zero-argument form working for callers with no provider", () => {
    expect(new ByoKeyMissingError().message).toBe(
      "This organization's AI key is missing.",
    );
    expect(new PersonalAiKeyMissingError().provider).toBeUndefined();
  });

  it("NoUsableModelError says to add a key, never 'no models available'", () => {
    // A provider's ids are only verified by a live call with its key, so an
    // empty catalog is an add-a-key state, not a dead end.
    const e = new NoUsableModelError("google");
    expect(e.message).toBe(
      "No verified google models yet — add a key to see models.",
    );
    // Every existing `instanceof AiNotConfiguredError` catch still maps it.
    expect(e).toBeInstanceOf(AiNotConfiguredError);
  });
});
