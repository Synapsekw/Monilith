import { describe, expect, it, vi } from "vitest";
import { listOrganizationsHandler } from "./list-organizations";

function fakeClient(rows: unknown[], error: { message: string } | null = null) {
  return {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: rows, error }),
      }),
    }),
  };
}

describe("listOrganizationsHandler", () => {
  it("returns the user's orgs", async () => {
    const client = fakeClient([{ id: "o1", name: "Acme", timezone: "UTC" }]);
    const getClient = vi.fn(async () => client as never);
    const result = await listOrganizationsHandler(getClient);

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: "o1", name: "Acme", timezone: "UTC" },
    ]);
  });

  it("reports a read failure as a tool error", async () => {
    const client = fakeClient([], { message: "boom" });
    const result = await listOrganizationsHandler(async () => client as never);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });
});
