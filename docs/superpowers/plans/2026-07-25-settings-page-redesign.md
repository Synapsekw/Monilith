# Settings Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eight-card masonry at `/settings` with a left sub-nav over nested routes, aligned label/control rows instead of a box per setting, and a real "Connect via MCP" setup guide.

**Architecture:** `src/app/(app)/settings/layout.tsx` owns the page header, the nav, and the three shared reads (user, active org, admin flag). Each section is its own route segment fetching only its own data, so `/settings/profile` costs one query instead of ten. Two new primitives — `SettingsSection` and `SettingRow` — carry the alignment contract; cards survive only for repeated objects (a connected app, a workspace). Section switching is a prefetched `<Link>` navigation; the in-page toggles that remain (MCP client picker, Members tabs) stay History-API with zero round-trips.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), Supabase (RLS is the security boundary), Zod, Tailwind v4 + shadcn primitives, Vitest + React Testing Library, sonner for toasts.

**Spec:** `docs/superpowers/specs/2026-07-25-settings-page-redesign-design.md`

---

## Before you start

- [ ] **Read the design system skills first.** Load `pulse-ui` (Monolith Keystone tokens, app primitives) and `frontend-design`. AGENTS.md working agreement #3 makes this mandatory for visual work — do not style anything before loading them.
- [ ] **Work in a worktree.** From the main checkout run `scripts/start-task.sh settings-redesign`, then `cd .claude/worktrees/settings-redesign`. Never build on `develop` directly.
- [ ] **Confirm Next.js 16 APIs against `node_modules/next/dist/docs/`** before writing route code. `headers()`, `cookies()` and `params` are async in this version.
- [ ] Run `pnpm test` once to confirm a green baseline before changing anything.

## File structure

**Created — routes**

| Path                                            | Responsibility                                 |
| ----------------------------------------------- | ---------------------------------------------- |
| `src/app/(app)/settings/layout.tsx`             | Header, nav, shared reads (user / org / admin) |
| `src/app/(app)/settings/page.tsx` _(rewritten)_ | Redirect to `/settings/profile`                |
| `src/app/(app)/settings/profile/page.tsx`       | Avatar, name, email                            |
| `src/app/(app)/settings/preferences/page.tsx`   | Personal time zone, appearance                 |
| `src/app/(app)/settings/notifications/page.tsx` | In-app kinds, email digest                     |
| `src/app/(app)/settings/security/page.tsx`      | Email, password, sessions, danger zone         |
| `src/app/(app)/settings/organization/page.tsx`  | Org name, org time zone                        |
| `src/app/(app)/settings/workspaces/page.tsx`    | Workspace list                                 |
| `src/app/(app)/settings/members/page.tsx`       | `OrgAdminConsole`, admin only                  |
| `src/app/(app)/settings/ai/page.tsx`            | Org AI policy + personal key                   |
| `src/app/(app)/settings/mcp/page.tsx`           | MCP guide + connected apps                     |

**Created — components** (all under `src/components/settings/`)

| Path                          | Responsibility                                        |
| ----------------------------- | ----------------------------------------------------- |
| `settings-section.tsx`        | Section heading + description + rule                  |
| `setting-row.tsx`             | The label/control alignment contract                  |
| `settings-nav.tsx`            | Grouped nav, active state from `usePathname`          |
| `appearance-form.tsx`         | Theme radio group (`next-themes`)                     |
| `org-name-form.tsx`           | Rename org                                            |
| `security-actions.tsx`        | Sign out everywhere                                   |
| `danger-zone.tsx`             | Leave organization                                    |
| `mcp/copy-field.tsx`          | Mono value + copy button                              |
| `mcp/mcp-client-guide.tsx`    | Client picker + per-client steps                      |
| `mcp/mcp-tools-table.tsx`     | The six tools with read/write badges                  |
| `mcp/connected-apps-list.tsx` | Replaces `ConnectedAppsSection`, with error surfacing |

**Modified**

| Path                                                       | Change                          |
| ---------------------------------------------------------- | ------------------------------- |
| `src/lib/validations/org.ts`                               | Add `updateOrgNameSchema`       |
| `src/lib/org/actions.ts`                                   | Add `updateOrgName`, `leaveOrg` |
| `src/lib/auth/actions.ts` _(or `src/app/auth/actions.ts`)_ | Add `signOutEverywhere`         |
| `src/app/(app)/settings/loading.tsx`                       | Match the new two-column shell  |

**Deleted**

| Path                                               | Reason                                      |
| -------------------------------------------------- | ------------------------------------------- |
| `src/components/settings/ConnectedAppsSection.tsx` | Superseded by `mcp/connected-apps-list.tsx` |

## Execution DAG

- **Batch 1 (parallel):** Task 1, Task 2, Task 3
- **Batch 2 (parallel, after batch 1):** Task 4, Task 5, Task 6, Task 7
- **Batch 3:** Task 8

Critical path: Task 1 → Task 7 → Task 8.

---

### Task 1: Layout shell, nav, and row primitives

**Files:**

- Create: `src/components/settings/setting-row.tsx`
- Create: `src/components/settings/setting-row.test.tsx`
- Create: `src/components/settings/settings-section.tsx`
- Create: `src/components/settings/settings-nav.tsx`
- Create: `src/components/settings/settings-nav.test.tsx`
- Create: `src/app/(app)/settings/layout.tsx`
- Modify: `src/app/(app)/settings/page.tsx` (replace entire contents)

- [ ] **Step 1: Write the failing test for `SettingRow`**

Create `src/components/settings/setting-row.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SettingRow } from "./setting-row";

describe("SettingRow", () => {
  it("renders label, description and control", () => {
    render(
      <SettingRow label="Full name" description="Shown to teammates.">
        <input aria-label="name input" />
      </SettingRow>,
    );
    expect(screen.getByText("Full name")).toBeInTheDocument();
    expect(screen.getByText("Shown to teammates.")).toBeInTheDocument();
    expect(screen.getByLabelText("name input")).toBeInTheDocument();
  });

  it("associates the label with the control when htmlFor is given", () => {
    render(
      <SettingRow label="Time zone" htmlFor="tz">
        <input id="tz" />
      </SettingRow>,
    );
    expect(screen.getByLabelText("Time zone")).toHaveAttribute("id", "tz");
  });

  it("omits the description paragraph when none is given", () => {
    const { container } = render(
      <SettingRow label="Email">
        <span>a@b.c</span>
      </SettingRow>,
    );
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/components/settings/setting-row.test.tsx`
Expected: FAIL — `Failed to resolve import "./setting-row"`.

- [ ] **Step 3: Implement `SettingRow`**

Create `src/components/settings/setting-row.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The alignment contract for a settings page: label + optional helper text on
 * the left, control right-aligned in a fixed-width column so every control in a
 * section shares one edge. Rows are separated by a hairline; the last row in a
 * section drops its rule. Stacks to a single column below `md`.
 *
 * Pass `htmlFor` when the control is a single focusable input — the label then
 * becomes a real <label> and clicking it focuses the control.
 */
export function SettingRow({
  label,
  htmlFor,
  description,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border flex flex-col gap-3 border-b py-5 last:border-b-0",
        "md:flex-row md:items-start md:justify-between md:gap-8",
        className,
      )}
    >
      <div className="min-w-0 md:flex-1">
        {htmlFor ? (
          <label
            htmlFor={htmlFor}
            className="text-foreground block text-sm font-medium"
          >
            {label}
          </label>
        ) : (
          <p className="text-foreground text-sm font-medium">{label}</p>
        )}
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        ) : null}
      </div>
      <div className="md:w-[280px] md:shrink-0">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run src/components/settings/setting-row.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Implement `SettingsSection`** (no test of its own — it is covered through the route tests in later tasks)

Create `src/components/settings/settings-section.tsx`:

```tsx
import type { ReactNode } from "react";

