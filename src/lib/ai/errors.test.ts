import { describe, expect, it } from "vitest";
import {
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
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
  });
});
