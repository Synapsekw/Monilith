import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { findPxText } from "./check-px-text.mjs";

describe("findPxText", () => {
  it("flags an arbitrary pixel text size", () => {
    assert.deepEqual(
      findPxText(
        [{ path: "a.tsx", source: '<p className="text-[13px]" />' }],
        [],
      ),
      [{ path: "a.tsx", line: 1, klass: "text-[13px]" }],
    );
  });

  it("accepts fractional pixel values", () => {
    const hits = findPxText([{ path: "b.tsx", source: "text-[13.5px]" }], []);
    assert.equal(hits[0].klass, "text-[13.5px]");
  });

  it("ignores rem-based arbitrary values — those are on the scale", () => {
    assert.deepEqual(
      findPxText([{ path: "c.tsx", source: "text-[0.6875rem]" }], []),
      [],
    );
  });

  it("ignores non-text arbitrary pixel utilities", () => {
    assert.deepEqual(
      findPxText([{ path: "d.tsx", source: "w-[13px] gap-[2px]" }], []),
      [],
    );
  });

  it("honours the allowlist by exact path", () => {
    assert.deepEqual(
      findPxText(
        [{ path: "src/components/brand/mark.tsx", source: "text-[46px]" }],
        ["src/components/brand/mark.tsx"],
      ),
      [],
    );
  });
});
