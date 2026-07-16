import { describe, expect, it } from "vitest";
import { boardIdFromPath, LAST_BOARD_COOKIE } from "./last-board";

const B = "0b9e2a51-6f5c-4d7a-9c3e-8f1d2b4a6c0e";

describe("boardIdFromPath", () => {
  it("extracts the board id from a board path", () => {
    expect(boardIdFromPath(`/boards/${B}`)).toBe(B);
  });

  it("ignores sub-paths, non-board routes and non-uuid segments", () => {
    expect(boardIdFromPath(`/boards/${B}/settings`)).toBeNull();
    expect(boardIdFromPath("/boards")).toBeNull();
    expect(boardIdFromPath("/dashboards/" + B)).toBeNull();
    expect(boardIdFromPath("/boards/not-a-uuid")).toBeNull();
  });

  it("exports the cookie name", () => {
    expect(LAST_BOARD_COOKIE).toBe("pulse_last_board");
  });
});
