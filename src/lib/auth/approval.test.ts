import { beforeEach, describe, expect, it, vi } from "vitest";

// redirect() throws to halt, like the real next/navigation.
const { redirect, cacheTag, cacheLife, db } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  db: {
    rows: [] as { user_id: string; status: string }[],
    error: null as { message: string } | null,
    // When set, each read consumes the next scripted status (null = no row)
    // instead of looking at `rows`: lets a test give the cached read and the
    // live read different answers (the cache itself is not modelled here).
    script: null as (string | null)[] | null,
    calls: [] as {
      table: string;
      columns: string;
      filters: [string, unknown][];
    }[],
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
// cacheTag/cacheLife throw outside a compiled `use cache` scope under Vitest.
vi.mock("next/cache", () => ({
  cacheTag: (...a: unknown[]) => cacheTag(...a),
  cacheLife: (...a: unknown[]) => cacheLife(...a),
}));

/**
 * Filter-applying fake of the service client: records the table, the selected
 * columns and every `.eq()` filter, and resolves `.maybeSingle()` to the row
 * matching ALL recorded filters (or null). Dropping the `user_id` filter from
 * the implementation would hand back another account's row and fail the
 * scoping test below.
 */
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from(table: string) {
      const call = { table, columns: "", filters: [] as [string, unknown][] };
      db.calls.push(call);
      const q = {
        select(columns: string) {
          call.columns = columns;
          return q;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return q;
        },
        async maybeSingle() {
          if (db.error) return { data: null, error: db.error };
          if (db.script) {
            const next = db.script.shift() ?? null;
            if (next === "__error__")
              return { data: null, error: { message: "boom" } };
            return { data: next ? { status: next } : null, error: null };
          }
          const matches = db.rows.filter((r) =>
            call.filters.every(
              ([c, v]) => (r as Record<string, unknown>)[c] === v,
            ),
          );
          const row = call.filters.length > 0 ? (matches[0] ?? null) : null;
          return {
            data: row ? { status: row.status } : null,
            error: null,
          };
        },
      };
      return q;
    },
  }),
}));

import {
  approvalTag,
  enforceApproval,
  getAccountApproval,
  readAccountApproval,
  PENDING_APPROVAL_PATH,
} from "./approval";

beforeEach(() => {
  redirect.mockClear();
  cacheTag.mockClear();
  cacheLife.mockClear();
  db.rows = [];
  db.error = null;
  db.script = null;
  db.calls = [];
});

describe("approvalTag", () => {
  it("is scoped to the account", () => {
    expect(approvalTag("u1")).toBe("account-approval:u1");
  });
});

describe("getAccountApproval", () => {
  it.each(["approved", "pending", "rejected"] as const)(
    "returns %s for a row with that status",
    async (status) => {
      db.rows = [{ user_id: "u1", status }];
      expect(await getAccountApproval("u1")).toBe(status);
    },
  );

  it("treats a missing row as pending", async () => {
    expect(await getAccountApproval("u1")).toBe("pending");
  });

  it("reads account_approvals filtered on user_id", async () => {
    db.rows = [{ user_id: "u1", status: "approved" }];
    await getAccountApproval("u1");
    expect(db.calls).toEqual([
      {
        table: "account_approvals",
        columns: "status",
        filters: [["user_id", "u1"]],
      },
    ]);
  });

  it("never returns another account's status", async () => {
    db.rows = [{ user_id: "someone-else", status: "approved" }];
    expect(await getAccountApproval("u1")).toBe("pending");
  });

  it("tags the cache entry with the account's approval tag", async () => {
    db.rows = [{ user_id: "u1", status: "approved" }];
    await getAccountApproval("u1");
    expect(cacheTag).toHaveBeenCalledWith("account-approval:u1");
  });

  it("uses the guard cache profile", async () => {
    await getAccountApproval("u1");
    expect(cacheLife).toHaveBeenCalledWith("guard");
  });

  it("counts an unexpected status value as pending", async () => {
    db.rows = [{ user_id: "u1", status: "banana" }];
    expect(await getAccountApproval("u1")).toBe("pending");
  });

  it("throws on a read error instead of returning a status", async () => {
    db.rows = [{ user_id: "u1", status: "approved" }];
    db.error = { message: "connection refused" };
    await expect(getAccountApproval("u1")).rejects.toThrow(
      "Could not verify account approval.",
    );
  });
});

describe("readAccountApproval (live, uncached)", () => {
  it.each(["approved", "pending", "rejected"] as const)(
    "returns %s for a row with that status",
    async (status) => {
      db.rows = [{ user_id: "u1", status }];
      expect(await readAccountApproval("u1")).toBe(status);
    },
  );

  it("treats a missing row as pending", async () => {
    expect(await readAccountApproval("u1")).toBe("pending");
  });

  it("never returns another account's status", async () => {
    db.rows = [{ user_id: "someone-else", status: "approved" }];
    expect(await readAccountApproval("u1")).toBe("pending");
  });

  it("is not cached or tagged", async () => {
    await readAccountApproval("u1");
    expect(cacheTag).not.toHaveBeenCalled();
    expect(cacheLife).not.toHaveBeenCalled();
  });

  it("throws on a read error", async () => {
    db.error = { message: "connection refused" };
    await expect(readAccountApproval("u1")).rejects.toThrow(
      "Could not verify account approval.",
    );
  });
});

describe("enforceApproval", () => {
  it("is /pending-approval", () => {
    expect(PENDING_APPROVAL_PATH).toBe("/pending-approval");
  });

  it("does not redirect an approved account", async () => {
    db.rows = [{ user_id: "u1", status: "approved" }];
    await expect(enforceApproval({ id: "u1" })).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(["pending", "rejected"] as const)(
    "redirects a %s account to the waiting screen",
    async (status) => {
      db.rows = [{ user_id: "u1", status }];
      await expect(enforceApproval({ id: "u1" })).rejects.toThrow(
        "REDIRECT:/pending-approval",
      );
      expect(redirect).toHaveBeenCalledWith("/pending-approval");
    },
  );

  it("redirects an account with no row", async () => {
    await expect(enforceApproval({ id: "u1" })).rejects.toThrow(
      "REDIRECT:/pending-approval",
    );
  });

  it("lets a cached pending through when the live read says approved", async () => {
    db.script = ["pending", "approved"];
    await expect(enforceApproval({ id: "u1" })).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(2);
  });

  it("redirects when the cached and the live read are both pending", async () => {
    db.script = ["pending", "pending"];
    await expect(enforceApproval({ id: "u1" })).rejects.toThrow(
      "REDIRECT:/pending-approval",
    );
  });

  it("never makes the live read for a cached approved", async () => {
    db.script = ["approved"];
    await enforceApproval({ id: "u1" });
    expect(db.calls).toHaveLength(1);
  });

  it("propagates a failing live read and does not redirect", async () => {
    db.script = ["pending", "__error__"];
    await expect(enforceApproval({ id: "u1" })).rejects.toThrow(
      "Could not verify account approval.",
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it("propagates a read error and does not redirect", async () => {
    db.error = { message: "connection refused" };
    await expect(enforceApproval({ id: "u1" })).rejects.toThrow(
      "Could not verify account approval.",
    );
    expect(redirect).not.toHaveBeenCalled();
  });
});
