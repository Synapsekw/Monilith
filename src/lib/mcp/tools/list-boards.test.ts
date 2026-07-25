import { describe, expect, it, vi } from "vitest";
import { listBoardsHandler } from "./list-boards";

describe("listBoardsHandler", () => {
  it("returns boards with org name, ordered by name", async () => {
    const client = {
      from: () => ({
        select: () => ({
          is: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    id: "b1",
                    name: "Roadmap",
                    org_id: "o1",
                    organizations: { name: "Acme" },
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    };
    const result = await listBoardsHandler(async () => client as never);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed).toEqual([
      { id: "b1", name: "Roadmap", orgId: "o1", orgName: "Acme" },
    ]);
  });
});
