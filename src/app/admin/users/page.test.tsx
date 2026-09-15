import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { searchUsers } = vi.hoisted(() => ({ searchUsers: vi.fn() }));

vi.mock("@/lib/platform/queries", () => ({
  searchUsers: (...args: unknown[]) => searchUsers(...args),
}));
// next/form needs the app router at runtime; a plain form is enough here.
vi.mock("next/form", () => ({
  default: ({ children, action }: { children: ReactNode; action: string }) => (
    <form action={action}>{children}</form>
  ),
}));
// Row actions are a client island wired to server actions — covered by their
// own tests; the page test only cares which rows land in which section.
vi.mock("@/components/admin/user-row-actions", () => ({
  UserRowActions: () => null,
}));

import AdminUsers from "./page";

type Kind = "all" | "people" | "system";
const user = (email: string) => ({
  id: `id-${email}`,
  email,
  bannedUntil: null,
  orgNames: [],
});
const people = Array.from({ length: 3 }, (_, i) =>
  user(`person-${i}@eand.com`),
);
const fixtures = Array.from({ length: 2 }, (_, i) =>
  user(`probe-${i}@example.com`),
);

/** Route each call by its account-kind argument. */
function stubSearch(byKind: Partial<Record<Kind, unknown[]>>) {
  searchUsers.mockImplementation(
    async (_q: string, _limit: number, _offset: number, kind: Kind = "all") =>
      byKind[kind] ?? [],
  );
}

async function renderPage(params: { q?: string; page?: string } = {}) {
  const ui = await AdminUsers({ searchParams: Promise.resolve(params) });
  return render(ui);
}

beforeEach(() => {
  searchUsers.mockReset();
});

describe("/admin/users", () => {
  it("paginates people and lists system/test accounts separately", async () => {
    stubSearch({ people, system: fixtures });
    await renderPage();

    // People come from the server-filtered "people" query, never from a
    // client-side split of a mixed page — so they cannot be buried by fixtures.
    const kinds = searchUsers.mock.calls.map((c) => c[3]);
    expect(kinds).toContain("people");
    expect(kinds).toContain("system");
    expect(kinds).not.toContain("all");

    for (const p of people) expect(screen.getByText(p.email)).toBeTruthy();
    for (const f of fixtures) expect(screen.getByText(f.email)).toBeTruthy();
    expect(screen.getByText("System & test accounts")).toBeTruthy();
    expect(screen.getByText(String(fixtures.length))).toBeTruthy();
    expect(screen.queryByText("No users yet.")).toBeNull();
  });

  it("passes the page offset only to the people query", async () => {
    stubSearch({ people, system: fixtures });
    await renderPage({ page: "2" });

    const peopleCall = searchUsers.mock.calls.find((c) => c[3] === "people");
    expect(peopleCall?.[2]).toBe(50); // page 2 × PAGE_SIZE 25
    // The collapsed section is a fixed, bounded list: it belongs to page 0.
    expect(searchUsers.mock.calls.some((c) => c[3] === "system")).toBe(false);
    expect(screen.queryByText("System & test accounts")).toBeNull();
  });

  it("still shows people on the first page when there are no fixtures", async () => {
    stubSearch({ people, system: [] });
    await renderPage();
    for (const p of people) expect(screen.getByText(p.email)).toBeTruthy();
    expect(screen.queryByText("System & test accounts")).toBeNull();
  });

  it("shows the empty state only when both lists are empty", async () => {
    stubSearch({ people: [], system: [] });
    await renderPage();
    expect(screen.getByText("No users yet.")).toBeTruthy();
  });

  it("does not show the empty state when only fixtures match", async () => {
    stubSearch({ people: [], system: fixtures });
    await renderPage({ q: "probe" });
    expect(screen.queryByText("No users match that search.")).toBeNull();
    expect(screen.getByText("System & test accounts")).toBeTruthy();
  });
});
