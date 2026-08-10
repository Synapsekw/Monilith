import { describe, expect, it } from "vitest";
import { toProviderRow } from "@/lib/ai/providers/provider-rows";

describe("toProviderRow", () => {
  it("maps a native provider row and leaves baseUrl null", () => {
    expect(
      toProviderRow({
        id: "anthropic",
        label: "Anthropic (Claude)",
        adapter_kind: "anthropic",
        base_url: null,
        key_placeholder: "sk-ant-…",
        key_format: "^sk-ant-",
        enabled: true,
      }),
    ).toEqual({
      id: "anthropic",
      label: "Anthropic (Claude)",
      adapterKind: "anthropic",
      baseUrl: null,
      keyPlaceholder: "sk-ant-…",
      keyFormat: "^sk-ant-",
      enabled: true,
    });
  });

  it("carries base_url through for an openai-compatible provider", () => {
    const row = toProviderRow({
      id: "moonshotai",
      label: "Kimi (Moonshot AI)",
      adapter_kind: "openai-compatible",
      base_url: "https://api.moonshot.ai/v1",
      key_placeholder: "sk-…",
      key_format: "^sk-",
      enabled: true,
    });
    expect(row.adapterKind).toBe("openai-compatible");
    expect(row.baseUrl).toBe("https://api.moonshot.ai/v1");
  });

  it("rejects an unknown adapter_kind rather than widening it", () => {
    expect(() =>
      toProviderRow({
        id: "rogue",
        label: "Rogue",
        adapter_kind: "telepathy",
        base_url: null,
        key_placeholder: "x",
        key_format: "^x",
        enabled: true,
      }),
    ).toThrow(/adapter_kind/);
  });
});
