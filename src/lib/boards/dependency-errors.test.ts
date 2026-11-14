import { describe, expect, it } from "vitest";
import { dependencyErrorMessage } from "@/lib/boards/dependency-errors";

// Real raise texts + errcodes from
// supabase/migrations/20261113190536_cross_board_dependencies.sql.
describe("dependencyErrorMessage", () => {
  it.each([
    [
      { code: "42501", message: "no edit access to this board" },
      "You can't edit the board that item is on.",
    ],
    [
      { code: "42501", message: "not authenticated" },
      "You can't edit the board that item is on.",
    ],
    [
      { code: "P0001", message: "this would create a dependency cycle" },
      "That would create a dependency loop.",
    ],
    [
      { code: "P0001", message: "an item cannot depend on itself" },
      "An item can't depend on itself.",
    ],
    [
      { code: "P0002", message: "successor not found" },
      "That item is no longer available.",
    ],
    [
      { code: "P0002", message: "predecessor not found" },
      "That item is no longer available.",
    ],
    [
      {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
      "Those items are already linked.",
    ],
    [{ code: "XX000", message: "boom" }, "Couldn't add the dependency."],
    [null, "Couldn't add the dependency."],
  ])("maps %j", (error, expected) => {
    expect(dependencyErrorMessage(error)).toBe(expected);
  });
});
