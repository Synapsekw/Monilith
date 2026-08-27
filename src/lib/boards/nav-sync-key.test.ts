import { describe, expect, it } from "vitest";
import { navSyncKey } from "./nav-sync-key";

const alpha = {
  id: "b1",
  name: "Alpha",
  position: 0,
  shared_out: false,
};
const beta = {
  id: "b2",
  name: "Beta",
  position: 1,
  shared_out: false,
};

describe("navSyncKey", () => {
  it("is equal for content-identical lists with different array identities", () => {
    // This is the whole point: `boards.filter(...)` upstream allocates a fresh
    // array on every render with byte-identical contents. An identity check
    // reads that as "the server sent a new list" and clobbers the optimistic
    // reorder the user just performed.
    const boards = [alpha, beta];
    expect(navSyncKey([...boards])).toBe(navSyncKey(boards));
  });

  it("is equal even when the board objects themselves are re-allocated", () => {
    expect(navSyncKey([{ ...alpha }, { ...beta }])).toBe(
      navSyncKey([alpha, beta]),
    );
  });

  it("differs when the order differs", () => {
    expect(navSyncKey([beta, alpha])).not.toBe(navSyncKey([alpha, beta]));
  });

  it("differs when a board is added or removed", () => {
    expect(navSyncKey([alpha])).not.toBe(navSyncKey([alpha, beta]));
    expect(navSyncKey([])).not.toBe(navSyncKey([alpha]));
  });

  // Each field individually — a key that ignores one of these strands that
  // field's server-side change in the stale optimistic state, which is the same
  // class of bug this helper exists to fix.
  it("differs when an id changes", () => {
    expect(navSyncKey([{ ...alpha, id: "b9" }])).not.toBe(navSyncKey([alpha]));
  });

  it("differs when a position changes", () => {
    expect(navSyncKey([{ ...alpha, position: 5 }])).not.toBe(
      navSyncKey([alpha]),
    );
  });

  it("differs when a name changes", () => {
    // A rename revalidates the shell. Ignoring `name` here would leave the
    // sidebar showing the OLD name until the next full reload.
    expect(navSyncKey([{ ...alpha, name: "Renamed" }])).not.toBe(
      navSyncKey([alpha]),
    );
  });

  it("differs when shared_out flips", () => {
    // `shared_out` renders the Users2 marker on the row, so it is display state
    // exactly like the name is.
    expect(navSyncKey([{ ...alpha, shared_out: true }])).not.toBe(
      navSyncKey([alpha]),
    );
  });

  it("cannot be spoofed by a name that contains the separators", () => {
    // Two boards whose names carry the field/record separators must not be able
    // to produce the same key as a differently-shaped list.
    const a = navSyncKey([{ ...alpha, name: "Ab2" }]);
    const b = navSyncKey([alpha, beta]);
    expect(a).not.toBe(b);
  });

  it("is stable for an empty list", () => {
    expect(navSyncKey([])).toBe(navSyncKey([]));
  });
});
