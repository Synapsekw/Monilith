# Simplified Registration + Branded Confirmation Email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce signup to email + password + org name, auto-provision the org and a default "Main" workspace at email-confirmation time, and replace Supabase's stock confirmation email with a branded MONOLITH template.

**Architecture:** Signup collects an org name and stashes it in Supabase user metadata (no session exists yet under email confirmation). The `/auth/callback` handler, after exchanging the code for a session, calls a small `provisionAccountForUser` helper that invokes a new atomic `provision_account` SECURITY DEFINER RPC (org + owner membership + "Main" workspace; idempotent). The confirmation email is a tracked Go-template HTML file wired via `supabase/config.toml`, showing a hosted PNG of the exact sidebar lockup, its URL built from GoTrue's `{{ .SiteURL }}`.

**Tech Stack:** Next.js 16 (App Router, Server Actions, Route Handlers), Supabase (`@supabase/ssr`, GoTrue email templates, Postgres migrations), Zod 4, react-hook-form, Vitest + Testing Library, Playwright (asset render only).

## Global Constraints

- Branch: work on `develop` only; never create feature branches or switch branches in this checkout.
- Server Components by default; **Server Actions for all mutations**; this is Next.js 16 — confirm any unfamiliar API against `node_modules/next/dist/docs/`.
- Validate at boundaries with **Zod**; TypeScript strict; **no `any`** (justify if ever unavoidable).
- **RLS is the security boundary**, default-deny, org-scoped. New DB functions are `SECURITY DEFINER` with `set search_path = ''` and explicit `grant execute ... to authenticated`, mirroring `create_organization`.
- Schema changes are **versioned migrations** in `supabase/migrations/`; after applying, regenerate types with `pnpm db:types` and commit `src/types/database.types.ts` in the same change.
- Org name length is **1–100 chars** (matches the `organizations.name` check constraint).
- Default workspace name is the literal **`Main`**.
- Conventional Commit messages; end every commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Verification gate for "done": `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.

## Execution DAG & Parallelization

**This plan is built to run mostly in parallel. Do not execute it top-to-bottom.** The seven tasks form four independent tracks over **disjoint file sets** (verified against the File Map — no two tracks write the same file). Only two edges are real dependencies, both genuine TypeScript type dependencies.

```
Track A (signup surface):     Task 1 ──▶ Task 2 ┐
Track B (provisioning):       Task 3 ──▶ Task 4 ┤
Track C (logo asset):         Task 5 ──────────┼──▶ Task 7 (gate)
Track D (email template):     Task 6 ──────────┘
```

| Wave       | Run concurrently               | Why this wave                                                                                                                                                            |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Wave 1** | Task 1, Task 3, Task 5, Task 6 | All four have **no** unmet dependency — dispatch as 4 parallel agents in one batch.                                                                                      |
| **Wave 2** | Task 2, Task 4                 | Task 2 needs Task 1's `orgName` type; Task 4 needs Task 3's regenerated `provision_account` RPC type. Dispatch as 2 parallel agents once Wave 1's Track A/B halves land. |
| **Wave 3** | Task 7                         | Whole-repo gate + hosted apply — must follow everything. Coordinator runs it once.                                                                                       |

**Dependency edges (the only two):**

- `Task 1 → Task 2`: the form references `SignUpInput.orgName`; without Task 1 it won't typecheck.
- `Task 3 → Task 4`: `supabase.rpc("provision_account", …)` is only typed after Task 3 regenerates `src/types/database.types.ts`.

Tasks 5 and 6 depend on **nothing** and can finish anytime before the gate. (Task 6 references the asset _path_ as a literal string, not the PNG bytes, so it does not depend on Task 5.)

**Concurrency rules for a shared checkout (important):**

- This repo is one working directory on `develop`. Parallel agents editing **disjoint** files is safe; the contention points are the **git index** and **external state**, not the files. Therefore:
  - **Parallel implementers do NOT run `git add`/`git commit`.** Each agent implements its files and runs only its own scoped `vitest run <file>` to prove green, then returns a summary. The **coordinator** performs the per-track commits sequentially (commit messages are specified in each task's final step). This avoids index-lock races.
  - Only **Track B** mutates external/shared state — `supabase db push` (linked DB) and `pnpm db:types` (rewrites the committed `database.types.ts`). No other track touches the DB or that file, so there is no cross-track race; keep Track B's two tasks in order.
  - Do **not** run whole-repo `pnpm build` / `pnpm test` / `pnpm lint` inside parallel tasks — those touch everything and would thrash. Per-task steps run only their own test file (already scoped that way). The single whole-repo gate is **Task 7**.
- **Alternative for hard isolation:** if you prefer fully independent commits, give each track its own **git worktree** (`superpowers:using-git-worktrees`) and merge to `develop` at the end. For a plan this size the shared-checkout + coordinator-commits approach above is lighter and sufficient.

## File Map

| File                                             | Change     | Responsibility                                           |
| ------------------------------------------------ | ---------- | -------------------------------------------------------- |
| `src/lib/validations/auth.ts`                    | modify     | `signUpSchema`: add required `orgName`, drop `fullName`  |
| `src/lib/validations/auth.test.ts`               | modify     | schema coverage for `orgName`                            |
| `src/app/auth/actions.ts`                        | modify     | `signUp` reads `orgName`, passes `{ org_name }` metadata |
| `src/components/auth/auth-form.tsx`              | modify     | render Org name input (signup), submit `orgName`         |
| `src/components/auth/auth-form.test.tsx`         | modify     | assert Org name field instead of Full name               |
| `supabase/migrations/<ts>_provision_account.sql` | create     | `provision_account(p_org_name)` RPC                      |
| `src/types/database.types.ts`                    | regenerate | typed `provision_account` for the RPC call               |
| `src/lib/auth/provision.integration.test.ts`     | create     | RPC behavior against the linked DB                       |
| `src/lib/auth/provision.ts`                      | create     | `provisionAccountForUser(supabase, user)` helper         |
| `src/lib/auth/provision.test.ts`                 | create     | unit test (mocked client) for the helper                 |
| `src/app/auth/callback/route.ts`                 | modify     | call the provisioning helper after code exchange         |
| `scripts/generate-email-logo.ts`                 | create     | render the lockup to a 2× PNG via Playwright             |
| `public/email/monolith-logo@2x.png`              | create     | hosted email logo asset                                  |
| `src/lib/email/logo-asset.test.ts`               | create     | asserts the PNG exists and is valid                      |
| `supabase/templates/confirmation.html`           | create     | branded confirmation email (Go template)                 |
| `supabase/config.toml`                           | modify     | wire the confirmation template                           |
| `src/lib/email/confirmation-template.test.ts`    | create     | template sanity (required tokens present)                |

---

### Task 1: Signup schema + action collect org name

**Files:**

- Modify: `src/lib/validations/auth.ts:8-19`
- Test: `src/lib/validations/auth.test.ts:35-86`
- Modify: `src/app/auth/actions.ts:50-87`

**Interfaces:**

- Produces: `signUpSchema` with shape `{ email: string; password: string; orgName: string }` and `type SignUpInput = { email: string; password: string; orgName: string }`. `fullName` is removed.
- Produces: `signUp` Server Action passes `options.data = { org_name: string }` to `supabase.auth.signUp`.

- [ ] **Step 1: Rewrite the schema tests for `orgName`**

In `src/lib/validations/auth.test.ts`, replace the entire `describe("signUpSchema", …)` block (lines 35-86) with:

```ts
describe("signUpSchema", () => {
  it("accepts a valid email, 8+ char password, and org name", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      orgName: "Acme Inc.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orgName).toBe("Acme Inc.");
    }
  });

  it("rejects an invalid email", () => {
    const result = signUpSchema.safeParse({
      email: "nope",
      password: "password123",
      orgName: "Acme",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "short",
      orgName: "Acme",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/8/);
    }
  });

  it("rejects a missing org name", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank/whitespace org name", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      orgName: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("trims the org name", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      orgName: "  Acme  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orgName).toBe("Acme");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/validations/auth.test.ts`
Expected: FAIL — current schema has no `orgName`, so "rejects a missing org name" fails and `orgName` is undefined.

- [ ] **Step 3: Update the schema**

In `src/lib/validations/auth.ts`, replace the `signUpSchema` + types (lines 8-19) with:

```ts
export const signUpSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  orgName: z
    .string()
    .trim()
    .min(1, "Organization name is required")
    .max(100, "Organization name must be 100 characters or fewer"),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/validations/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the `signUp` action**

