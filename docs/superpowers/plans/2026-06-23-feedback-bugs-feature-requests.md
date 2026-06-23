# Feedback (bugs & feature requests) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI tasks (T3, T4) additionally require the `pulse-ui` + `frontend-design` skills before styling.

**Goal:** Let any user report a bug or request a feature from a header "Feedback" popover, track their own submissions + status, and let the platform admin triage everything at `/admin/feedback` with status + a public response that notifies the submitter through the existing bell.

**Architecture:** One org-scoped `public.feedback` table (RLS: submitter reads own, platform admin reads/writes all). Mutations are Server Actions in `src/lib/feedback/actions.ts` returning the repo's `ActionResult<T>`. The admin's reply crosses the tenant boundary, so its notification insert uses the server-only service client. UI: a client `FeedbackPopover` in the header; an RSC `/admin/feedback` triage surface; a one-line extension to the notifications bell.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase (Postgres + RLS), Zod, shadcn/Radix primitives (`Popover`, `Dialog`, `Textarea`, `Button`, `DropdownMenu`), lucide-react icons, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-feedback-bugs-feature-requests-design.md`

---

## File structure

| File                                                      | Responsibility                                                                                | Task |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---- |
| `supabase/migrations/<ts>_feedback.sql`                   | `feedback` table + RLS + indexes; extend `notification_kind`; add `notifications.feedback_id` | T1   |
| `src/types/database.types.ts`                             | regenerated (never hand-edited)                                                               | T1   |
| `src/lib/validations/feedback.ts`                         | Zod schemas + inferred types                                                                  | T2   |
| `src/lib/validations/feedback.test.ts`                    | schema unit tests                                                                             | T2   |
| `src/lib/feedback/actions.ts`                             | `submitFeedback`, `listMyFeedback`, `adminUpdateFeedback`                                     | T2   |
| `src/lib/feedback/actions.test.ts`                        | action unit tests (mocked supabase)                                                           | T2   |
| `src/lib/feedback/feedback.rls.integration.test.ts`       | real-RLS integration test (skipIf no service key)                                             | T2   |
| `src/lib/feedback/queries.ts`                             | `listFeedbackPage`, `countNewFeedback` (admin reads)                                          | T4   |
| `src/components/feedback/FeedbackButton.tsx`              | header pill + popover container (client)                                                      | T3   |
| `src/components/feedback/FeedbackPopover.tsx`             | New + My requests tabs (client)                                                               | T3   |
| `src/components/feedback/SubmitFeedbackForm.tsx`          | the New-tab form (client)                                                                     | T3   |
| `src/components/feedback/MyRequestsList.tsx`              | My-requests list (client)                                                                     | T3   |
| `src/components/feedback/*.test.tsx`                      | component tests                                                                               | T3   |
| `src/components/shell/header-user-data.tsx`               | mount `<FeedbackButton/>` between bell and user menu                                          | T3   |
| `src/app/admin/feedback/page.tsx`                         | triage list (RSC)                                                                             | T4   |
| `src/app/admin/feedback/[id]/page.tsx`                    | report detail + status/response editor (RSC + client form)                                    | T4   |
| `src/components/feedback/AdminFeedbackDetail.tsx`         | status `Select` + response `Textarea` form (client)                                           | T4   |
| `src/components/platform/PlatformNav.tsx`                 | add `/admin/feedback` link + `new` badge                                                      | T4   |
| `src/components/notifications/NotificationsList.tsx`      | `feedback_response` label case                                                                | T5   |
| `src/components/notifications/NotificationsList.test.tsx` | label test                                                                                    | T5   |

No `tabs.tsx` / `select.tsx` / `badge.tsx` exist in `src/components/ui/` — tabs are a local two-button toggle with client state; the status select uses the existing `DropdownMenu`; badges are inline spans (match the `PlatformNav` `SUPER` badge style).

---

### Task T1: Schema — feedback table, RLS, notifications extensions

**Files:**

- Create: `supabase/migrations/<timestamp>_feedback.sql` (use a timestamp later than the newest existing migration; format `YYYYMMDDHHMMSS`)
- Modify (generated): `src/types/database.types.ts`

Reference conventions: `supabase/migrations/20260617110000_attachments.sql` (table + RLS), `20260619200000_org_admin_platform_console.sql` (`is_platform_admin()` is a SQL `security definer` function, callable in policies; `is_org_member(uuid)` likewise), `20260617100000_notifications.sql` (notifications schema; precedent `alter type public.notification_kind add value if not exists 'automation'`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/<timestamp>_feedback.sql`:

```sql
-- Feedback: user-submitted bugs & feature requests, triaged by the platform admin.

create table public.feedback (
  id             uuid primary key default gen_random_uuid(),
  submitted_by   uuid not null references auth.users (id),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  kind           text not null check (kind in ('bug', 'feature_request')),
  title          text not null,
  body           text not null,
  status         text not null default 'new'
                   check (status in ('new','triaged','planned','in_progress','resolved','declined')),
  admin_response text,
  responded_by   uuid references auth.users (id),
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index feedback_status_created_idx on public.feedback (status, created_at desc);
create index feedback_submitter_created_idx on public.feedback (submitted_by, created_at desc);

alter table public.feedback enable row level security;

-- Submitter reads only their own rows; the platform admin reads all.
create policy feedback_select on public.feedback
  for select to authenticated
  using (submitted_by = (select auth.uid()) or public.is_platform_admin());

-- Any active org member may submit, self-authored, within their own org.
create policy feedback_insert on public.feedback
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and public.is_org_member(org_id)
  );

-- Only the platform admin may change status / response.
create policy feedback_update on public.feedback
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy feedback_delete on public.feedback
  for delete to authenticated
  using (public.is_platform_admin());

-- Notifications: a new kind + a link column so the submitter is notified on triage.
alter type public.notification_kind add value if not exists 'feedback_response';

alter table public.notifications
  add column feedback_id uuid references public.feedback (id) on delete cascade;
```

- [ ] **Step 2: Apply the migration to the linked database**

Run: `supabase db push`
Expected: the new migration applies cleanly (no errors). If `db push` is not how this repo applies migrations, apply via the Supabase MCP `apply_migration` with the same SQL. The new enum value must not be _used_ in this same migration (it is not) — only added.

- [ ] **Step 3: Regenerate and inspect types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` now contains a `feedback` table type (Row/Insert/Update) and `notifications` Row gains `feedback_id: string | null`; `notification_kind` union includes `"feedback_response"`. Confirm with:
Run: `grep -n "feedback" src/types/database.types.ts | head`

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no consumers yet; this just proves the generated types are well-formed).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ src/types/database.types.ts
git commit -m "feat(feedback): schema, RLS, and notifications extension"
```

**Interfaces — Produces:** `public.feedback` table + RLS; `notifications.feedback_id`; `notification_kind` value `feedback_response`; regenerated DB types. **Consumes:** existing `is_platform_admin()` / `is_org_member()` SQL functions.

---

### Task T2: Server layer — validations + actions (+ notification via service client)

**Files:**

- Create: `src/lib/validations/feedback.ts`, `src/lib/validations/feedback.test.ts`
- Create: `src/lib/feedback/actions.ts`, `src/lib/feedback/actions.test.ts`
- Create: `src/lib/feedback/feedback.rls.integration.test.ts`

Reference: `src/lib/validations/org.ts` (zod style), `src/lib/org/actions.ts` (`ActionResult`, `createClient`, `getUser`, `revalidatePath`), `src/lib/collaboration/actions.ts` lines 65–76 (notifications insert shape), `src/app/auth/actions.test.ts` (mocking style), `src/lib/collaboration/notifications.rls.integration.test.ts` (integration harness, `@/test/integration-auth`).

- [ ] **Step 1: Write failing schema tests**

`src/lib/validations/feedback.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { submitFeedbackSchema, adminUpdateFeedbackSchema } from "./feedback";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("submitFeedbackSchema", () => {
  it("accepts a valid bug", () => {
    const r = submitFeedbackSchema.safeParse({
      kind: "bug",
      title: "Export crashes",
      body: "Clicking export throws.",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown kind", () => {
    const r = submitFeedbackSchema.safeParse({
      kind: "question",
      title: "x",
      body: "y",
    });
    expect(r.success).toBe(false);
  });
  it("rejects an empty title", () => {
    const r = submitFeedbackSchema.safeParse({
      kind: "bug",
      title: "",
      body: "y",
    });
    expect(r.success).toBe(false);
  });
  it("rejects an over-long title (>120)", () => {
    const r = submitFeedbackSchema.safeParse({
      kind: "feature_request",
      title: "a".repeat(121),
      body: "y",
    });
    expect(r.success).toBe(false);
  });
});

describe("adminUpdateFeedbackSchema", () => {
  it("accepts a status with an optional response", () => {
    const r = adminUpdateFeedbackSchema.safeParse({
      id: UUID,
      status: "in_progress",
      adminResponse: "Working on it.",
    });
    expect(r.success).toBe(true);
  });
  it("accepts a status with no response", () => {
    const r = adminUpdateFeedbackSchema.safeParse({
      id: UUID,
      status: "resolved",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown status", () => {
    const r = adminUpdateFeedbackSchema.safeParse({
      id: UUID,
      status: "wontfix",
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm test src/lib/validations/feedback.test.ts`
Expected: FAIL — cannot find module `./feedback`.

- [ ] **Step 3: Write the schemas**

`src/lib/validations/feedback.ts`:

```typescript
import { z } from "zod";

export const FEEDBACK_KINDS = ["bug", "feature_request"] as const;
export const FEEDBACK_STATUSES = [
  "new",
  "triaged",
  "planned",
  "in_progress",
  "resolved",
  "declined",
] as const;

export const submitFeedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  title: z.string().trim().min(1, "Add a title").max(120, "Title is too long"),
  body: z.string().trim().min(1, "Add some detail").max(2000, "Too long"),
});
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;

export const adminUpdateFeedbackSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(FEEDBACK_STATUSES),
  adminResponse: z.string().trim().max(2000).optional(),
});
export type AdminUpdateFeedbackInput = z.infer<
  typeof adminUpdateFeedbackSchema
>;
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `pnpm test src/lib/validations/feedback.test.ts`
Expected: PASS (all 7).

- [ ] **Step 5: Write failing action tests**

`src/lib/feedback/actions.test.ts` (mirrors `src/app/auth/actions.test.ts` hoisted-mock style):

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, from, serviceFrom, revalidatePath } = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  serviceFrom: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: serviceFrom }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { submitFeedback, adminUpdateFeedback } from "./actions";

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
  from.mockReset();
  serviceFrom.mockReset();
  revalidatePath.mockReset();
});

describe("submitFeedback", () => {
  it("rejects an invalid payload before touching the db", async () => {
    const r = await submitFeedback({ kind: "bug", title: "", body: "x" });
    expect(r.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts a row scoped to the caller's org", async () => {
    // membership lookup → org_id, then insert returning id
    const single = vi
      .fn()
      .mockResolvedValue({ data: { org_id: "o1" }, error: null });
    const insertSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "f1" }, error: null });
    from
      .mockReturnValueOnce({
        select: () => ({ eq: () => ({ limit: () => ({ single }) }) }),
      })
      .mockReturnValueOnce({
        insert: () => ({ select: () => ({ single: insertSingle }) }),
      });

    const r = await submitFeedback({
      kind: "bug",
      title: "Crash",
      body: "Boom",
    });
    expect(r.ok).toBe(true);
  });
});

describe("adminUpdateFeedback", () => {
  it("updates the row and notifies the submitter via the service client", async () => {
    const updateSingle = vi.fn().mockResolvedValue({
      data: { id: "f1", org_id: "o1", submitted_by: "u2" },
      error: null,
    });
    from.mockReturnValueOnce({
      update: () => ({
        eq: () => ({ select: () => ({ single: updateSingle }) }),
      }),
    });
    const notifyInsert = vi.fn().mockResolvedValue({ error: null });
    serviceFrom.mockReturnValue({ insert: notifyInsert });

    const r = await adminUpdateFeedback({ id: "f1", status: "in_progress" });
    expect(r.ok).toBe(true);
    expect(serviceFrom).toHaveBeenCalledWith("notifications");
    expect(notifyInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_id: "u2",
        actor_id: "u1",
        kind: "feedback_response",
        feedback_id: "f1",
        org_id: "o1",
      }),
    );
  });

  it("skips the notification when the admin is the submitter", async () => {
    const updateSingle = vi.fn().mockResolvedValue({
      data: { id: "f1", org_id: "o1", submitted_by: "u1" },
      error: null,
    });
    from.mockReturnValueOnce({
      update: () => ({
        eq: () => ({ select: () => ({ single: updateSingle }) }),
      }),
    });
    const r = await adminUpdateFeedback({ id: "f1", status: "resolved" });
    expect(r.ok).toBe(true);
    expect(serviceFrom).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run tests — verify they fail**

Run: `pnpm test src/lib/feedback/actions.test.ts`
Expected: FAIL — cannot find module `./actions`.

- [ ] **Step 7: Write the actions**

`src/lib/feedback/actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  submitFeedbackSchema,
  adminUpdateFeedbackSchema,
  type SubmitFeedbackInput,
  type AdminUpdateFeedbackInput,
} from "@/lib/validations/feedback";
import type { Tables } from "@/types/database.types";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

export type MyFeedback = Pick<
  Tables<"feedback">,
  | "id"
  | "kind"
  | "title"
  | "status"
  | "admin_response"
  | "responded_at"
  | "created_at"
>;

export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = submitFeedbackSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // The user's active org scopes the row (RLS also checks is_org_member).
  const { data: membership, error: memberErr } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (memberErr || !membership) return fail("No organization found.");

  const { data, error } = await supabase
    .from("feedback")
    .insert({
      submitted_by: user.id,
      org_id: membership.org_id,
      kind: parsed.data.kind,
      title: parsed.data.title,
      body: parsed.data.body,
    })
    .select("id")
    .single();
  if (error || !data) return fail("Could not submit feedback.");

  return { ok: true, data: { id: data.id } };
}

export async function listMyFeedback(): Promise<ActionResult<MyFeedback[]>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // RLS already restricts to own rows; the explicit eq keeps the index hot.
  const { data, error } = await supabase
    .from("feedback")
    .select("id, kind, title, status, admin_response, responded_at, created_at")
    .eq("submitted_by", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return fail("Could not load your requests.");

  return { ok: true, data: data ?? [] };
}

export async function adminUpdateFeedback(
  input: AdminUpdateFeedbackInput,
): Promise<ActionResult> {
  const parsed = adminUpdateFeedbackSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const patch: Partial<Tables<"feedback">> = {
    status: parsed.data.status,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.adminResponse !== undefined) {
    patch.admin_response = parsed.data.adminResponse;
    patch.responded_by = user.id;
    patch.responded_at = new Date().toISOString();
  }

  // RLS gates this update to platform admins.
  const { data: row, error } = await supabase
    .from("feedback")
    .update(patch)
    .eq("id", parsed.data.id)
    .select("id, org_id, submitted_by")
    .single();
  if (error || !row) return fail("Could not update feedback.");

  // Notify the submitter via the service client: the platform admin is not a
  // member of the submitter's org, so the notifications-insert RLS policy would
  // block a normal insert. Skip self-notification.
  if (row.submitted_by !== user.id) {
    const service = createServiceClient();
    await service.from("notifications").insert({
      org_id: row.org_id,
      recipient_id: row.submitted_by,
      actor_id: user.id,
      kind: "feedback_response",
      feedback_id: row.id,
    });
  }

  revalidatePath("/admin/feedback");
  return { ok: true, data: undefined };
}
```

- [ ] **Step 8: Run tests — verify they pass**

Run: `pnpm test src/lib/feedback/actions.test.ts`
Expected: PASS (4).

- [ ] **Step 9: Write the RLS integration test**

`src/lib/feedback/feedback.rls.integration.test.ts` — adapt `src/lib/collaboration/notifications.rls.integration.test.ts` (same `config`, `makeUser`, service `admin`, `skipIf(!SERVICE_ROLE_KEY)`). Cover:

```text
- a member can insert their own feedback (submitted_by = self) and read it back;
- a second member CANNOT read the first member's feedback (0 rows);
- a non-admin UPDATE of someone's feedback is rejected / affects 0 rows;
- after the service client (admin harness) marks a user as platform admin and
  updates the row, the submitter has a notification with kind 'feedback_response'
  and feedback_id = the row id.
```

Write it concretely against the harness helpers (create org via service client, add members through `org_members`, insert a `platform_admins` row for the admin user). Keep assertions on `.error` / returned rows as in the reference file.

- [ ] **Step 10: Run the integration test**

Run: `pnpm test src/lib/feedback/feedback.rls.integration.test.ts`
Expected: PASS when `SUPABASE_SERVICE_ROLE_KEY` is set (else the suite is skipped — that is acceptable locally but must pass in an env that has the key).

- [ ] **Step 11: Commit**

```bash
git add src/lib/validations/feedback.ts src/lib/validations/feedback.test.ts src/lib/feedback/
git commit -m "feat(feedback): zod schemas + submit/list/admin-update server actions"
```

**Interfaces — Consumes:** T1 types/table, `@/lib/supabase/service`. **Produces:** `submitFeedback`, `listMyFeedback` (→ `MyFeedback[]`), `adminUpdateFeedback`.

---

### Task T3: User popover surface (header)

**Files:**

- Create: `src/components/feedback/FeedbackButton.tsx`, `FeedbackPopover.tsx`, `SubmitFeedbackForm.tsx`, `MyRequestsList.tsx`, and a `*.test.tsx`
- Modify: `src/components/shell/header-user-data.tsx` (mount the button between `<NotificationsBell/>` and `<UserMenu/>`)

Load `pulse-ui` + `frontend-design` skills first. Reference: `src/components/ui/popover.tsx` (`Popover`/`PopoverTrigger`/`PopoverContent`), `src/components/ui/textarea.tsx`, `src/components/ui/button.tsx`, lucide `Megaphone`, the `NewBoardDialog.tsx` import style.

- [ ] **Step 1: Failing test for the form**

`src/components/feedback/SubmitFeedbackForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SubmitFeedbackForm } from "./SubmitFeedbackForm";

describe("SubmitFeedbackForm", () => {
  it("calls submit with the chosen kind and trimmed text, then fires onDone", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, data: { id: "f1" } });
    const onDone = vi.fn();
    render(<SubmitFeedbackForm submit={submit} onDone={onDone} />);

    fireEvent.change(screen.getByPlaceholderText(/title/i), {
      target: { value: "Export crashes" },
    });
    fireEvent.change(screen.getByPlaceholderText(/what happened/i), {
      target: { value: "Boom" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        kind: "bug",
        title: "Export crashes",
        body: "Boom",
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("shows the error and does not call onDone when submit fails", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: false, error: "Nope" });
    const onDone = vi.fn();
    render(<SubmitFeedbackForm submit={submit} onDone={onDone} />);
    fireEvent.change(screen.getByPlaceholderText(/title/i), {
      target: { value: "x" },
    });
    fireEvent.change(screen.getByPlaceholderText(/what happened/i), {
      target: { value: "y" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText("Nope")).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
  });
});
```

> The form takes `submit`/`onDone` as props so it is testable without mocking the server action module. `FeedbackPopover` passes the real `submitFeedback` action in.

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm test src/components/feedback/SubmitFeedbackForm.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SubmitFeedbackForm`**

`src/components/feedback/SubmitFeedbackForm.tsx` — client component: a Bug/Feature two-button toggle (local state, default `bug`), a title `Input`, a body `Textarea` (placeholder "What happened, or what you'd like to see…"), a `Button` "Submit". On submit: `const r = await submit({ kind, title, body })`; on `r.ok` call `onDone(r.data.id)`; else `setError(r.error)`. Disable the button while pending. Props:

```tsx
type Props = {
  submit: (input: {
    kind: "bug" | "feature_request";
    title: string;
    body: string;
  }) => Promise<
    { ok: true; data: { id: string } } | { ok: false; error: string }
  >;
  onDone: (id: string) => void;
};
```

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm test src/components/feedback/SubmitFeedbackForm.test.tsx`
Expected: PASS (2).

- [ ] **Step 5: Implement `MyRequestsList`, `FeedbackPopover`, `FeedbackButton`**

- `MyRequestsList.tsx` (client): props `{ load: () => Promise<ActionResult<MyFeedback[]>> }`. `useEffect` on first mount calls `load()`, renders a skeleton while pending, then each request as a row: title, a status pill (map status→label/colour), and `admin_response` beneath when present. Empty state: "No requests yet."
- `FeedbackPopover.tsx` (client): wraps shadcn `Popover`. Local `tab` state (`"new" | "mine"`) rendered as a two-button toggle header. `new` → `<SubmitFeedbackForm submit={submitFeedback} onDone={() => setTab("mine")} />` (importing the real action). `mine` → `<MyRequestsList load={listMyFeedback} />`. After a successful submit it flips to `mine`, which re-fetches.
- `FeedbackButton.tsx` (client): the `PopoverTrigger` is the accent "Feedback" pill — `<Button variant="ghost" size="sm">` with `<Megaphone className="size-4" />` + "Feedback", styled with the accent highlight (follow `pulse-ui`). `PopoverContent` renders `<FeedbackPopover/>`.

- [ ] **Step 6: Mount in the header**

Modify `src/components/shell/header-user-data.tsx` — add `<FeedbackButton />` between `<NotificationsBell .../>` and `<UserMenu .../>`:

```tsx
return (
  <>
    <NotificationsBell userId={user.id} />
    <FeedbackButton />
    <UserMenu
      user={{ email: user.email, full_name: fullName }}
      isPlatformAdmin={platformAdmin}
    />
  </>
);
```

- [ ] **Step 7: Run the focused tests + typecheck**

Run: `pnpm test src/components/feedback/`
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/feedback/ src/components/shell/header-user-data.tsx
git commit -m "feat(feedback): header Feedback popover with New + My requests tabs"
```

**Interfaces — Consumes:** `submitFeedback`, `listMyFeedback`, `MyFeedback`.

---

### Task T4: Admin triage surface

**Files:**

- Create: `src/lib/feedback/queries.ts`, `src/app/admin/feedback/page.tsx`, `src/app/admin/feedback/[id]/page.tsx`, `src/components/feedback/AdminFeedbackDetail.tsx`, `src/components/feedback/AdminFeedbackDetail.test.tsx`
- Modify: `src/components/platform/PlatformNav.tsx`

Load `pulse-ui` + `frontend-design` first. Reference: `src/app/admin/organizations/page.tsx` (RSC list shape, `searchParams` Promise, grid, pagination), `src/app/admin/layout.tsx` (`requirePlatformAdmin()` already gates the whole subtree), `src/lib/platform/queries.ts` (query module pattern), `PlatformNav.tsx` `LINKS` array.

- [ ] **Step 1: Write the admin queries**

`src/lib/feedback/queries.ts` (server-only reads; RLS lets the platform admin read all rows):

```typescript
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

const PAGE_SIZE = 50;

export async function listFeedbackPage(opts?: {
  page?: number;
}): Promise<{ rows: Tables<"feedback">[]; hasMore: boolean }> {
  const page = Math.max(0, opts?.page ?? 0);
  const supabase = await createClient();
  const from = page * PAGE_SIZE;
  const { data } = await supabase
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE); // one extra row signals "more"
  const rows = data ?? [];
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export async function countNewFeedback(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  return count ?? 0;
}

export async function getFeedback(
  id: string,
): Promise<Tables<"feedback"> | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("feedback")
    .select("*")
    .eq("id", id)
    .single();
  return data ?? null;
}
```

- [ ] **Step 2: Build the list page (RSC)**

`src/app/admin/feedback/page.tsx` — async RSC. Calls `listFeedbackPage({ page })` (read `page` from `searchParams`). Render a grid like `organizations/page.tsx`: columns kind, title, submitter/created, status pill. Each row links to `/admin/feedback/[id]`. **Kind/status filtering is client state + the History API over the already-loaded page — no new RSC navigation** (extract a small client `FeedbackFilters` if needed; do not turn filters into `<Link>`s). Pagination (older rows) uses a real `?page=` link.

- [ ] **Step 3: Failing test for the detail editor**

`src/components/feedback/AdminFeedbackDetail.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminFeedbackDetail } from "./AdminFeedbackDetail";

const row = {
  id: "f1",
  kind: "bug",
  title: "Export crashes",
  body: "Boom",
  status: "new",
  admin_response: null,
} as never;

describe("AdminFeedbackDetail", () => {
  it("submits the selected status + response via the action", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    render(<AdminFeedbackDetail row={row} save={save} />);
    fireEvent.change(screen.getByPlaceholderText(/response/i), {
      target: { value: "Fixed today" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ id: "f1", adminResponse: "Fixed today" }),
      ),
    );
  });
});
```

- [ ] **Step 4: Run — verify it fails**

Run: `pnpm test src/components/feedback/AdminFeedbackDetail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement detail page + editor**

- `AdminFeedbackDetail.tsx` (client): props `{ row: Tables<"feedback">; save: (i: AdminUpdateFeedbackInput) => Promise<ActionResult> }`. Shows title/body/submitter/created; a status picker via the existing `DropdownMenu` over `FEEDBACK_STATUSES` (default = `row.status`); a response `Textarea` (placeholder "Public response…", default `row.admin_response ?? ""`); a "Save" `Button`. On save: `await save({ id: row.id, status, adminResponse })`; show a saved/Error state.
- `src/app/admin/feedback/[id]/page.tsx` (RSC): `await getFeedback(id)`; 404 via `notFound()` if null; render `<AdminFeedbackDetail row={row} save={adminUpdateFeedback} />` (pass the server action straight in).

- [ ] **Step 6: Run — verify it passes**

Run: `pnpm test src/components/feedback/AdminFeedbackDetail.test.tsx`
Expected: PASS.

- [ ] **Step 7: Add the nav item + badge**

Modify `src/components/platform/PlatformNav.tsx`: add `{ href: "/admin/feedback", label: "Feedback", icon: MessageSquare }` to `LINKS` (import `MessageSquare` from lucide). Thread a `newCount` prop (computed by the nav's data source via `countNewFeedback()`); when `> 0`, render the inline badge span (reuse the `SUPER` badge styling) showing the count next to the Feedback link.

- [ ] **Step 8: Run gates for the slice**

Run: `pnpm test src/components/feedback/ && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/feedback/queries.ts src/app/admin/feedback/ src/components/feedback/AdminFeedbackDetail.tsx src/components/feedback/AdminFeedbackDetail.test.tsx src/components/platform/PlatformNav.tsx
git commit -m "feat(feedback): /admin/feedback triage list, detail editor, nav badge"
```

**Interfaces — Consumes:** `adminUpdateFeedback`, `FEEDBACK_STATUSES`, `countNewFeedback`.

---

### Task T5: Notifications bell rendering

**Files:**

- Modify: `src/components/notifications/NotificationsList.tsx`
- Create: `src/components/notifications/NotificationsList.test.tsx`

- [ ] **Step 1: Failing test**

`src/components/notifications/NotificationsList.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotificationsList } from "./NotificationsList";

describe("NotificationsList", () => {
  it("labels a feedback_response notification", () => {
    const n = { id: "n1", kind: "feedback_response", read_at: null } as never;
    render(<NotificationsList notifications={[n]} onOpen={vi.fn()} />);
    expect(screen.getByText(/feedback request/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm test src/components/notifications/NotificationsList.test.tsx`
Expected: FAIL — current default label is "updated an item you follow", no match for /feedback request/i.

- [ ] **Step 3: Add the case**

In `src/components/notifications/NotificationsList.tsx`, extend `label()`:

```tsx
function label(n: AppNotification): string {
  switch (n.kind) {
    case "mention":
      return "mentioned you in an update";
    case "assigned":
      return "assigned you to an item";
    case "automation":
      return "an automation ran on an item";
    case "feedback_response":
      return "updated your feedback request";
    default:
      return "updated an item you follow";
  }
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm test src/components/notifications/NotificationsList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/notifications/NotificationsList.tsx src/components/notifications/NotificationsList.test.tsx
git commit -m "feat(feedback): render feedback_response notifications in the bell"
```

**Interfaces — Consumes:** T1 `feedback_response` kind.

---

## Final verification (before finish-task)

- [ ] Run the full gate suite from the worktree:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four PASS. Then close out with `scripts/finish-task.sh` (rebases onto develop, re-runs gates, merges, cleans up) and write the "How to test" walkthrough (already drafted in the spec).

---

## Execution DAG

- **Batch 1:** T1 (schema) — foundation.
- **Batch 2 (parallel):** T2 (server layer) ‖ T5 (bell label) — disjoint files, both need only T1.
- **Batch 3 (parallel):** T3 (header popover) ‖ T4 (admin surface) — both need T2, disjoint files.
- **Critical path:** T1 → T2 → (T3 ‖ T4), depth 3.

When running ≥2 tasks in a batch concurrently, give each its own worktree per working-agreement #1/#6. Within this single `task/feedback` worktree, a subagent-driven session executes the tasks in DAG order (T1 → {T2,T5} → {T3,T4}); the parallelism is an optimization, and correctness only requires the ordering.

---

## Self-review

- **Spec coverage:** audience/RLS (T1), text-only capture (T2/T3), status lifecycle + public response (T1/T2/T4), My-requests loop (T3), header pill (T3), admin triage + nav badge (T4), bell notification incl. cross-tenant service-client insert (T2) + rendering (T5), performance budget (T3 lazy load, T4 client-state filters, indexed reads) — all mapped to tasks.
- **Type consistency:** `submitFeedback`/`listMyFeedback`/`adminUpdateFeedback`, `MyFeedback`, `AdminUpdateFeedbackInput`, `FEEDBACK_STATUSES`, `feedback_response`, `notifications.feedback_id` are used identically across T1–T5.
- **No placeholders:** every code step carries real code; the two reads that depend on existing files (RLS integration harness in T2 step 9, list-page grid in T4 step 2) reference the exact file to mirror and the concrete behaviours to assert.
