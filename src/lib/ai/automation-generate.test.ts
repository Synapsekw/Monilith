import { describe, it, expect, vi } from "vitest";
import {
  buildAutomationGenSystemPrompt,
  generateAutomationDraft,
} from "@/lib/ai/automation-generate";
import { AUTOMATION_DRAFT_JSON_SCHEMA } from "@/lib/ai/automation-gen-schema";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import type { AutomationContext } from "@/lib/ai/automation-context";

const ctx: AutomationContext = {
  columns: [
    {
      id: "col-status",
      name: "Status",
      kind: "status",
      options: [{ id: "opt-done", label: "Done" }],
    },
  ],
  groups: [{ id: "grp-archive", name: "Archive" }],
  members: [{ id: "usr-1", name: "Ada" }],
};

const USAGE = { inputTokens: 10, outputTokens: 5 };

function fakeAdapter(draftJson: unknown) {
  const generateStructured = vi
    .fn()
    .mockResolvedValue({ data: draftJson, usage: USAGE });
  const adapter = { generateStructured } as unknown as ProviderAdapter;
  return { adapter, generateStructured };
}

describe("buildAutomationGenSystemPrompt", () => {
  it("teaches the trigger/action vocabulary and the ids-only contract", () => {
    const p = buildAutomationGenSystemPrompt();
    expect(p).toMatch(/status_changed/);
    expect(p).toMatch(/item_created/);
    expect(p).toMatch(/move_to_group/);
    expect(p).toMatch(/notify/);
    // Must instruct the model to reference only context ids and match by label.
    expect(p).toMatch(/ONLY ids|only ids/);
    expect(p).toMatch(/label/i);
    // call_webhook must NOT be taught (excluded in v1).
    expect(p).not.toMatch(/call_webhook|webhook/i);
  });
});

describe("generateAutomationDraft", () => {
  it("serializes the context into the user message and passes the draft schema", async () => {
    const { adapter, generateStructured } = fakeAdapter({
      trigger: { type: "item_created" },
      actions: [{ type: "move_to_group", groupId: "grp-archive" }],
    });

    const res = await generateAutomationDraft("archive new items", ctx, {
      adapter,
      apiKey: "k",
      model: "claude-sonnet-5",
    });

    const call = generateStructured.mock.calls[0][0];
    expect(call.schema).toBe(AUTOMATION_DRAFT_JSON_SCHEMA);
    expect(call.user).toContain("archive new items");
    expect(call.user).toContain("col-status");
    expect(call.user).toContain("grp-archive");
    expect(res.usage).toEqual(USAGE);
    expect(res.draft.trigger).toEqual({ type: "item_created" });
  });
});
