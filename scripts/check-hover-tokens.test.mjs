import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { findOpaqueHoverStates } from "./check-hover-tokens.mjs";

describe("findOpaqueHoverStates", () => {
  it("flags opaque tokens used as an interaction state", () => {
    const hits = findOpaqueHoverStates([
      { path: "a.tsx", source: '<div className="hover:bg-accent p-2" />' },
    ]);
    assert.deepEqual(hits, [
      { path: "a.tsx", line: 1, klass: "hover:bg-accent" },
    ]);
  });

  it("ignores the same tokens used as a resting fill", () => {
    assert.deepEqual(
      findOpaqueHoverStates([
        { path: "b.tsx", source: '<span className="bg-accent rounded" />' },
      ]),
      [],
    );
  });

  it("catches focus, active and data-state prefixes too", () => {
    const hits = findOpaqueHoverStates([
      {
        path: "c.tsx",
        source:
          "focus:bg-muted\nactive:bg-secondary\ndata-[state=open]:bg-accent",
      },
    ]);
    assert.deepEqual(
      hits.map((h) => h.line),
      [1, 2, 3],
    );
  });

  it("reports the correct line number in a multi-line file", () => {
    const hits = findOpaqueHoverStates([
      {
        path: "d.tsx",
        source: "one\ntwo\n<div className='hover:bg-accent' />",
      },
    ]);
    assert.deepEqual(hits, [
      { path: "d.tsx", line: 3, klass: "hover:bg-accent" },
    ]);
  });
});
