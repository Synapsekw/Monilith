import { beforeEach, describe, expect, it, vi } from "vitest";

const getMyMono = vi.fn();
vi.mock("./queries", () => ({
  getMyMono: (...a: unknown[]) => getMyMono(...a),
}));
const forgetMonoSession = vi.fn();
vi.mock("@/lib/mono/session", () => ({
  forgetMonoSession: (id: string) => forgetMonoSession(id),
}));

import { monoSystemLines, resolveMonoTurn } from "./turn";
import { assistantDescriptors } from "@/lib/assistant/catalog";

const mono = (over: object = {}) => ({
  userId: "m1",
  orgId: "o1",
  ownerId: "u1",
  name: "Nova",
  color: "#7395ff",
  brain: "key",
  keyProvider: "anthropic",
  lastSeenAt: null,
  createdAt: "t",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("resolveMonoTurn", () => {
  it("returns the owner's awake Mono and its key provider", async () => {
    getMyMono.mockResolvedValue(mono());
    expect(await resolveMonoTurn({} as never, "u1", "o1", "m1")).toEqual({
      ok: true,
      turn: { mono: mono(), provider: "anthropic" },
    });
  });

  it("refuses a Mono that is not the caller's, and forgets its token", async () => {
    getMyMono.mockResolvedValue(mono({ userId: "m-other" }));
    expect(await resolveMonoTurn({} as never, "u1", "o1", "m1")).toEqual({
      ok: false,
      status: 403,
      error: "Not your Mono.",
    });
    expect(forgetMonoSession).toHaveBeenCalledWith("m1");
  });

  it("refuses an asleep Mono with a way to wake it", async () => {
    getMyMono.mockResolvedValue(mono({ brain: "none", keyProvider: null }));
    const r = await resolveMonoTurn({} as never, "u1", "o1", "m1");
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toContain("Settings → AI");
  });
});

describe("monoSystemLines", () => {
  it("names the Mono, its owner and its own identity", () => {
    const text = monoSystemLines(
      { name: "Nova", userId: "m1", ownerId: "u1" },
      "Ada",
    );
    expect(text).toContain('"Nova"');
    expect(text).toContain("user id m1");
    expect(text).toContain('"Ada"');
    expect(text).toContain("waits for");
    expect(text).toContain("cannot create boards");
  });

  // Review I3: on a Mono thread the tools run as the Mono, so "my work" tools
  // describe the Mono's assignments. The model must be told, and pointed at
  // the owner's id for the owner's own work.
  it("says the my-work tools answer for the Mono and how to read the owner's work", () => {
    const text = monoSystemLines(
      { name: "Nova", userId: "m1", ownerId: "u1" },
      "Ada",
    );
    const line = text.split("\n").find((l) => l.includes("get_focus_today"));
    expect(line).toBeDefined();
    expect(line).toContain("get_my_work");
    expect(line).toContain('assignee "me"');
    expect(line).toMatch(/your own|you, the Mono/);
    expect(line).toContain("query_items");
    expect(line).toContain('assignee "u1"');
    // Every tool the line names must exist exactly in the assistant catalog.
    const names = new Set(assistantDescriptors().map((d) => d.name));
    for (const tool of ["get_focus_today", "get_my_work", "query_items"])
      expect(names.has(tool)).toBe(true);
  });
});