In `src/app/auth/actions.ts`, replace the body of `signUp` from the `safeParse` call through the `signUp` call (lines 54-75) so it reads `orgName` and threads it into metadata:

```ts
const parsed = signUpSchema.safeParse({
  email: formData.get("email"),
  password: formData.get("password"),
  orgName: formData.get("orgName"),
});

if (!parsed.success) {
  return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
}

const origin = await getOrigin();
const supabase = await createClient();
const { data, error } = await supabase.auth.signUp({
  email: parsed.data.email,
  password: parsed.data.password,
  options: {
    emailRedirectTo: `${origin}/auth/callback`,
    data: { org_name: parsed.data.orgName },
  },
});
```

Leave the rest of `signUp` (the `error` check, the `data.session` redirect, and the `return { success: "check-email" }`) unchanged.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (If it flags `auth-form.tsx` referencing `fullName`, that is fixed in Task 2 — proceed; you may run typecheck again at the end of Task 2.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/validations/auth.ts src/lib/validations/auth.test.ts src/app/auth/actions.ts
git commit -m "feat(auth): collect org name at signup, drop full name

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Signup form renders the Org name field

**Files:**

- Modify: `src/components/auth/auth-form.tsx`
- Test: `src/components/auth/auth-form.test.tsx`

**Interfaces:**

- Consumes: `SignUpInput` shape `{ email; password; orgName }` from Task 1.
- Produces: signup form posts `orgName` in the `FormData` it dispatches to `signUp`.

- [ ] **Step 1: Rewrite the form tests**

Replace the whole file `src/components/auth/auth-form.test.tsx` with:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthForm } from "./auth-form";

