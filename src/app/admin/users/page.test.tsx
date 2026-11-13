import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { searchUsers, listPendingAccounts, countPendingAccounts } = vi.hoisted(
  () => ({
    countPendingAccounts: vi.fn(),
    searchUsers: vi.fn(),
    listPendingAccounts: vi.fn(),
  }),
);

vi.mock("@/lib/platform/queries", () => ({
  searchUsers: (...args: unknown[]) => searchUsers(...args),
  listPendingAccounts: (...args: unknown[]) => listPendingAccounts(...args),
  countPendingAccounts: () => countPendingAccounts(),
}));
// The pending section is a client island; its buttons are covered by
// pending-accounts.test.tsx. Here only the router and the wrappers are stubbed.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/platform/search-action", () => ({
  approveUserAction: vi.fn(),
  rejectUserAction: vi.fn(),
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
  approvalStatus: "approved",
  createdAt: "2026-11-12T09:30:00Z",
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
  listPendingAccounts.mockReset().mockResolvedValue([]);
  countPendingAccounts.mockReset().mockResolvedValue(0);
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

  it("keeps every existing query argument unchanged", async () => {
    stubSearch({ people, system: fixtures });
    await renderPage({ q: "ada" });
    expect(searchUsers.mock.calls).toEqual(
      expect.arrayContaining([
        ["ada", 26, 0, "people"],
        ["ada", 50, 0, "system"],
      ]),
    );
    expect(searchUsers).toHaveBeenCalledTimes(2);
  });
});

describe("/admin/users pending section", () => {
  const pending = (email: string) => ({
    ...user(email),
    approvalStatus: "pending" as const,
  });

  it("fetches one bounded pending list on page 0 and shows it above the people", async () => {
    stubSearch({ people, system: [] });
    // A fixture-looking address that is pending still needs a decision.
    listPendingAccounts.mockResolvedValue([
      pending("new@eand.com"),
      pending("probe-9@example.com"),
    ]);
    const { container } = await renderPage();

    expect(listPendingAccounts).toHaveBeenCalledTimes(1);
    expect(listPendingAccounts).toHaveBeenCalledWith(50);
    const heading = screen.getByRole("heading", {
      name: /waiting for approval/i,
    });
    expect(screen.getByText("probe-9@example.com")).toBeTruthy();
    // Above the people table in document order.
    const firstPerson = screen.getByText(people[0]!.email);
    expect(
      heading.compareDocumentPosition(firstPerson) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.textContent).toContain("Active");
  });

  it("passes the exact pending count so a capped list does not understate", async () => {
    stubSearch({ people, system: [] });
    listPendingAccounts.mockResolvedValue([pending("new@eand.com")]);
    countPendingAccounts.mockResolvedValue(73);
    await renderPage();
    expect(countPendingAccounts).toHaveBeenCalledTimes(1);
    expect(screen.getByText("73")).toBeTruthy();
    expect(screen.getByText("Showing the newest 1")).toBeTruthy();
  });

  it("renders no pending section when nobody is waiting", async () => {
    stubSearch({ people, system: [] });
    await renderPage();
    expect(screen.queryByText(/waiting for approval/i)).toBeNull();
  });

  it("does not fetch or show the pending list after page 0", async () => {
    stubSearch({ people, system: [] });
    listPendingAccounts.mockResolvedValue([pending("new@eand.com")]);
    await renderPage({ page: "1" });
    expect(listPendingAccounts).not.toHaveBeenCalled();
    expect(countPendingAccounts).not.toHaveBeenCalled();
    expect(screen.queryByText(/waiting for approval/i)).toBeNull();
  });

  it("labels undecided and rejected accounts in the status column", async () => {
    stubSearch({
      people: [
        pending("p@eand.com"),
        { ...user("r@eand.com"), approvalStatus: "rejected" },
        { ...user("b@eand.com"), bannedUntil: "2126-01-01T00:00:00Z" },
      ],
      system: [],
    });
    await renderPage({ page: "1" });
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Not approved")).toBeTruthy();
    expect(screen.getByText("Banned")).toBeTruthy();
  });
});
