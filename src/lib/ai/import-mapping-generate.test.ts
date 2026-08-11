import { describe, expect, it, vi } from "vitest";
import {
  buildImportMappingSystemPrompt,
  generateImportMapping,
  type ImportMappingPayload,
} from "@/lib/ai/import-mapping-generate";
import { IMPORT_MAPPING_JSON_SCHEMA } from "@/lib/ai/import-mapping-schema";
import type { ProviderAdapter } from "@/lib/ai/providers/types";

const USAGE = { inputTokens: 12, outputTokens: 7 };

function fakeAdapter(data: unknown) {
  const generateStructured = vi.fn().mockResolvedValue({ data, usage: USAGE });
  const adapter = { generateStructured } as unknown as ProviderAdapter;
  return { adapter, generateStructured };
}

const payload: ImportMappingPayload = {
  columns: [
    { sourceIndex: 0, header: "Task", sampleValues: ["Ship it", "Fix bug"] },
    { sourceIndex: 1, header: "Stage", sampleValues: ["Done", "WIP"] },
  ],
  boardColumns: [{ id: "col-status", name: "Status", kind: "status" }],
};

describe("buildImportMappingSystemPrompt", () => {
  it("teaches the importable kinds, the role semantics, and the existing-column targeting rule", () => {
    const p = buildImportMappingSystemPrompt();
    expect(p).toMatch(/status/);
    expect(p).toMatch(/dropdown/);
    expect(p).toMatch(/role/i);
    expect(p).toMatch(/name/i);
    // Only map to an existing board column when confident.
    expect(p).toMatch(/targetColumnId/);
    expect(p).toMatch(/existing/i);
  });
});

describe("generateImportMapping", () => {
  it("serializes headers + samples + board columns into the user message and calls the schema", async () => {
    const { adapter, generateStructured } = fakeAdapter({
      suggestions: [
        { sourceIndex: 0, kind: "text", role: "name" },
        {
          sourceIndex: 1,
          kind: "status",
          role: "data",
          targetColumnId: "col-status",
        },
      ],
    });

    const res = await generateImportMapping(payload, {
      adapter,
      apiKey: "k",
      model: "claude-sonnet-5",
    });

    expect(res.suggestions).toHaveLength(2);
    expect(res.suggestions[1].targetColumnId).toBe("col-status");
    expect(res.usage).toEqual(USAGE);

    const call = generateStructured.mock.calls[0][0];
    expect(call.schema).toBe(IMPORT_MAPPING_JSON_SCHEMA);
    expect(call.apiKey).toBe("k");
    // Headers and sample values are serialized into the prompt.
    expect(call.user).toContain("Task");
    expect(call.user).toContain("Ship it");
    expect(call.user).toContain("Stage");
    expect(call.user).toContain("Status");
  });

  it("returns an empty suggestions array when the model returns none", async () => {
    const { adapter } = fakeAdapter({ suggestions: [] });
    const res = await generateImportMapping(payload, {
      adapter,
      apiKey: "k",
      model: "claude-sonnet-5",
    });
    expect(res.suggestions).toEqual([]);
  });

  it("tolerates a missing suggestions field", async () => {
    const { adapter } = fakeAdapter({});
    const res = await generateImportMapping(payload, {
      adapter,
      apiKey: "k",
      model: "claude-sonnet-5",
    });
    expect(res.suggestions).toEqual([]);
  });
});