/**
 * A titled group of SettingRows. The heading sits above a rule; rows carry
 * their own separators. Sections stack with generous spacing so the page reads
 * as one column of groups rather than a grid of boxes.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-10 last:mb-0">
      <div className="border-border border-b pb-3">
        <h2 className="text-foreground font-heading text-base font-semibold tracking-tight">
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 6: Write the failing test for `SettingsNav`**

Create `src/components/settings/settings-nav.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsNav } from "./settings-nav";

const mockPathname = vi.fn(() => "/settings/profile");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

const GROUPS = [
  {
    label: "Account",
    items: [
      { href: "/settings/profile", label: "Profile" },
      { href: "/settings/security", label: "Security" },
    ],
  },
  {
    label: "Integrations",
    items: [{ href: "/settings/mcp", label: "Connect via MCP" }],
  },
];

describe("SettingsNav", () => {
  it("renders every group and item", () => {
    render(<SettingsNav groups={GROUPS} />);
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Integrations")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Connect via MCP" }),
    ).toBeInTheDocument();
  });

  it("marks the link matching the current pathname as current", () => {
    render(<SettingsNav groups={GROUPS} />);
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Security" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("does not render an item the caller omitted (admin-gated Members)", () => {
    render(<SettingsNav groups={GROUPS} />);
    expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `pnpm vitest run src/components/settings/settings-nav.test.tsx`
Expected: FAIL — `Failed to resolve import "./settings-nav"`.

- [ ] **Step 8: Implement `SettingsNav`**

Create `src/components/settings/settings-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Kicker } from "@/components/ui/kicker";
import { cn } from "@/lib/utils";

export type SettingsNavItem = { href: string; label: string };
export type SettingsNavGroup = { label: string; items: SettingsNavItem[] };

/**
 * Settings sub-navigation. Client component only because the active state
 * comes from usePathname(); the links are ordinary <Link> navigations, so each
 * section fetches its own data and nothing else (spec §Performance).
 */
export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings" className="flex flex-col">
      {groups.map((group) => (
        <div key={group.label} className="mb-5 last:mb-0">
          <Kicker className="mb-2 block px-2">{group.label}</Kicker>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 9: Run the test and confirm it passes**

Run: `pnpm vitest run src/components/settings/settings-nav.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 10: Create the layout**

Create `src/app/(app)/settings/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { Kicker } from "@/components/ui/kicker";
import {
  SettingsNav,
  type SettingsNavGroup,
} from "@/components/settings/settings-nav";

export const metadata = { title: "Settings" };

/**
 * Shared settings shell. Owns the only three reads every section needs — user,
 * active org, admin flag — so each section route can fetch just its own data.
 *
 * Uses isOrgAdminCached (a narrow, tagged org_members role lookup) rather than
 * isOrgAdmin(), which derives the role from the get_org_members RPC and would
 * drag that heavy query onto every settings page.
 */
export default async function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");
  const isAdmin = await isOrgAdminCached(user.id, org.id);

  const groups: SettingsNavGroup[] = [
    {
      label: "Account",
      items: [
        { href: "/settings/profile", label: "Profile" },
        { href: "/settings/preferences", label: "Preferences" },
        { href: "/settings/notifications", label: "Notifications" },
        { href: "/settings/security", label: "Security" },
      ],
    },
    {
      label: "Organization",
      items: [
        { href: "/settings/organization", label: "General" },
        { href: "/settings/workspaces", label: "Workspaces" },
        ...(isAdmin ? [{ href: "/settings/members", label: "Members" }] : []),
      ],
    },
    {
      label: "Integrations",
      items: [
        { href: "/settings/ai", label: "AI" },
        { href: "/settings/mcp", label: "Connect via MCP" },
      ],
    },
  ];

  return (
    <div className="w-full px-6 py-10 lg:px-8">
      <div className="mb-8">
        <Kicker className="mb-1.5 block">ADMIN</Kicker>
        <h1 className="text-foreground font-heading text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your account, organization and integrations.
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
        <aside className="lg:w-56 lg:shrink-0">
          <SettingsNav groups={groups} />
        </aside>
        <main className="min-w-0 flex-1 lg:max-w-3xl">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 11: Replace the index page with a redirect**

Replace the entire contents of `src/app/(app)/settings/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

/** `/settings` has no content of its own — the first Account section is home. */
export default function SettingsIndexPage() {
  redirect("/settings/profile");
}
```

- [ ] **Step 12: Verify the suite still passes**

Run: `pnpm vitest run src/components/settings`
Expected: PASS. Note that `src/app/(app)/settings/loading.test.tsx` may now fail — leave it; Task 8 rewrites `loading.tsx` and its test.

- [ ] **Step 13: Commit**

```bash
git add src/components/settings/setting-row.tsx src/components/settings/setting-row.test.tsx \
        src/components/settings/settings-section.tsx src/components/settings/settings-nav.tsx \
        src/components/settings/settings-nav.test.tsx \
        "src/app/(app)/settings/layout.tsx" "src/app/(app)/settings/page.tsx"
git commit -m "feat(settings): nav shell + row/section primitives"
```

---

### Task 2: `updateOrgName` and `leaveOrg` server actions

**Files:**

- Modify: `src/lib/validations/org.ts`
- Modify: `src/lib/org/actions.ts`
- Create: `src/lib/org/actions.test.ts` (if it already exists, append the new describes)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/org/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockGetUser = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        mockUpdate(table, values);
        return { eq: () => ({ error: mockUpdate.mock.results.at(-1)?.value }) };
      },
      delete: () => {
        mockDelete(table);
        return { eq: () => ({ eq: () => ({ error: null }) }) };
      },
    }),
    rpc: mockRpc,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateOrgName, leaveOrg } from "./actions";

const ORG = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER } } });
});

