import { describe, expect, it } from "vitest";
import { intelligenceInputHash } from "./input-hash";

describe("intelligenceInputHash", () => {
  const base = {
    itemCount: 3,
    maxUpdatedAt: "2026-09-11T10:00:00.000Z",
    signals: [{ kind: "overdue", count: 1 }],
  };
  it("is stable for equal input and 64 hex chars", () => {
    expect(intelligenceInputHash(base)).toBe(
      intelligenceInputHash({ ...base }),
    );
    expect(intelligenceInputHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes when the item count, the latest edit, or a signal count changes", () => {
    expect(intelligenceInputHash({ ...base, itemCount: 4 })).not.toBe(
      intelligenceInputHash(base),
    );
    expect(
      intelligenceInputHash({
        ...base,
        maxUpdatedAt: "2026-09-11T10:00:01.000Z",
      }),
    ).not.toBe(intelligenceInputHash(base));
    expect(
      intelligenceInputHash({
        ...base,
        signals: [{ kind: "overdue", count: 2 }],
      }),
    ).not.toBe(intelligenceInputHash(base));
  });
  it("ignores signal order", () => {
    const a = intelligenceInputHash({
      ...base,
      signals: [
        { kind: "overdue", count: 1 },
        { kind: "stalled", count: 2 },
      ],
    });
    const b = intelligenceInputHash({
      ...base,
      signals: [
        { kind: "stalled", count: 2 },
        { kind: "overdue", count: 1 },
      ],
    });
    expect(a).toBe(b);
  });
});
