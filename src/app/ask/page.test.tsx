import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/folders/queries", () => ({ getFolderHead: vi.fn() }));
vi.mock("@/components/ai/ask/AskChat", () => ({ AskChat: () => null }));

import NewAskPage from "./page";

async function autoSendFor(start: string | string[] | undefined) {
  const el = (await NewAskPage({
    searchParams: Promise.resolve({ start }),
  })) as ReactElement<{ autoSend?: string }>;
  return el.props.autoSend;
}

describe("/ask ?start", () => {
  it("turns a known key into the fixed message", async () => {
    expect(await autoSendFor("today")).toBe("What should I focus on today?");
  });

  it.each(["unknown", "", "__proto__", "constructor", "toString"])(
    "ignores %j",
    async (key) => {
      expect(await autoSendFor(key)).toBeUndefined();
    },
  );

  it("passes nothing when there is no start param", async () => {
    expect(await autoSendFor(undefined)).toBeUndefined();
  });
});