describe("updateOrgName", () => {
  it("rejects a blank name before touching the database", async () => {
    const res = await updateOrgName({ orgId: ORG, name: "   " });
    expect(res.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid orgId", async () => {
    const res = await updateOrgName({ orgId: "nope", name: "Acme" });
    expect(res.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("trims and writes a valid name", async () => {
    const res = await updateOrgName({ orgId: ORG, name: "  Acme Inc  " });
    expect(res.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("organizations", {
      name: "Acme Inc",
    });
  });

  it("fails when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await updateOrgName({ orgId: ORG, name: "Acme" });
    expect(res.ok).toBe(false);
  });
});

describe("leaveOrg", () => {
  it("refuses when the caller is the only owner", async () => {
    mockRpc.mockResolvedValue({
      data: [{ user_id: USER, role: "owner" }],
      error: null,
    });
    const res = await leaveOrg({ orgId: ORG });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/only owner/i);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("allows leaving when another owner remains", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { user_id: USER, role: "owner" },
        { user_id: "other", role: "owner" },
      ],
      error: null,
    });
    const res = await leaveOrg({ orgId: ORG });
    expect(res.ok).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith("org_members");
  });

  it("allows a plain member to leave", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { user_id: USER, role: "member" },
        { user_id: "other", role: "owner" },
      ],
      error: null,
    });
    const res = await leaveOrg({ orgId: ORG });
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/lib/org/actions.test.ts`
Expected: FAIL — `updateOrgName` / `leaveOrg` are not exported.

- [ ] **Step 3: Add the schemas**

Append to `src/lib/validations/org.ts`:

```ts
export const updateOrgNameSchema = z.object({
  orgId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name is too long"),
});
export type UpdateOrgNameInput = z.infer<typeof updateOrgNameSchema>;

export const leaveOrgSchema = z.object({ orgId: z.string().uuid() });
export type LeaveOrgInput = z.infer<typeof leaveOrgSchema>;
```

- [ ] **Step 4: Add the actions**

Append to `src/lib/org/actions.ts` (and extend the existing import of
`@/lib/validations/org` to include `updateOrgNameSchema` and `leaveOrgSchema`):

```ts
/**
 * Rename the organization. RLS ("organizations: update if owner/admin") is the
 * security boundary — a plain member's update matches no row and the policy
 * denies it, so no extra role check is needed here.
 */
export async function updateOrgName(input: {
  orgId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = updateOrgNameSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const { error } = await supabase
    .from("organizations")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.orgId);

  if (error) return fail("Could not rename the organization.");

  revalidatePath("/settings/organization");
  return { ok: true, data: undefined };
}

/**
 * Remove yourself from the organization. Deleting the last owner would strand
 * the org (no one could ever administer it again), so that case is refused with
 * an actionable message. The delete itself rides the "org_members: delete self
 * only" policy — RLS, not this check, is what stops you deleting anyone else.
 */
export async function leaveOrg(input: {
  orgId: string;
}): Promise<ActionResult> {
  const parsed = leaveOrgSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const { data: members, error: membersError } = await supabase.rpc(
    "get_org_members",
    { p_org_id: parsed.data.orgId },
  );
  if (membersError) return fail("Could not check your membership.");

  const rows = members ?? [];
  const me = rows.find((m) => m.user_id === user.id);
  if (!me) return fail("You are not a member of this organization.");

  const owners = rows.filter((m) => m.role === "owner");
  if (me.role === "owner" && owners.length <= 1) {
    return fail(
      "You are the only owner. Promote another member to owner before leaving.",
    );
  }

  const { error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", parsed.data.orgId)
    .eq("user_id", user.id);

  if (error) return fail("Could not leave the organization.");

  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm vitest run src/lib/org/actions.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/org.ts src/lib/org/actions.ts src/lib/org/actions.test.ts
git commit -m "feat(settings): updateOrgName + leaveOrg server actions"
```

---

### Task 3: `CopyField` primitive

**Files:**

- Create: `src/components/settings/mcp/copy-field.tsx`
- Create: `src/components/settings/mcp/copy-field.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/settings/mcp/copy-field.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CopyField } from "./copy-field";

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("CopyField", () => {
  it("shows the value", () => {
    render(<CopyField label="Server URL" value="https://x.test/api/mcp" />);
    expect(screen.getByText("https://x.test/api/mcp")).toBeInTheDocument();
  });

  it("copies the value and confirms", async () => {
    const user = userEvent.setup();
    render(<CopyField label="Server URL" value="https://x.test/api/mcp" />);
    await user.click(screen.getByRole("button", { name: /copy server url/i }));
    expect(writeText).toHaveBeenCalledWith("https://x.test/api/mcp");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("reports a clipboard failure instead of claiming success", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const user = userEvent.setup();
    render(<CopyField label="Server URL" value="https://x.test/api/mcp" />);
    await user.click(screen.getByRole("button", { name: /copy server url/i }));
    expect(await screen.findByText(/press .* to copy/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/components/settings/mcp/copy-field.test.tsx`
Expected: FAIL — `Failed to resolve import "./copy-field"`.

- [ ] **Step 3: Implement `CopyField`**

Create `src/components/settings/mcp/copy-field.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A read-only value the user needs to paste somewhere else — the MCP server
 * URL. Selectable text plus an explicit copy button, because clipboard writes
 * can be blocked (insecure origin, permissions policy) and a button that
 * silently does nothing is worse than no button: on failure we tell the user to
 * copy manually rather than flashing "Copied".
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <code className="border-border bg-muted/40 text-foreground min-w-0 flex-1 truncate rounded-md border px-3 py-2 font-mono text-xs">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {state === "copied" ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {state === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      {state === "failed" ? (
        <p className="text-muted-foreground text-xs">
          Couldn&apos;t reach the clipboard — select the value and press
          &#8984;C to copy.
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run src/components/settings/mcp/copy-field.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/mcp/copy-field.tsx src/components/settings/mcp/copy-field.test.tsx
git commit -m "feat(settings): CopyField primitive"
```

---

### Task 4: Account routes — profile, preferences, notifications, security

**Depends on:** Task 1 (primitives), Task 2 (`leaveOrg`)

**Files:**

- Create: `src/app/(app)/settings/profile/page.tsx`
- Create: `src/app/(app)/settings/preferences/page.tsx`
- Create: `src/app/(app)/settings/notifications/page.tsx`
- Create: `src/app/(app)/settings/security/page.tsx`
- Create: `src/components/settings/appearance-form.tsx`
- Create: `src/components/settings/appearance-form.test.tsx`
- Create: `src/components/settings/security-actions.tsx`
- Create: `src/components/settings/danger-zone.tsx`
- Create: `src/components/settings/danger-zone.test.tsx`
- Modify: `src/app/auth/actions.ts` (add `signOutEverywhere`)

- [ ] **Step 1: Write the failing test for `AppearanceForm`**

Create `src/components/settings/appearance-form.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppearanceForm } from "./appearance-form";

const setTheme = vi.fn();
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark", setTheme }),
}));

beforeEach(() => vi.clearAllMocks());

describe("AppearanceForm", () => {
  it("offers light, dark and system", () => {
    render(<AppearanceForm />);
    expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
  });

  it("marks the active theme as checked", () => {
    render(<AppearanceForm />);
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  it("sets the theme on selection", async () => {
    const user = userEvent.setup();
    render(<AppearanceForm />);
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(setTheme).toHaveBeenCalledWith("light");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/components/settings/appearance-form.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AppearanceForm`**

Create `src/components/settings/appearance-form.tsx`:

```tsx
"use client";

import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

/**
 * Theme picker. next-themes persists to localStorage and writes the `dark`
 * class, so there is no server round-trip and nothing to save — selection is
 * the commit. Mirrors the header ThemeToggle, which stays where it is.
 */
export function AppearanceForm() {
  const { theme, setTheme } = useTheme();

  return (
    <fieldset className="flex gap-2">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className={cn(
            "border-border flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm transition-colors",
            theme === opt.value
              ? "border-primary bg-accent text-foreground font-medium"
              : "text-muted-foreground hover:border-border-hover",
          )}
        >
          <input
            type="radio"
            name="theme"
            value={opt.value}
            className="sr-only"
            checked={theme === opt.value}
            onChange={() => setTheme(opt.value)}
          />
          {opt.label}
        </label>
      ))}
    </fieldset>
  );
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm vitest run src/components/settings/appearance-form.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add `signOutEverywhere`**

Read `src/app/auth/actions.ts` first and follow its existing `signOut` idiom.
Append an action that revokes every session for the user:

```ts
/**
 * Revoke every session for this user on every device, not just this browser.
 * `scope: "global"` invalidates all refresh tokens server-side — the escape
 * hatch for "I signed in on a machine I no longer control".
 */
export async function signOutEverywhere(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}
```

- [ ] **Step 6: Implement `SecurityActions`**

Create `src/components/settings/security-actions.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { signOutEverywhere } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";

/** Sign out of every device. The action redirects, so there is no success state. */
export function SignOutEverywhereButton() {
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => start(() => void signOutEverywhere())}
    >
      {pending ? "Signing out…" : "Sign out everywhere"}
    </Button>
  );
}
```

- [ ] **Step 7: Write the failing test for `DangerZone`**

Create `src/components/settings/danger-zone.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DangerZone } from "./danger-zone";

const leaveOrg = vi.fn();
const push = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/org/actions", () => ({ leaveOrg: (i: unknown) => leaveOrg(i) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const ORG = "11111111-1111-1111-1111-111111111111";

beforeEach(() => vi.clearAllMocks());

describe("DangerZone", () => {
  it("asks for confirmation before leaving", async () => {
    const user = userEvent.setup();
    render(<DangerZone orgId={ORG} orgName="Acme" />);
    await user.click(
      screen.getByRole("button", { name: /leave organization/i }),
    );
    expect(leaveOrg).not.toHaveBeenCalled();
    expect(await screen.findByText(/lose access to Acme/i)).toBeInTheDocument();
  });

  it("leaves and redirects home on success", async () => {
    leaveOrg.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<DangerZone orgId={ORG} orgName="Acme" />);
    await user.click(
      screen.getByRole("button", { name: /leave organization/i }),
    );
    await user.click(screen.getByRole("button", { name: /^leave$/i }));
    expect(leaveOrg).toHaveBeenCalledWith({ orgId: ORG });
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("surfaces the sole-owner refusal instead of failing silently", async () => {
    leaveOrg.mockResolvedValue({ ok: false, error: "You are the only owner." });
    const user = userEvent.setup();
    render(<DangerZone orgId={ORG} orgName="Acme" />);
    await user.click(
      screen.getByRole("button", { name: /leave organization/i }),
    );
    await user.click(screen.getByRole("button", { name: /^leave$/i }));
    expect(toastError).toHaveBeenCalledWith("You are the only owner.");
    expect(push).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Run it and confirm it fails**

Run: `pnpm vitest run src/components/settings/danger-zone.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 9: Implement `DangerZone`**

Create `src/components/settings/danger-zone.tsx`. Use the existing
`@/components/ui/alert-dialog` primitives (read `src/components/ui/alert-dialog.tsx`
first for the exact export names) so the confirm matches the rest of the app:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { leaveOrg } from "@/lib/org/actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Leaving is destructive and not self-reversing (you need a fresh invite to get
 * back in), so it sits behind a confirm. The sole-owner refusal comes from the
 * server action, not from here — this component only has to show it.
 */
export function DangerZone({
  orgId,
  orgName,
}: {
  orgId: string;
  orgName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function confirmLeave() {
    start(async () => {
      const res = await leaveOrg({ orgId });
      if (res.ok) {
        setOpen(false);
        router.push("/home");
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive border-destructive/40 hover:bg-destructive/10"
        onClick={() => setOpen(true)}
      >
        Leave organization
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this organization?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll lose access to {orgName} and everything in it. An
              owner or admin has to invite you again to get back in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmLeave();
              }}
              disabled={pending}
            >
              {pending ? "Leaving…" : "Leave"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

> Confirm the export names against `src/components/ui/alert-dialog.tsx` before
> writing this — if the project's shadcn version names them differently, match
> the file, don't adapt the file to this snippet.

- [ ] **Step 10: Run it and confirm it passes**

Run: `pnpm vitest run src/components/settings/danger-zone.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 11: Build the four Account routes**

`src/app/(app)/settings/profile/page.tsx` — reads the `profiles` row only:

```tsx
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { ProfileForm } from "@/components/settings/profile-form";

export const metadata = { title: "Profile · Settings" };

export default async function ProfileSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <SettingsSection
      title="Profile"
      description="How you appear to your teammates."
    >
      <ProfileForm
        userId={user.id}
        currentFullName={profile?.full_name ?? null}
        currentAvatarUrl={profile?.avatar_url ?? null}
      />
      <SettingRow
        label="Email"
        description="Used to sign in. Contact an owner to change it."
      >
        <p className="text-muted-foreground text-sm">{user.email}</p>
      </SettingRow>
    </SettingsSection>
  );
}
```

`src/app/(app)/settings/preferences/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth/session";
import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { PersonalTimezoneForm } from "@/components/settings/personal-timezone-form";
import { AppearanceForm } from "@/components/settings/appearance-form";

export const metadata = { title: "Preferences · Settings" };

export default async function PreferencesSettingsPage() {
  const user = await requireUser();
  const timeZone = await getUserTimeZoneCached(user.id);

  return (
    <SettingsSection
      title="Preferences"
      description="Personal settings for your account."
    >
      <SettingRow
        label="Time zone"
        description="Dates and reminders are shown in this zone."
      >
        <PersonalTimezoneForm currentTimezone={timeZone} />
      </SettingRow>
      <SettingRow
        label="Appearance"
        description="Match your system or pick a theme."
      >
        <AppearanceForm />
      </SettingRow>
    </SettingsSection>
  );
}
```

`src/app/(app)/settings/notifications/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getDisabledInAppKinds } from "@/lib/settings/notification-prefs.queries";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { NotificationPreferencesForm } from "@/components/settings/NotificationPreferencesForm";
import { DigestPreferenceForm } from "@/components/settings/DigestPreferenceForm";

export const metadata = { title: "Notifications · Settings" };

export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [disabledInApp, { data: profile }] = await Promise.all([
    getDisabledInAppKinds(user.id),
    supabase
      .from("profiles")
      .select("email_digest_opt_out")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  return (
    <SettingsSection
      title="Notifications"
      description="Choose which notifications you receive."
    >
      <NotificationPreferencesForm disabledKinds={[...disabledInApp]} />
      <SettingRow label="Email" description="Weekly summary of plan health.">
        <DigestPreferenceForm
          initialOptOut={profile?.email_digest_opt_out ?? false}
        />
      </SettingRow>
    </SettingsSection>
  );
}
```

`src/app/(app)/settings/security/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { SignOutEverywhereButton } from "@/components/settings/security-actions";
import { DangerZone } from "@/components/settings/danger-zone";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Security · Settings" };

export default async function SecuritySettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");

  return (
    <>
      <SettingsSection
        title="Security"
        description="Keep your account and sessions under control."
      >
        <SettingRow label="Email" description="The address you sign in with.">
          <p className="text-muted-foreground text-sm">{user.email}</p>
        </SettingRow>
        <SettingRow
          label="Password"
          description="Change the password used to sign in."
        >
          <Button asChild variant="outline" size="sm">
            <Link href="/change-password">Change password</Link>
          </Button>
        </SettingRow>
        <SettingRow
          label="Active sessions"
          description="Sign out of Pulse on every device you're signed in on."
        >
          <SignOutEverywhereButton />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Danger zone"
        description="These actions can't be undone from here."
      >
        <SettingRow
          label="Leave organization"
          description={`Remove yourself from ${org.name}. You'll need a new invite to return.`}
        >
          <DangerZone orgId={org.id} orgName={org.name} />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
```

- [ ] **Step 12: Verify all four routes typecheck and the suite passes**

Run: `pnpm typecheck && pnpm vitest run src/components/settings`
Expected: no type errors; all settings component tests PASS.

- [ ] **Step 13: Commit**

```bash
git add "src/app/(app)/settings/profile" "src/app/(app)/settings/preferences" \
        "src/app/(app)/settings/notifications" "src/app/(app)/settings/security" \
        src/components/settings/appearance-form.tsx src/components/settings/appearance-form.test.tsx \
        src/components/settings/security-actions.tsx \
        src/components/settings/danger-zone.tsx src/components/settings/danger-zone.test.tsx \
        src/app/auth/actions.ts
git commit -m "feat(settings): account section routes (profile, preferences, notifications, security)"
```

---

### Task 5: Organization routes — general, workspaces, members

**Depends on:** Task 1 (primitives), Task 2 (`updateOrgName`)

**Files:**

- Create: `src/app/(app)/settings/organization/page.tsx`
- Create: `src/app/(app)/settings/workspaces/page.tsx`
- Create: `src/app/(app)/settings/members/page.tsx`
- Create: `src/components/settings/org-name-form.tsx`
- Create: `src/components/settings/org-name-form.test.tsx`

- [ ] **Step 1: Write the failing test for `OrgNameForm`**

Create `src/components/settings/org-name-form.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrgNameForm } from "./org-name-form";

const updateOrgName = vi.fn();
vi.mock("@/lib/org/actions", () => ({
  updateOrgName: (i: unknown) => updateOrgName(i),
}));

const ORG = "11111111-1111-1111-1111-111111111111";

beforeEach(() => vi.clearAllMocks());

describe("OrgNameForm", () => {
  it("disables save until the name changes", async () => {
    render(<OrgNameForm orgId={ORG} currentName="Acme" canEdit />);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("saves a changed name", async () => {
    updateOrgName.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<OrgNameForm orgId={ORG} currentName="Acme" canEdit />);
    const input = screen.getByLabelText(/organization name/i);
    await user.clear(input);
    await user.type(input, "Acme Inc");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(updateOrgName).toHaveBeenCalledWith({
      orgId: ORG,
      name: "Acme Inc",
    });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("shows the server error on failure", async () => {
    updateOrgName.mockResolvedValue({ ok: false, error: "Not allowed." });
    const user = userEvent.setup();
    render(<OrgNameForm orgId={ORG} currentName="Acme" canEdit />);
    const input = screen.getByLabelText(/organization name/i);
    await user.clear(input);
    await user.type(input, "Nope");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Not allowed.")).toBeInTheDocument();
  });

  it("renders read-only for a non-admin", () => {
    render(<OrgNameForm orgId={ORG} currentName="Acme" canEdit={false} />);
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/components/settings/org-name-form.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `OrgNameForm`**

Create `src/components/settings/org-name-form.tsx`, following the
`TimezoneForm` idiom (`useTransition` + inline message, not a toast):

```tsx
"use client";

import { useId, useState, useTransition } from "react";
import { updateOrgName } from "@/lib/org/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Rename the org. Non-admins get a read-only value rather than a disabled
 * input — RLS would reject their write anyway, and a control you can focus but
 * never submit reads as a bug.
 */
export function OrgNameForm({
  orgId,
  currentName,
  canEdit,
}: {
  orgId: string;
  currentName: string;
  canEdit: boolean;
}) {
  const id = useId();
  const [name, setName] = useState(currentName);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  if (!canEdit) {
    return <p className="text-muted-foreground text-sm">{currentName}</p>;
  }

  const unchanged = name.trim() === currentName.trim();

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateOrgName({ orgId, name: name.trim() });
      if (res.ok) {
        setMsg("Saved.");
        setIsError(false);
      } else {
        setMsg(res.error);
        setIsError(true);
      }
    });
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="sr-only">
        Organization name
      </label>
      <Input
        id={id}
        value={name}
        disabled={pending}
        onChange={(e) => {
          setName(e.target.value);
          setMsg(null);
        }}
      />
      <div className="flex items-center gap-3">
        <Button
          onClick={save}
          disabled={pending || unchanged || name.trim() === ""}
          size="sm"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        {msg && (
          <span
            className={cn(
              "text-xs",
              isError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm vitest run src/components/settings/org-name-form.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Build the organization route**

`src/app/(app)/settings/organization/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { OrgNameForm } from "@/components/settings/org-name-form";
import { TimezoneForm } from "@/components/settings/timezone-form";

export const metadata = { title: "Organization · Settings" };

export default async function OrganizationSettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");
  const isAdmin = await isOrgAdminCached(user.id, org.id);

  return (
    <SettingsSection
      title="Organization"
      description="General settings for your organization."
    >
      <SettingRow
        label="Name"
        description="Shown across Pulse and in invitation emails."
      >
        <OrgNameForm orgId={org.id} currentName={org.name} canEdit={isAdmin} />
      </SettingRow>
      <SettingRow
        label="Time zone"
        description="Date automations fire at 8:00 AM in this zone."
      >
        <TimezoneForm orgId={org.id} currentTimezone={org.timezone ?? "UTC"} />
      </SettingRow>
    </SettingsSection>
  );
}
```

> `TimezoneForm` currently renders its own `<Label>Timezone</Label>` and helper
> text. Move that duplication out: delete the internal `<Label>` and the
> "Date automations fire…" `<p>` from `src/components/settings/timezone-form.tsx`
> so the `SettingRow` owns them, and update
> `src/components/settings/timezone-form.test.tsx` accordingly. Run
> `pnpm vitest run src/components/settings/timezone-form.test.tsx` after.

- [ ] **Step 6: Build the workspaces route**

`src/app/(app)/settings/workspaces/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { SettingsSection } from "@/components/settings/settings-section";
import { WorkspaceNavItem } from "@/components/workspaces/WorkspaceNavItem";
import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";

export const metadata = { title: "Workspaces · Settings" };

export default async function WorkspacesSettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");
  const [workspaces, isAdmin] = await Promise.all([
    listWorkspacesCached(org.id),
    isOrgAdminCached(user.id, org.id),
  ]);

  return (
    <SettingsSection
      title="Workspaces"
      description="Organize boards and dashboards. Rename or delete here; switch the active workspace from the sidebar."
    >
      <div className="flex items-center justify-between py-4">
        <p className="text-muted-foreground text-sm">
          {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}
        </p>
        <NewWorkspaceDialog />
      </div>
      <div className="flex flex-col gap-0.5">
        {workspaces.map((w) => (
          <WorkspaceNavItem
            key={w.id}
            workspace={w}
            isOrgAdmin={isAdmin}
            isLast={workspaces.length <= 1}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
```

- [ ] **Step 7: Build the members route (admin only)**

`src/app/(app)/settings/members/page.tsx` — this is where the heavy reads now
live, and they only run when this route is opened:

```tsx
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { SettingsSection } from "@/components/settings/settings-section";
import { OrgAdminConsole } from "@/components/settings/org-admin-console";

export const metadata = { title: "Members · Settings" };

export default async function MembersSettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");

  const supabase = await createClient();
  const { data: members } = await supabase.rpc("get_org_members", {
    p_org_id: org.id,
  });
  const me = (members ?? []).find((m) => m.user_id === user.id);
  const isAdmin = me?.role === "owner" || me?.role === "admin";
  if (!isAdmin || !me) notFound();

  const [{ data: invites }, { data: audit }] = await Promise.all([
    supabase
      .from("org_invitations")
      .select("id, email, role, status, created_at")
      .eq("org_id", org.id)
      .in("status", ["pending", "declined"])
      .order("created_at", { ascending: false }),
    supabase
      .from("admin_audit_log")
      .select("id, action, target_email, created_at")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <SettingsSection
      title="Members"
      description="Manage members, invitations, and activity."
    >
      <div className="pt-4">
        <OrgAdminConsole
          orgId={org.id}
          members={members ?? []}
          invites={(invites ?? []).map((i) => ({
            ...i,
            status: i.status as "pending" | "declined",
          }))}
          audit={audit ?? []}
          currentUserId={user.id}
          currentUserRole={me.role}
        />
      </div>
    </SettingsSection>
  );
}
```

- [ ] **Step 8: Typecheck and run the suite**

Run: `pnpm typecheck && pnpm vitest run src/components/settings`
Expected: no type errors; all PASS.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/settings/organization" "src/app/(app)/settings/workspaces" \
        "src/app/(app)/settings/members" \
        src/components/settings/org-name-form.tsx src/components/settings/org-name-form.test.tsx \
        src/components/settings/timezone-form.tsx src/components/settings/timezone-form.test.tsx
git commit -m "feat(settings): organization section routes + org rename"
```

---

### Task 6: AI route — merge the two AI cards

**Depends on:** Task 1

**Files:**

- Create: `src/app/(app)/settings/ai/page.tsx`

- [ ] **Step 1: Build the route**

The old page rendered two sibling cards ("AI — Organization" and "AI") whose
relationship was invisible. One page, org policy first:

```tsx
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingRow } from "@/components/settings/setting-row";
import { AiProviderForm } from "@/components/settings/AiProviderForm";
import { OrgAiSettingsForm } from "@/components/settings/OrgAiSettingsForm";
import { getMyAiCredential } from "@/lib/ai/credentials";
import { getOrgAiSettings } from "@/lib/ai/settings-actions";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { redirect } from "next/navigation";

export const metadata = { title: "AI · Settings" };

export default async function AiSettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");

  const [aiCredential, orgAi, isAdmin] = await Promise.all([
    getMyAiCredential(),
    getOrgAiSettings(),
    isOrgAdminCached(user.id, org.id),
  ]);

  const orgAiMode = orgAi.ok ? orgAi.data.mode : null;
  const personalKeyManaged = orgAiMode !== null && orgAiMode !== "per_user";

  return (
    <>
      {isAdmin && orgAi.ok && (
        <SettingsSection
          title="Organization AI"
          description="How AI features are powered for everyone in this org."
        >
          <div className="pt-4">
            <OrgAiSettingsForm initial={orgAi.data} />
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title="Your AI provider"
        description={
          personalKeyManaged
            ? "AI is powered by your organization's settings."
            : "Your provider key powers dashboard generation and other AI features."
        }
      >
        <SettingRow
          label="Provider key"
          description={
            personalKeyManaged
              ? "Managed by your organization — no personal key needed."
              : aiCredential
                ? "A key is configured for your account."
                : "Not configured yet."
          }
        >
          {personalKeyManaged ? (
            <p className="text-muted-foreground text-sm">Nothing to do here.</p>
          ) : (
            <AiProviderForm initial={aiCredential} />
          )}
        </SettingRow>
      </SettingsSection>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. If `AiProviderForm`'s `initial` prop type disagrees, read
`src/components/settings/AiProviderForm.tsx` and match it exactly — do not cast.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/ai"
git commit -m "feat(settings): single AI page merging org policy and personal key"
```

---

### Task 7: Connect via MCP page

**Depends on:** Task 1 (primitives), Task 3 (`CopyField`)

**Files:**

- Create: `src/app/(app)/settings/mcp/page.tsx`
- Create: `src/components/settings/mcp/mcp-tools-table.tsx`
- Create: `src/components/settings/mcp/mcp-tools-table.test.tsx`
- Create: `src/components/settings/mcp/mcp-client-guide.tsx`
- Create: `src/components/settings/mcp/mcp-client-guide.test.tsx`
- Create: `src/components/settings/mcp/connected-apps-list.tsx`
- Create: `src/components/settings/mcp/connected-apps-list.test.tsx`
- Delete: `src/components/settings/ConnectedAppsSection.tsx`

- [ ] **Step 1: Write the failing test for the tools table**

Create `src/components/settings/mcp/mcp-tools-table.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { McpToolsTable } from "./mcp-tools-table";

describe("McpToolsTable", () => {
  it("lists all six registered tools", () => {
    render(<McpToolsTable />);
    for (const name of [
      "list_boards",
      "get_board",
      "search_items",
      "get_item",
      "create_item",
      "update_item",
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("marks exactly two tools as write access", () => {
    render(<McpToolsTable />);
    expect(screen.getAllByText("Write")).toHaveLength(2);
    expect(screen.getAllByText("Read")).toHaveLength(4);
  });

  it("states that no tool can delete", () => {
    render(<McpToolsTable />);
    expect(screen.getByText(/cannot delete/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/components/settings/mcp/mcp-tools-table.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tools table**

Create `src/components/settings/mcp/mcp-tools-table.tsx`. The list must stay in
sync with `src/lib/mcp/tools/register.ts`:

```tsx
import { cn } from "@/lib/utils";

/**
 * The tools a connected client can call. Mirrors the registrations in
 * src/lib/mcp/tools/register.ts — if a tool is added there, add it here, since
 * this table is the user's only account of what they are granting.
 */
const TOOLS = [
  { name: "list_boards", access: "read", what: "List the boards you can see." },
  {
    name: "get_board",
    access: "read",
    what: "Read a board's columns and groups.",
  },
  {
    name: "search_items",
    access: "read",
    what: "Find items by name within a board.",
  },
  {
    name: "get_item",
    access: "read",
    what: "Read one item's fields and values.",
  },
  { name: "create_item", access: "write", what: "Add a new item to a board." },
  {
    name: "update_item",
    access: "write",
    what: "Change values on an existing item.",
  },
] as const;

export function McpToolsTable() {
  return (
    <div className="space-y-3 py-4">
      <ul className="border-border divide-border divide-y rounded-md border">
        {TOOLS.map((tool) => (
          <li
            key={tool.name}
            className="flex items-center justify-between gap-4 px-3 py-2.5"
          >
            <div className="min-w-0">
              <code className="text-foreground font-mono text-xs">
                {tool.name}
              </code>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {tool.what}
              </p>
            </div>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                tool.access === "write"
                  ? "border-primary/40 text-primary"
                  : "border-border text-muted-foreground",
              )}
            >
              {tool.access === "write" ? "Write" : "Read"}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-sm">
        A connected client cannot delete anything — no delete tool exists. Every
        call runs as you and is subject to the same permissions you have in the
        app.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm vitest run src/components/settings/mcp/mcp-tools-table.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test for the client guide**

Create `src/components/settings/mcp/mcp-client-guide.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpClientGuide } from "./mcp-client-guide";

const pushState = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window.history, "pushState").mockImplementation(pushState);
});

describe("McpClientGuide", () => {
  it("shows Claude Desktop steps by default", () => {
    render(<McpClientGuide serverUrl="https://x.test/api/mcp" />);
    expect(
      screen.getByRole("tab", { name: /claude desktop/i }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Settings → Connectors/i)).toBeInTheDocument();
  });

  it("switches client without navigating", async () => {
    const user = userEvent.setup();
    render(<McpClientGuide serverUrl="https://x.test/api/mcp" />);
    await user.click(screen.getByRole("tab", { name: /claude code/i }));
    expect(screen.getByText(/claude mcp add/i)).toBeInTheDocument();
    expect(pushState).toHaveBeenCalled();
  });

  it("embeds the real server URL in the CLI command", async () => {
    const user = userEvent.setup();
    render(<McpClientGuide serverUrl="https://x.test/api/mcp" />);
    await user.click(screen.getByRole("tab", { name: /claude code/i }));
    expect(screen.getByText(/https:\/\/x\.test\/api\/mcp/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `pnpm vitest run src/components/settings/mcp/mcp-client-guide.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the client guide**

Create `src/components/settings/mcp/mcp-client-guide.tsx`. Follow the
`OrgAdminConsole` tab idiom exactly — History API only, no `<Link>`/router
navigation, so switching clients costs zero server round-trips (AGENTS.md §5):

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const CLIENTS = [
  { id: "desktop", label: "Claude Desktop" },
  { id: "web", label: "claude.ai" },
  { id: "code", label: "Claude Code" },
  { id: "other", label: "Other client" },
] as const;

type ClientId = (typeof CLIENTS)[number]["id"];

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
      {children}
    </ol>
  );
}

export function McpClientGuide({ serverUrl }: { serverUrl: string }) {
  const [client, setClient] = useState<ClientId>("desktop");

  function select(next: ClientId) {
    setClient(next);
    // History API only — this is an in-page toggle over data the page already
    // has, so it must not trigger an RSC navigation (AGENTS.md §5).
    const url = new URL(window.location.href);
    url.searchParams.set("client", next);
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
  }

  return (
    <div className="space-y-4 py-4">
      <div role="tablist" className="border-border flex gap-1 border-b">
        {CLIENTS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={client === c.id}
            onClick={() => select(c.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:ring-ring/50 rounded-t-sm focus-visible:ring-2 focus-visible:outline-none",
              client === c.id
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground hover:border-border-hover border-transparent",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {client === "desktop" && (
        <Steps>
          <li>Open Claude Desktop and go to Settings → Connectors.</li>
          <li>
            Choose <b>Add custom connector</b>.
          </li>
          <li>
            Name it <b>Pulse</b> and paste the server URL above.
          </li>
          <li>
            Click <b>Connect</b>. A Pulse sign-in page opens in your browser —
            approve the request there.
          </li>
          <li>
            Back in Claude, ask &ldquo;list my Pulse boards&rdquo; to confirm it
            works.
          </li>
        </Steps>
      )}

      {client === "web" && (
        <Steps>
          <li>Open claude.ai and go to Settings → Connectors.</li>
          <li>
            Choose <b>Add custom connector</b> and paste the server URL above.
          </li>
          <li>Approve the Pulse sign-in prompt that opens.</li>
          <li>
            Start a new chat and ask &ldquo;list my Pulse boards&rdquo; to
            confirm it works.
          </li>
        </Steps>
      )}

      {client === "code" && (
        <Steps>
          <li>
            Run this in your terminal:
            <code className="border-border bg-muted/40 mt-1.5 block overflow-x-auto rounded-md border px-3 py-2 font-mono text-xs">
              claude mcp add --transport http pulse {serverUrl}
            </code>
          </li>
          <li>
            Run <code className="font-mono text-xs">/mcp</code> inside Claude
            Code and authenticate when prompted.
          </li>
          <li>
            Ask &ldquo;list my Pulse boards&rdquo; to confirm the connection.
          </li>
        </Steps>
      )}

      {client === "other" && (
        <Steps>
          <li>
            Pulse speaks the Model Context Protocol over streamable HTTP, with
            OAuth 2.1 (dynamic client registration + PKCE) for authentication.
          </li>
          <li>
            Point your client at the server URL above. It discovers the
            authorization server automatically via the standard
            <code className="mx-1 font-mono text-xs">
              /.well-known/oauth-protected-resource
            </code>
            metadata.
          </li>
          <li>
            Complete the sign-in in the browser window your client opens. No
            manual client ID or secret is needed.
          </li>
        </Steps>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run it and confirm it passes**

Run: `pnpm vitest run src/components/settings/mcp/mcp-client-guide.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 9: Write the failing test for the connected-apps list**

This is the regression fix — the old component discarded the action result, so a
failed revoke was silent. Create
`src/components/settings/mcp/connected-apps-list.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectedAppsList } from "./connected-apps-list";

const revoke = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/mcp/oauth/connections-actions", () => ({
  revokeConnectionAction: (id: string) => revoke(id),
}));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));

const CONNECTIONS = [
  {
    id: "tok-1",
    clientName: "Claude Desktop",
    createdAt: "2026-07-01T10:00:00.000Z",
  },
];

beforeEach(() => vi.clearAllMocks());

describe("ConnectedAppsList", () => {
  it("shows an empty state when nothing is connected", () => {
    render(<ConnectedAppsList connections={[]} />);
    expect(screen.getByText(/no apps connected/i)).toBeInTheDocument();
  });

  it("shows the client name and when it connected", () => {
    render(<ConnectedAppsList connections={CONNECTIONS} />);
    expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it("confirms before revoking", async () => {
    const user = userEvent.setup();
    render(<ConnectedAppsList connections={CONNECTIONS} />);
    await user.click(screen.getByRole("button", { name: /revoke/i }));
    expect(revoke).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/lose access to your Pulse/i),
    ).toBeInTheDocument();
  });

  it("surfaces a revoke failure instead of swallowing it", async () => {
    revoke.mockResolvedValue({ ok: false, error: "Token already gone." });
    const user = userEvent.setup();
    render(<ConnectedAppsList connections={CONNECTIONS} />);
    await user.click(screen.getByRole("button", { name: /revoke/i }));
    await user.click(screen.getByRole("button", { name: /^revoke access$/i }));
    expect(revoke).toHaveBeenCalledWith("tok-1");
    expect(toastError).toHaveBeenCalledWith("Token already gone.");
  });

  it("confirms success", async () => {
    revoke.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<ConnectedAppsList connections={CONNECTIONS} />);
    await user.click(screen.getByRole("button", { name: /revoke/i }));
    await user.click(screen.getByRole("button", { name: /^revoke access$/i }));
    expect(toastSuccess).toHaveBeenCalled();
  });
});
```

- [ ] **Step 10: Run it and confirm it fails**

Run: `pnpm vitest run src/components/settings/mcp/connected-apps-list.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement the connected-apps list**

Create `src/components/settings/mcp/connected-apps-list.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { revokeConnectionAction } from "@/lib/mcp/oauth/connections-actions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type Connection = {
  id: string;
  clientName: string;
  createdAt: string;
};

/**
 * Apps holding a live MCP token. Replaces ConnectedAppsSection, which submitted
 * an inline `form action` and threw away the ActionResult — a failed revoke
 * looked identical to a successful one. Here the result is awaited and shown.
 */
export function ConnectedAppsList({
  connections,
}: {
  connections: Connection[];
}) {
  const [target, setTarget] = useState<Connection | null>(null);
  const [pending, start] = useTransition();

  if (connections.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-sm">
        No apps connected via MCP yet. Follow the steps above to connect one.
      </p>
    );
  }

  function confirmRevoke() {
    if (!target) return;
    const name = target.clientName;
    start(async () => {
      const res = await revokeConnectionAction(target.id);
      if (res.ok) {
        toast.success(`${name} can no longer access your account.`);
        setTarget(null);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <ul className="space-y-2 py-4">
        {connections.map((c) => (
          <li
            key={c.id}
            className="border-border flex items-center justify-between gap-4 rounded-md border px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-foreground truncate text-sm font-medium">
                {c.clientName}
              </p>
              <p className="text-muted-foreground text-xs">
                Connected{" "}
                {new Date(c.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => setTarget(c)}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke {target?.clientName}&apos;s access?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It will immediately lose access to your Pulse boards. You can
              connect it again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmRevoke();
              }}
              disabled={pending}
            >
              {pending ? "Revoking…" : "Revoke access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 12: Run it and confirm it passes**

Run: `pnpm vitest run src/components/settings/mcp/connected-apps-list.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 13: Build the MCP route**

Create `src/app/(app)/settings/mcp/page.tsx`. The origin is derived from request
headers — the same reasoning as
`src/app/.well-known/oauth-protected-resource/route.ts`, which derives its origin
per-request rather than hardcoding one, because dev and prod differ:

```tsx
import { headers } from "next/headers";
import { listMyConnections } from "@/lib/mcp/oauth/connections";
import { SettingsSection } from "@/components/settings/settings-section";
import { CopyField } from "@/components/settings/mcp/copy-field";
import { McpClientGuide } from "@/components/settings/mcp/mcp-client-guide";
import { McpToolsTable } from "@/components/settings/mcp/mcp-tools-table";
import { ConnectedAppsList } from "@/components/settings/mcp/connected-apps-list";

export const metadata = { title: "Connect via MCP · Settings" };

/**
 * The public origin of this deployment, from the request. Hardcoding would
 * hand a localhost URL to production users and vice versa; the well-known
 * metadata routes derive their origin the same way.
 */
async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function McpSettingsPage() {
  const [connections, origin] = await Promise.all([
    listMyConnections(),
    getOrigin(),
  ]);
  const serverUrl = `${origin}/api/mcp`;

  return (
    <>
      <SettingsSection
        title="Connect via MCP"
        description="Let Claude and other AI clients read and update your Pulse boards."
      >
        <div className="space-y-4 py-4">
          <p className="text-muted-foreground text-sm">
            The Model Context Protocol (MCP) is an open standard that lets AI
            apps talk to tools like Pulse. Once connected, you can ask your AI
            client to find items, summarize a board, or create and update work —
            without leaving the conversation.
          </p>
          <div>
            <p className="text-foreground mb-1.5 text-sm font-medium">
              Your server URL
            </p>
            <CopyField label="Server URL" value={serverUrl} />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Add it to your client"
        description="Pick your app for the exact steps."
      >
        <McpClientGuide serverUrl={serverUrl} />
      </SettingsSection>

      <SettingsSection
        title="What a connected client can do"
        description="These are the only actions available over MCP."
      >
        <McpToolsTable />
      </SettingsSection>

      <SettingsSection
        title="Access and safety"
        description="What you're granting when you connect an app."
      >
        <ul className="text-muted-foreground list-disc space-y-2 py-4 pl-5 text-sm">
          <li>
            The client connects <b>as you</b>. It sees exactly the boards and
            items you can see — never another member&apos;s private work, never
            another organization&apos;s data.
          </li>
          <li>
            You sign in on Pulse itself. The client never sees your password.
          </li>
          <li>
            Nothing can be deleted over MCP — no delete tool exists on the
            server.
          </li>
          <li>
            You can revoke any app below at any time, and it loses access
            immediately.
          </li>
        </ul>
      </SettingsSection>

      <SettingsSection
        title="Connected apps"
        description="Apps and clients currently holding MCP access to your account."
      >
        <ConnectedAppsList connections={connections} />
      </SettingsSection>

      <SettingsSection
        title="Troubleshooting"
        description="If something isn't working."
      >
        <dl className="space-y-4 py-4 text-sm">
          <div>
            <dt className="text-foreground font-medium">
              The client won&apos;t connect
            </dt>
            <dd className="text-muted-foreground mt-1">
              Check the URL ends in <code className="font-mono">/api/mcp</code>{" "}
              and that you&apos;re signed in to Pulse in the same browser the
              approval window opens in.
            </dd>
          </div>
          <div>
            <dt className="text-foreground font-medium">
              It connected, then stopped working
            </dt>
            <dd className="text-muted-foreground mt-1">
              Access may have been revoked here, or the connection expired.
              Remove the connector in your client and add it again.
            </dd>
          </div>
          <div>
            <dt className="text-foreground font-medium">No boards come back</dt>
            <dd className="text-muted-foreground mt-1">
              The connection is scoped to your account. If you belong to more
              than one organization, boards outside your active one aren&apos;t
              visible over MCP.
            </dd>
          </div>
        </dl>
      </SettingsSection>
    </>
  );
}
```

- [ ] **Step 14: Delete the superseded component**

```bash
git rm src/components/settings/ConnectedAppsSection.tsx
```

Then run `grep -rn "ConnectedAppsSection" src/` and confirm there are no
remaining references.

- [ ] **Step 15: Typecheck and run the MCP tests**

Run: `pnpm typecheck && pnpm vitest run src/components/settings/mcp`
Expected: no type errors; 11 tests PASS.

- [ ] **Step 16: Commit**

```bash
git add "src/app/(app)/settings/mcp" src/components/settings/mcp
git commit -m "feat(settings): Connect via MCP guide + surface revoke errors"
```

---

### Task 8: Loading state, cleanup, and full verification

**Depends on:** Tasks 4, 5, 6, 7

**Files:**

- Modify: `src/app/(app)/settings/loading.tsx`
- Modify: `src/app/(app)/settings/loading.test.tsx`

- [ ] **Step 1: Update the loading test to the new shell**

The existing test asserts three card skeletons from the old layout. Replace the
body of `src/app/(app)/settings/loading.test.tsx` with assertions for the
two-column shell (read the current file first and keep its imports/idiom):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import SettingsLoading from "./loading";

describe("SettingsLoading", () => {
  it("announces itself as busy", () => {
    render(<SettingsLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAccessibleName(/loading settings/i);
  });

  it("renders skeleton rows for the content column", () => {
    render(<SettingsLoading />);
    expect(
      screen.getAllByTestId("settings-row-skeleton").length,
    ).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run "src/app/(app)/settings/loading.test.tsx"`
Expected: FAIL — no elements with `data-testid="settings-row-skeleton"`.

- [ ] **Step 3: Rewrite `loading.tsx`**

Replace the entire contents of `src/app/(app)/settings/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant fallback for a settings section. The layout (header + nav) renders
 * immediately and is not part of this fallback — only the content column
 * suspends, so switching sections never blanks the nav.
 */
export default function SettingsLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading settings">
      <div className="border-border border-b pb-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          data-testid="settings-row-skeleton"
          className="border-border flex items-start justify-between gap-8 border-b py-5 last:border-b-0"
        >
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-9 w-[280px]" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm vitest run "src/app/(app)/settings/loading.test.tsx"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Check for stale references to the old page**

Run:

```bash
grep -rn "ConnectedAppsSection" src/
grep -rn 'href="/settings"' src/
```

The first must return nothing. The second will match
`src/components/shell/workspace-switcher.tsx` and
`src/components/shell/user-menu.tsx` — both are fine, `/settings` redirects to
`/settings/profile`.

- [ ] **Step 6: Run all four gates**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four pass. Do not proceed on a failure — fix it and re-run. If
`pnpm typecheck` reports errors under `.next/types`, run `rm -rf .next/types`
first (a known trap in this repo).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/settings/loading.tsx" "src/app/(app)/settings/loading.test.tsx"
git commit -m "feat(settings): loading fallback for the section column"
```

- [ ] **Step 8: Manual verification in the running app**

Start the dev server (`pnpm dev`) and walk the page yourself before calling it
done:

1. `/settings` redirects to `/settings/profile`.
2. Every nav item loads its section; the active item is highlighted.
3. Rename the org on `/settings/organization`, reload, confirm it stuck.
4. `/settings/mcp` shows `http://localhost:3000/api/mcp` (not a production URL),
   the copy button works, and all four client tabs switch without a page load.
5. As a non-admin, Members is absent from the nav and `/settings/members`
   404s.

- [ ] **Step 9: Finish the task**

From inside the worktree run `scripts/finish-task.sh`. It rebases onto the
latest `develop`, re-runs the gates against the merged state, merges, pushes,
and removes the worktree and branch. Then write the "How to test this"
walkthrough for the user (AGENTS.md working agreement #1).

---

## Self-review notes

- **Spec coverage.** IA → Task 1; visual system → Task 1 primitives, applied in
  4/5/6/7; MCP page sections 1–7 → Task 7; revoke fix → Task 7; org rename →
  Tasks 2 + 5; appearance → Task 4; security → Task 4; danger zone (leave org)
  → Tasks 2 + 4; per-route data budget → Tasks 4–7; loading → Task 8. Delete
  account is out of scope per the spec and has no task, deliberately.
- **Type consistency.** `SettingsNavGroup` / `SettingsNavItem` are defined in
  Task 1 and consumed in the Task 1 layout. `Connection` is defined in Task 7's
  `connected-apps-list.tsx` and structurally matches `listMyConnections()`'s
  return (`id`, `clientName`, `createdAt`). `ActionResult` / `fail` are imported
  from `@/lib/actions/result` in Task 2, never re-declared.
- **Known follow-up, not in scope.** `/login` still ignores `?next=`, so the
  OAuth connect flow can't resume for a signed-out user (`src/app/api/oauth/authorize/route.ts`
  redirects with `?next=`). It is a pre-existing app-wide gap tracked in the
  north-star; it is not a settings problem and is not fixed here.
