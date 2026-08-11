import { describe, expect, it } from "vitest";
import fixture from "@/lib/ai/models/feed-fixture.json";
import { parseFeed, tierFor } from "@/lib/ai/models/feed-parse";

const ENABLED = ["anthropic", "openai", "google", "mistral", "moonshotai"];

describe("tierFor", () => {
  it("bands by input price per Mtok", () => {
    expect(tierFor(0.1)).toBe("cheap");
    expect(tierFor(1)).toBe("cheap");
    expect(tierFor(3)).toBe("standard");
    expect(tierFor(5)).toBe("standard");
    expect(tierFor(15)).toBe("strong");
  });

  it("treats an unpriced model as standard rather than cheapest", () => {
    // A null price must never make a model look like the cheap default, or the
    // tier hint would route bulk features onto an unmetered model.
    expect(tierFor(null)).toBe("standard");
  });
});

describe("parseFeed", () => {
  const rows = parseFeed(fixture, ENABLED);

  /**
   * The `type !== "language"` filter, actually exercised.
   *
   * The only non-language entry in the fixture used to be `bfl/flux-2-pro`,
   * and `bfl` is not an enabled provider — so the PROVIDER filter dropped it
   * and deleting the type check broke nothing. `openai/gpt-image-1` and
   * `google/gemini-embedding-001` are both fully priced entries under
   * providers that ARE enabled: only the type check can keep them out. Without
   * it, image and embedding models enter every model picker in the product and
   * a "cheap" embedding model wins the bulk tier.
   */
  it("drops non-language models", () => {
    expect(rows.find((r) => r.model_id === "flux-2-pro")).toBeUndefined();
    expect(rows.find((r) => r.model_id === "gpt-image-1")).toBeUndefined();
    expect(
      rows.find((r) => r.model_id === "gemini-embedding-001"),
    ).toBeUndefined();
    // Stated positively too: every surviving row came from a chat model.
    expect(rows.length).toBeGreaterThan(0);
  });

  it("drops models from providers that are not enabled", () => {
    expect(
      parseFeed(fixture, ["anthropic"]).every(
        (r) => r.provider === "anthropic",
      ),
    ).toBe(true);
  });

  it("splits gateway_id into provider and model_id", () => {
    const sonnet = rows.find((r) => r.model_id === "claude-sonnet-5");
    expect(sonnet).toBeDefined();
    expect(sonnet!.provider).toBe("anthropic");
    expect(sonnet!.gateway_id).toBe("anthropic/claude-sonnet-5");
  });

  it("derives supports_tools from the tags array", () => {
    const sonnet = rows.find((r) => r.model_id === "claude-sonnet-5");
    expect(sonnet!.supports_tools).toBe(true);
  });

  it("converts per-token prices to per-Mtok", () => {
    // Kimi K2 ships input 0.00000057 $/token => 0.57 $/Mtok.
    const kimi = rows.find((r) => r.model_id === "kimi-k2");
    expect(kimi!.input_price_per_mtok).toBeCloseTo(0.57, 6);
    expect(kimi!.tier).toBe("cheap");
  });

  it("marks a model with no pricing as needs_pricing", () => {
    const unpriced = rows.find((r) => r.model_id === "unpriced-test-model");
    expect(unpriced!.status).toBe("needs_pricing");
    expect(unpriced!.input_price_per_mtok).toBeNull();
  });

  it("marks a model with only an input price as needs_pricing but still parses that price", () => {
    // Asymmetric pricing (one rate present, one absent) must quarantine the
    // row the same way full-absence does — a model can't be metered off half
    // a price pair — but the price that IS present should still come through.
    const feed = {
      data: [
        {
          id: "openai/input-only-test",
          owned_by: "openai",
          name: "Input Only Test",
          type: "language",
          tags: ["tool-use"],
          context_window: 8000,
          max_tokens: 4000,
          pricing: { input: "0.000001" },
        },
      ],
    };
    const [row] = parseFeed(feed, ENABLED);
    expect(row.status).toBe("needs_pricing");
    expect(row.input_price_per_mtok).toBeCloseTo(1, 6);
    expect(row.output_price_per_mtok).toBeNull();
  });

  it("marks a model with only an output price as needs_pricing but still parses that price", () => {
    const feed = {
      data: [
        {
          id: "openai/output-only-test",
          owned_by: "openai",
          name: "Output Only Test",
          type: "language",
          tags: ["tool-use"],
          context_window: 8000,
          max_tokens: 4000,
          pricing: { output: "0.000002" },
        },
      ],
    };
    const [row] = parseFeed(feed, ENABLED);
    expect(row.status).toBe("needs_pricing");
    expect(row.input_price_per_mtok).toBeNull();
    expect(row.output_price_per_mtok).toBeCloseTo(2, 6);
  });

  it("quarantines a negative price instead of letting it go active", () => {
    // A negative rate is malformed feed data, but `Number.isFinite(-1)` is
    // true — so without a non-negative check this became a fully `active` row
    // priced at -$1/Mtok. Downstream that is either a negative cost (a silent
    // quota refund) or, once resolveModel rejects the value, a silent $0 for
    // any model absent from the fallback floor. It belongs in quarantine.
    const feed = {
      data: [
        {
          id: "moonshotai/negative-price-test",
          owned_by: "moonshotai",
          name: "Negative Price Test",
          type: "language",
          tags: ["tool-use"],
          context_window: 8000,
          max_tokens: 4000,
          pricing: { input: "-0.000001", output: "0.000002" },
        },
      ],
    };
    const [row] = parseFeed(feed, ENABLED);
    expect(row.status).toBe("needs_pricing");
    expect(row.input_price_per_mtok).toBeNull();
    // An unpriced model must not read as "cheap" — it would win the bulk-tier
    // pick while billing nothing.
    expect(row.tier).toBe("standard");
    // The usable half of the pair still comes through, as with any other
    // asymmetric row.
    expect(row.output_price_per_mtok).toBeCloseTo(2, 6);
  });

  it("drops a negative cache price without quarantining the row", () => {
    const feed = {
      data: [
        {
          id: "moonshotai/negative-cache-test",
          owned_by: "moonshotai",
          name: "Negative Cache Test",
          type: "language",
          tags: ["tool-use"],
          context_window: 8000,
          max_tokens: 4000,
          pricing: {
            input: "0.000001",
            output: "0.000002",
            input_cache_read: "-0.0000001",
          },
        },
      ],
    };
    const [row] = parseFeed(feed, ENABLED);
    expect(row.status).toBe("active");
    expect(row.cache_read_price_per_mtok).toBeNull();
  });

  it("leaves cache prices null when the provider publishes none", () => {
    const mistral = rows.find((r) => r.provider === "mistral");
    expect(mistral).toBeDefined();
    expect(mistral!.cache_read_price_per_mtok).toBeNull();
  });

  it("converts cache prices to per-Mtok when the provider publishes them", () => {
    // Claude Sonnet 5 ships input_cache_read 0.0000002 $/token => 0.2 $/Mtok
    // and input_cache_write 0.0000025 $/token => 2.5 $/Mtok.
    const sonnet = rows.find((r) => r.model_id === "claude-sonnet-5");
    expect(sonnet!.cache_read_price_per_mtok).toBeCloseTo(0.2, 6);
    expect(sonnet!.cache_write_price_per_mtok).toBeCloseTo(2.5, 6);
  });

  it("leaves supports_tools false for a model with no tool-use tag", () => {
    // gpt-4o-mini-search-preview was added to the fixture specifically to keep
    // a no-tool-use shape in play; this asserts that's actually the case.
    const searchPreview = rows.find(
      (r) => r.model_id === "gpt-4o-mini-search-preview",
    );
    expect(searchPreview).toBeDefined();
    expect(searchPreview!.supports_tools).toBe(false);
  });

  describe.each([
    ["nope key", { nope: true }],
    ["null", null],
    ["undefined", undefined],
    ["string", "not-a-feed"],
    ["number", 42],
    ["array", []],
    ["data: null", { data: null }],
    ["data: not-an-array", { data: "not-an-array" }],
    [
      "data: mix of non-object/malformed entries",
      { data: [null, 42, "x", {}] },
    ],
  ])("malformed payload: %s", (_label, payload) => {
    it("returns an empty array instead of throwing", () => {
      // This guard is what stops a Gateway outage (or a shape change) from
      // retiring the whole catalog: the caller treats [] as "skip the
      // refresh," so parseFeed must never throw regardless of input shape.
      expect(() => parseFeed(payload, ENABLED)).not.toThrow();
      expect(parseFeed(payload, ENABLED)).toEqual([]);
    });
  });

  /**
   * The property the all-malformed cases above CANNOT show (finding F2).
   *
   * An array where every entry is junk parses to `[]` whether entries are
   * skipped individually or the whole array is abandoned at the first bad one
   * — the two behaviours are indistinguishable. Only a MIXED batch tells them
   * apart, and the difference is severe: abandoning the array truncates the
   * catalog to whatever preceded the bad entry, and `refreshCatalog` then
   * treats every model after it as "not seen this run" and RETIRES it. One
   * malformed feed entry would empty most of the catalog.
   */
  it("keeps the well-formed entries around a malformed neighbour", () => {
    const good = (id: string) => ({
      id,
      owned_by: id.split("/")[0],
      name: id,
      type: "language",
      tags: ["tool-use"],
      context_window: 8000,
      max_tokens: 4000,
      pricing: { input: "0.000001", output: "0.000002" },
    });
    const rows = parseFeed(
      {
        data: [
          null,
          good("anthropic/first-survivor"),
          42,
          { id: 17 }, // right key, wrong type — fails the entry schema
          good("openai/middle-survivor"),
          "not-an-object",
          {}, // no id at all
          good("mistral/last-survivor"),
        ],
      },
      ENABLED,
    );
    expect(rows.map((r) => r.model_id)).toEqual([
      "first-survivor",
      "middle-survivor",
      "last-survivor",
    ]);
  });
});