describe("AuthForm", () => {
  it("renders email, password, and a submit button in login mode", () => {
    render(<AuthForm mode="login" />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/organization name/i),
    ).not.toBeInTheDocument();
  });

  it("renders an organization name field in signup mode", () => {
    render(<AuthForm mode="signup" />);

    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/full name/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/auth/auth-form.test.tsx`
Expected: FAIL — the form still renders "Full name", not "Organization name".

- [ ] **Step 3: Update default values**

In `src/components/auth/auth-form.tsx`, replace the `defaultValues` ternary (lines 56-58) with:

```tsx
    defaultValues: isSignup
      ? { email: "", password: "", orgName: "" }
      : { email: "", password: "" },
```

- [ ] **Step 4: Update the submit handler's FormData**

Replace the `if (isSignup && "fullName" in values …)` block (lines 91-93) with:

```tsx
if (isSignup && "orgName" in values && values.orgName) {
  formData.set("orgName", values.orgName);
}
```

- [ ] **Step 5: Replace the Full name input with an Org name input**

Replace the entire `{isSignup ? ( … ) : null}` full-name block (lines 109-125) with:

```tsx
{
  isSignup ? (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="orgName">Organization name</Label>
      <Input
        id="orgName"
        autoComplete="organization"
        placeholder="Acme Inc."
        aria-invalid={
          "orgName" in form.formState.errors && form.formState.errors.orgName
            ? true
            : undefined
        }
        {...form.register("orgName")}
      />
      {"orgName" in form.formState.errors && form.formState.errors.orgName ? (
        <p className="text-destructive text-xs">
          {form.formState.errors.orgName.message}
        </p>
      ) : null}
    </div>
  ) : null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/auth/auth-form.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no remaining `fullName` references).

- [ ] **Step 8: Commit**

```bash
git add src/components/auth/auth-form.tsx src/components/auth/auth-form.test.tsx
git commit -m "feat(auth): org name field on signup form

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `provision_account` migration + regenerated types

**Files:**

- Create: `supabase/migrations/<timestamp>_provision_account.sql`
- Regenerate: `src/types/database.types.ts`
- Test: `src/lib/auth/provision.integration.test.ts`

**Interfaces:**

- Produces: SQL function `public.provision_account(p_org_name text) returns public.organizations`. Idempotent — returns the caller's existing org if they already belong to one; otherwise creates org (slug = slugified name + 6 hex chars) + owner `org_members` row + a workspace named `Main`. Granted to `authenticated`.
- Produces: a typed RPC key `"provision_account"` in `Database` so `supabase.rpc("provision_account", { p_org_name })` typechecks in Task 4.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/<timestamp>_provision_account.sql` (use a timestamp later than the existing `20260614174043`, e.g. run `date +%Y%m%d%H%M%S` and prefix it). Contents:

```sql
-- provision_account: atomically create an org + owner membership + a default
-- "Main" workspace for the calling user, on first confirmed sign-in.
-- Idempotent: if the caller already belongs to an org, return it untouched
-- (so a re-run of the confirmation callback never double-provisions).
-- SECURITY DEFINER mirrors create_organization: bypass RLS to seed the very
-- first membership the user could not otherwise insert.
create or replace function public.provision_account(p_org_name text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
  v_existing_org_id uuid;
  v_base text;
  v_slug text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select org_id into v_existing_org_id
  from public.org_members
  where user_id = v_uid
  limit 1;

  if v_existing_org_id is not null then
    select * into v_org from public.organizations where id = v_existing_org_id;
    return v_org;
  end if;

  -- URL-safe slug: lowercase, non-alphanumerics to hyphens, trim, then a short
  -- uuid suffix for uniqueness against the organizations.slug unique constraint.
  v_base := regexp_replace(lower(coalesce(p_org_name, '')), '[^a-z0-9]+', '-', 'g');
  v_base := regexp_replace(v_base, '(^-+|-+$)', '', 'g');
  v_slug := case
    when v_base = '' then substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
    else v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
  end;

  insert into public.organizations (name, slug, created_by)
  values (p_org_name, v_slug, v_uid)
  returning * into v_org;

  insert into public.org_members (org_id, user_id, role)
  values (v_org.id, v_uid, 'owner');

  insert into public.workspaces (org_id, name, created_by)
  values (v_org.id, 'Main', v_uid);

  return v_org;
end;
$$;

grant execute on function public.provision_account(text) to authenticated;
```

- [ ] **Step 2: Apply the migration to the linked project**

Run: `pnpm exec supabase db push`
Expected: the new migration is applied (it reports the `<timestamp>_provision_account` file as applied). This is required because `db:types` reads the linked DB.

- [ ] **Step 3: Regenerate and commit types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` updates to include `provision_account` under `Functions`. Confirm with:

Run: `git diff --stat src/types/database.types.ts` (expect it changed).

- [ ] **Step 4: Write the integration test**

Create `src/lib/auth/provision.integration.test.ts` (modeled on `src/lib/supabase/rls.integration.test.ts` — same env loading and admin/anon client pattern; skips when `SUPABASE_SERVICE_ROLE_KEY` is absent):

```ts
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!SERVICE_ROLE_KEY)("provision_account", () => {
  let admin: SupabaseClient<Database>;
  let anon: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `provision-test-${randomUUID()}@example.com`;
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
    expect(createErr).toBeNull();
    createdUserIds.push(created.user!.id);

    anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await anon.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    expect(signInErr).toBeNull();
  }, 60_000);

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 60_000);

  it("creates an org, owner membership, and a Main workspace", async () => {
    const { data: org, error } = await anon.rpc("provision_account", {
      p_org_name: "Provision Test Org",
    });
    expect(error).toBeNull();
    const orgId = (org as { id: string }).id;
    expect(orgId).toBeTruthy();

    const { data: members } = await anon
      .from("org_members")
      .select("org_id, role");
    expect(members).toHaveLength(1);
    expect((members![0] as { role: string }).role).toBe("owner");

    const { data: workspaces } = await anon
      .from("workspaces")
      .select("name, org_id");
    expect(workspaces).toHaveLength(1);
    expect((workspaces![0] as { name: string }).name).toBe("Main");
    expect((workspaces![0] as { org_id: string }).org_id).toBe(orgId);
  });

  it("is idempotent — a second call returns the same org and adds nothing", async () => {
    const { data: first } = await anon.rpc("provision_account", {
      p_org_name: "Should Be Ignored",
    });
    const firstId = (first as { id: string }).id;

    const { data: again, error } = await anon.rpc("provision_account", {
      p_org_name: "Also Ignored",
    });
    expect(error).toBeNull();
    expect((again as { id: string }).id).toBe(firstId);

    const { data: orgs } = await anon.from("organizations").select("id");
    expect(orgs).toHaveLength(1);
    const { data: workspaces } = await anon.from("workspaces").select("id");
    expect(workspaces).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run the integration test**

Run: `pnpm exec vitest run src/lib/auth/provision.integration.test.ts`
Expected: PASS locally (with `.env.local` credentials). If `SUPABASE_SERVICE_ROLE_KEY` is unset it reports the suite as skipped — that is acceptable in CI but you MUST see it PASS locally before continuing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations src/types/database.types.ts src/lib/auth/provision.integration.test.ts
git commit -m "feat(auth): provision_account RPC for one-step org+workspace setup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Provision the account at the confirmation callback

**Files:**

- Create: `src/lib/auth/provision.ts`
- Test: `src/lib/auth/provision.test.ts`
- Modify: `src/app/auth/callback/route.ts`

**Interfaces:**

- Consumes: typed `supabase.rpc("provision_account", { p_org_name })` from Task 3.
- Produces: `provisionAccountForUser(supabase: SupabaseClient<Database>, user: User): Promise<void>` — no-op unless `user.user_metadata.org_name` is a non-empty string AND the user currently belongs to no org; otherwise calls the RPC.

- [ ] **Step 1: Write the helper unit test**

Create `src/lib/auth/provision.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { provisionAccountForUser } from "./provision";

function makeUser(meta: Record<string, unknown>): User {
  return { id: "u1", user_metadata: meta } as unknown as User;
}

function makeSupabase(orgs: { id: string }[]) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const limit = vi.fn().mockResolvedValue({ data: orgs, error: null });
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  const supabase = { from, rpc } as unknown as SupabaseClient<Database>;
  return { supabase, rpc, from };
}

describe("provisionAccountForUser", () => {
  it("calls provision_account when there is an org name and no org yet", async () => {
    const { supabase, rpc } = makeSupabase([]);
    await provisionAccountForUser(supabase, makeUser({ org_name: "Acme" }));
    expect(rpc).toHaveBeenCalledWith("provision_account", {
      p_org_name: "Acme",
    });
  });

  it("does nothing when the user already has an org", async () => {
    const { supabase, rpc } = makeSupabase([{ id: "org1" }]);
    await provisionAccountForUser(supabase, makeUser({ org_name: "Acme" }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does nothing when there is no org name in metadata", async () => {
    const { supabase, rpc, from } = makeSupabase([]);
    await provisionAccountForUser(supabase, makeUser({}));
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("trims the org name before passing it to the RPC", async () => {
    const { supabase, rpc } = makeSupabase([]);
    await provisionAccountForUser(supabase, makeUser({ org_name: "  Acme  " }));
    expect(rpc).toHaveBeenCalledWith("provision_account", {
      p_org_name: "Acme",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/auth/provision.test.ts`
Expected: FAIL — `./provision` does not exist yet.

- [ ] **Step 3: Implement the helper**

Create `src/lib/auth/provision.ts`:

```ts
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Create the user's organization + default "Main" workspace on first confirmed
 * sign-in. Org name is carried from signup in user metadata (`org_name`) because
 * no session exists at signup time under email confirmation. Idempotent twice
 * over: we skip when the user already belongs to an org, and the underlying
 * `provision_account` RPC also returns the existing org rather than duplicating.
 */
export async function provisionAccountForUser(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<void> {
  const orgName = user.user_metadata?.org_name;
  if (typeof orgName !== "string" || orgName.trim().length === 0) return;

  const { data: orgs } = await supabase
    .from("organizations")
    .select("id")
    .limit(1);
  if (orgs && orgs.length > 0) return;

  await supabase.rpc("provision_account", { p_org_name: orgName.trim() });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/auth/provision.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the helper into the callback**

Replace the whole contents of `src/app/auth/callback/route.ts` with:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { provisionAccountForUser } from "@/lib/auth/provision";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await provisionAccountForUser(supabase, data.user);
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
```

- [ ] **Step 6: Typecheck + run the auth tests**

Run: `pnpm typecheck && pnpm exec vitest run src/lib/auth`
Expected: PASS (the unit test passes; the integration test passes locally or skips without the service key).

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/provision.ts src/lib/auth/provision.test.ts src/app/auth/callback/route.ts
git commit -m "feat(auth): auto-provision org + Main workspace on email confirm

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Generate the hosted email logo PNG

**Files:**

- Create: `scripts/generate-email-logo.ts`
- Create: `public/email/monolith-logo@2x.png`
- Test: `src/lib/email/logo-asset.test.ts`

**Interfaces:**

- Produces: `public/email/monolith-logo@2x.png` — the exact MONOLITH lockup (the `MonolithMark` slab path `M8.6 5 15.4 3.2V20.8H8.6Z` + "MONOLITH" in Nunito 800), near-black on transparent, rendered at 2× device scale. Served by the app at `<site>/email/monolith-logo@2x.png` (referenced by Task 6).

- [ ] **Step 1: Write the asset-presence test**

Create `src/lib/email/logo-asset.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ASSET = resolve(process.cwd(), "public/email/monolith-logo@2x.png");

describe("email logo asset", () => {
  it("exists, is non-trivial, and is a real PNG", () => {
    expect(existsSync(ASSET)).toBe(true);
    const buf = readFileSync(ASSET);
    expect(buf.length).toBeGreaterThan(1000);
    // PNG magic number.
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/email/logo-asset.test.ts`
Expected: FAIL — the PNG does not exist yet.

- [ ] **Step 3: Write the generator script**

Create `scripts/generate-email-logo.ts`:

```ts
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const OUT = resolve(process.cwd(), "public/email/monolith-logo@2x.png");

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Nunito:wght@800&display=swap"
      rel="stylesheet"
    />
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
      #lockup {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px;
        color: #18181b;
      }
      #lockup svg {
        width: 28px;
        height: 28px;
        display: block;
      }
      #lockup span {
        font-family: "Nunito", sans-serif;
        font-weight: 800;
        font-size: 26px;
        letter-spacing: 0.06em;
        line-height: 1;
      }
    </style>
  </head>
  <body>
    <div id="lockup">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8.6 5 15.4 3.2V20.8H8.6Z" fill="currentColor" />
      </svg>
      <span>MONOLITH</span>
    </div>
  </body>
</html>`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$("#lockup");
  if (!el) throw new Error("lockup element not found");
  await mkdir(dirname(OUT), { recursive: true });
  await el.screenshot({ path: OUT, omitBackground: true });
  await browser.close();
  // eslint-disable-next-line no-console
  console.log("wrote", OUT);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Ensure the Chromium binary is present, then run the generator**

Run: `pnpm exec playwright install chromium`
Then run: `pnpm exec tsx scripts/generate-email-logo.ts`
Expected: prints `wrote …/public/email/monolith-logo@2x.png`. Open the PNG and confirm it shows the slab mark + "MONOLITH" wordmark, crisp, on a transparent background.

- [ ] **Step 5: Run the asset test to verify it passes**

Run: `pnpm exec vitest run src/lib/email/logo-asset.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-email-logo.ts public/email/monolith-logo@2x.png src/lib/email/logo-asset.test.ts
git commit -m "feat(email): generate hosted MONOLITH logo asset for emails

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Branded confirmation email template + wiring

**Files:**

- Create: `supabase/templates/confirmation.html`
- Modify: `supabase/config.toml` (after the commented `[auth.email.template.invite]` block, ~line 249)
- Test: `src/lib/email/confirmation-template.test.ts`

**Interfaces:**

- Consumes: the logo asset path `/email/monolith-logo@2x.png` from Task 5, resolved at send time via GoTrue's `{{ .SiteURL }}`.
- Produces: a Go-template confirmation email using `{{ .ConfirmationURL }}` for the confirm action, wired so the local Supabase stack uses it.

- [ ] **Step 1: Write the template sanity test**

Create `src/lib/email/confirmation-template.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATE = resolve(process.cwd(), "supabase/templates/confirmation.html");

describe("confirmation email template", () => {
  const html = readFileSync(TEMPLATE, "utf8");

  it("uses the GoTrue confirmation URL variable", () => {
    expect(html).toContain("{{ .ConfirmationURL }}");
  });

  it("builds the logo URL from the site URL variable", () => {
    expect(html).toContain("{{ .SiteURL }}/email/monolith-logo@2x.png");
  });

  it("carries the MONOLITH brand and a confirm action", () => {
    expect(html).toMatch(/MONOLITH/);
    expect(html.toLowerCase()).toContain("confirm");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/email/confirmation-template.test.ts`
Expected: FAIL — the template file does not exist.

- [ ] **Step 3: Write the email template**

Create `supabase/templates/confirmation.html`. Table-based layout, inline styles, light monochromatic palette (zinc), single dark action button (the MONOLITH foreground). The logo `alt` text keeps the brand name accessible when images are blocked:

```html
<!doctype html>
<html lang="en">
  <body
    style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"
  >
    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      style="background-color:#f4f4f5;padding:40px 16px;"
    >
      <tr>
        <td align="center">
          <table
            role="presentation"
            width="100%"
            cellpadding="0"
            cellspacing="0"
            style="max-width:440px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:14px;overflow:hidden;"
          >
            <tr>
              <td style="padding:32px 36px 8px 36px;">
                <img
                  src="{{ .SiteURL }}/email/monolith-logo@2x.png"
                  alt="MONOLITH"
                  width="160"
                  style="display:block;border:0;outline:none;text-decoration:none;height:auto;"
                />
              </td>
            </tr>
            <tr>
              <td style="padding:16px 36px 0 36px;">
                <h1
                  style="margin:0;font-size:20px;line-height:28px;font-weight:700;color:#18181b;"
                >
                  Confirm your email
                </h1>
                <p
                  style="margin:12px 0 0 0;font-size:15px;line-height:24px;color:#52525b;"
                >
                  You're one click away. Confirm this address to finish setting
                  up your MONOLITH account.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 36px 8px 36px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td
                      align="center"
                      style="border-radius:10px;background-color:#18181b;"
                    >
                      <a
                        href="{{ .ConfirmationURL }}"
                        target="_blank"
                        style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px;"
                        >Confirm email</a
                      >
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 36px 0 36px;">
                <p
                  style="margin:0;font-size:13px;line-height:20px;color:#71717a;"
                >
                  Or paste this link into your browser:
                </p>
                <p
                  style="margin:6px 0 0 0;font-size:13px;line-height:20px;word-break:break-all;"
                >
                  <a href="{{ .ConfirmationURL }}" style="color:#3f3f46;"
                    >{{ .ConfirmationURL }}</a
                  >
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 36px 32px 36px;">
                <hr
                  style="border:none;border-top:1px solid #e4e4e7;margin:0 0 16px 0;"
                />
                <p
                  style="margin:0;font-size:12px;line-height:18px;color:#a1a1aa;"
                >
                  If you didn't create a MONOLITH account, you can safely ignore
                  this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

- [ ] **Step 4: Run the template test to verify it passes**

Run: `pnpm exec vitest run src/lib/email/confirmation-template.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the template in `config.toml`**

In `supabase/config.toml`, directly below the commented `[auth.email.template.invite]` example (around line 249), add:

```toml
[auth.email.template.confirmation]
subject = "Confirm your email for MONOLITH"
content_path = "./supabase/templates/confirmation.html"
```

- [ ] **Step 6: Commit**

```bash
git add supabase/templates/confirmation.html supabase/config.toml src/lib/email/confirmation-template.test.ts
git commit -m "feat(email): branded MONOLITH confirmation email template

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Full verification gate + apply to the hosted project

**Files:** none (verification + ops).

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four pass. (Integration tests run against the linked project locally; without `SUPABASE_SERVICE_ROLE_KEY` they skip.)

- [ ] **Step 2: Manual local smoke (optional but recommended)**

With the app running (`pnpm dev`) and the linked Supabase project's email confirmation enabled, sign up at `/signup` with email + password + org name. Confirm the email (via the provider/Inbucket), follow the link, and verify you land in the app with an org and a "Main" workspace already present (no onboarding prompt). Confirm the email shows the MONOLITH logo.

- [ ] **Step 3: Apply auth config to the hosted project (the one manual step)**

The in-repo template + `config.toml` only auto-apply to a local stack. To update the **hosted/linked** project's "Confirm signup" template and subject, run:

Run: `pnpm exec supabase config push`
Expected: the CLI reports the auth email template/subject change applied to the linked project. (Dashboard fallback: Authentication → Emails → "Confirm signup" → paste `supabase/templates/confirmation.html`; set the subject to "Confirm your email for MONOLITH".)

Also confirm the project's **Site URL** is set to the deployed domain (Authentication → URL Configuration), so `{{ .SiteURL }}/email/monolith-logo@2x.png` resolves in delivered email. The PNG ships in `public/`, so it is live once the app deploys.

- [ ] **Step 4: Final commit (if any tracked files changed during verification)**

```bash
git status
# commit only if verification produced tracked changes (e.g. a lint autofix):
git commit -am "chore(auth): verification fixups for registration + email

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deviation from the spec

- The spec proposed a `NEXT_PUBLIC_SITE_URL` env var to build the email logo URL. This plan instead uses GoTrue's built-in **`{{ .SiteURL }}`** template variable, because the confirmation email is rendered by Supabase (not the Next app) at send time and cannot read app env. This removes the env var entirely — fewer moving parts, same result. The hosted project's Site URL (already required for redirects) is the single source of truth.

## Self-Review

- **Spec coverage:** merged 3-field signup (Tasks 1–2) ✓; default "Main" workspace (Task 3) ✓; provisioning without a session via metadata + callback RPC, no orphan orgs, idempotent (Tasks 3–4) ✓; `handle_new_user` unchanged ✓; `/onboarding` kept as untouched fallback ✓; branded email with hosted PNG lockup (Tasks 5–6) ✓; tracked template + config wiring (Task 6) ✓; one documented manual hosted step (Task 7) ✓; full test gate (every task + Task 7) ✓; logo-URL mechanism improved per Deviation note ✓.
- **Placeholder scan:** none — every code/test/SQL/HTML block is complete; `<timestamp>` in the migration filename is an explicit, instructed value (Task 3 Step 1), not a TODO.
- **Type consistency:** `provisionAccountForUser(supabase, user)` signature matches between Task 4's helper, test, and callsite; the RPC name `"provision_account"` and arg `{ p_org_name }` match across the migration (Task 3), the helper (Task 4), and both tests; `orgName` field name is consistent across schema, action, form, and FormData key.
