# Ask Monolith — Full-Page Conversational AI (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Load before UI tasks:** `pulse-ui` + `frontend-design` skills (Tasks 9–11 build/style UI).
> **Spec:** `docs/superpowers/specs/2026-07-12-ask-pulse-full-page-conversational-design.md`

**Goal:** Turn the stateless "Ask Monolith" popup into a full-page `/ask` chat surface with persisted per-user cross-board conversation history, multi-turn memory (rolling summary), and token streaming — read-only (Phase 2 write actions get their own plan).

**Architecture:** New `ai_conversations` + `ai_messages` tables (owner-scoped RLS). Mutations (create/rename/delete conversation, append user message) stay Server Actions on the cookie client. The **one exception** to "Server Actions for all mutations" is the streaming completion: a session-authed Route Handler (`/api/ask`) reads the conversation, runs the existing tool-use loop in **streaming** mode via the Anthropic SDK's `.stream()`, streams NDJSON events to the client, then persists the assistant message and auto-titles the conversation. Every AI call still routes through `runAi` (metering) + `requireAiEntitlement`. Conversation switching is client state + History API (0 RSC navigations).

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions + one Route Handler), React 19, Supabase (Postgres + RLS), `@anthropic-ai/sdk` streaming, Zod, Zustand, Vitest + Testing Library, Tailwind v4 / shadcn (`pulse-ui`).

---

## Deviations from the spec (implementation refinements)

- **Owner-scoped RLS writes instead of service-client confinement.** The spec (§2) suggested confining writes like `org_ai_settings`. That confinement exists to stop admins self-granting entitlements — a privilege-escalation risk that does **not** apply to a user writing their own conversations. Conversations/messages are user-owned content (like board items), so we use **owner-scoped RLS INSERT/UPDATE/DELETE policies** (`user_id = auth.uid()`), and Server Actions + the stream route write via the cookie (RLS) client. Simpler, and RLS remains the guard.
- Everything else follows the spec.

## File structure (Phase 1)

| Path                                                      | Responsibility                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/<ts>_ai_conversations.sql`           | Two tables, owner-scoped RLS, indexes, `updated_at` trigger                                                       |
| `src/lib/ai/ask/conversations.ts`                         | Read queries: list conversations, get one, get messages (bounded)                                                 |
| `src/lib/ai/ask/conversation-actions.ts`                  | Server Actions: create / rename / delete / append user message                                                    |
| `src/lib/ai/ask/context.ts`                               | Pure context assembler + rolling-summary compaction + title generation                                            |
| `src/lib/ai/ask/ask-stream.ts`                            | Streaming tool-use loop (`.stream()`), emits text deltas                                                          |
| `src/app/api/ask/route.ts`                                | POST streaming endpoint: entitlement → stream → persist assistant msg + title                                     |
| `src/app/ask/layout.tsx`                                  | Layout B: conversation rail replaces Monolith nav; "Back to Monolith" (route lives OUTSIDE the `(app)` group — see T10) |
| `src/app/ask/page.tsx`                                    | New-chat entry                                                                                                    |
| `src/app/ask/[conversationId]/page.tsx`                   | Existing conversation (loads thread)                                                                              |
| `src/components/ai/ask/AskChat.tsx`                       | Client chat controller (thread + composer + `useAskStream`)                                                       |
| `src/components/ai/ask/ConversationRail.tsx`              | Conversation list, new/rename/delete                                                                              |
| `src/components/ai/ask/MessageList.tsx`                   | Renders messages + streaming assistant bubble                                                                     |
| `src/components/ai/ask/Composer.tsx`                      | Textarea + submit (⌘/Ctrl+Enter)                                                                                  |
| `src/components/ai/ask/use-ask-stream.ts`                 | Hook: POST `/api/ask`, read NDJSON stream                                                                         |
| `src/lib/ai/ask/stream-protocol.ts`                       | Shared NDJSON event types (`token`/`status`/`done`/`error`)                                                       |
| `src/lib/ai/ask/ai-conversations.rls.integration.test.ts` | RLS boundary test                                                                                                 |

**Removed** in Task 11: `src/components/ai/ask/AskPulse.tsx`, `AskPulseHost.tsx`, `AskPulseTrigger.tsx`, the `askPulseOpen` slice in `src/stores/ui.ts`, and their wiring in `app-shell.tsx`.

## Execution DAG (working agreement #6)

- **Task 1 (migration)** is the root — unblocks everything.
- After Task 1, two independent chains run in parallel:
  - **Data/engine chain:** 2 (RLS test) ∥ 3 (queries) → 4 (mutation actions); 5 (context, pure) → 6 (stream engine) → 7 (route) → 8 (titling wired).
  - **UI chain:** 9 (chat components) → 10 (layout B) — these consume the stream-protocol types (Task 6's `stream-protocol.ts`, extractable early) and the actions (Task 4).
- **Task 11 (nav + ⌘K + retire popup)** depends on the `/ask` route existing (Tasks 9–10).
- **Task 12** = full gate + manual-test walkthrough.
- **Critical path:** 1 → 5 → 6 → 7 → 9 → 10 → 11 → 12.

Since Tasks 3/5 and the early UI scaffolding share no files, a subagent-driven run can batch {3, 5} and later {6, 9} where dependencies allow. Serialize anything touching `src/stores/ui.ts` and `app-shell.tsx` (Task 11 only).

## Performance & data-fetching budget (working agreement #5)

Restates spec §7 as the build-time contract:

- **First paint** (`/ask` layout + page RSC): the conversation list — bounded to `CONVERSATIONS_LIMIT=100`, indexed on `(user_id, updated_at desc)` (Task 1) — plus, on `[conversationId]`, that thread's messages, bounded to `MESSAGES_LIMIT=200`, indexed on `(conversation_id, created_at)` (Task 3). Nothing else. No `select *` — both queries select explicit columns.
- **Interactions with 0 server round-trips:** in-conversation streaming appends `token` events to client state only; **starting a new chat** rewrites the URL via `window.history.pushState('/ask/[id]')` (Task 9) — no `<Link>`/router navigation, so no RSC re-run.
- **Interactions that legitimately hit the server (each loads _different_ data or mutates):** send / rename / delete are Server Actions with targeted `revalidatePath('/ask')`; the streaming completion is the one Route-Handler exception. **Switching to an existing conversation IS an RSC navigation** (`<Link href="/ask/[id]">`, Task 9) — this is allowed under #5 because it loads a _different_ conversation's server data, not a re-toggle over the same data (contrast the gotcha-09 anti-pattern). **NOTE — spec/plan divergence:** spec §1 says conversation switching is "client state + History API, NOT a router navigation"; the plan deliberately narrows that to _new chat + streaming_ and treats switching-to-another-thread as a correct RSC load. Reviewer should ratify this reading (it matches gotcha-09's actual rule).
- **Bounded model context:** the rolling summary (Task 5) caps per-turn token cost as threads grow; metering flows through the existing `runAi` chokepoint (Task 7).

---

## Task 1: Migration — `ai_conversations` + `ai_messages`

**Files:**

- Create: the migration file by **minting it via `scripts/new-migration.sh ai_conversations`** (AGENTS.md invariant — never hand-invent a `<timestamp>` stamp). The script prints the created path `supabase/migrations/<version>_ai_conversations.sql`; paste the SQL below into that file.
- Modify: `src/types/database.types.ts` (regenerate)

- [ ] **Step 1: Mint the migration file, then write the SQL**

Run `scripts/new-migration.sh ai_conversations` to mint the versioned file (do NOT hand-stamp a version). Then paste this SQL into the created file:

```sql
-- ai_conversations: one per chat thread, owned by a user, scoped to an org.
create table public.ai_conversations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  workspace_id     uuid references public.workspaces (id) on delete set null,
  title            text not null default 'New chat',
  summary          text,
  summarized_upto  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index ai_conversations_user_updated_idx
  on public.ai_conversations (user_id, updated_at desc);

alter table public.ai_conversations enable row level security;

-- Owner-scoped: a user sees/writes only their own conversations, in an org they belong to.
create policy "ai_conversations_select_own" on public.ai_conversations
  for select using (user_id = (select auth.uid()) and public.is_org_member(org_id));
create policy "ai_conversations_insert_own" on public.ai_conversations
  for insert with check (user_id = (select auth.uid()) and public.is_org_member(org_id));
create policy "ai_conversations_update_own" on public.ai_conversations
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "ai_conversations_delete_own" on public.ai_conversations
  for delete using (user_id = (select auth.uid()));

create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row execute function public.set_updated_at();

-- ai_messages: turns within a conversation. Ownership derives from the parent conversation.
create table public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.ai_conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  tool_trace       jsonb,
  created_at       timestamptz not null default now()
);

create index ai_messages_conversation_created_idx
  on public.ai_messages (conversation_id, created_at);

alter table public.ai_messages enable row level security;

create policy "ai_messages_select_own" on public.ai_messages
  for select using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));
create policy "ai_messages_insert_own" on public.ai_messages
  for insert with check (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid()) and public.is_org_member(c.org_id)
  ));
create policy "ai_messages_delete_own" on public.ai_messages
  for delete using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));
```

- [ ] **Step 2: Apply on DEV with the SAME version + name, then reconcile any drift**

Apply via `supabase-dev` MCP `apply_migration` using the **same version + name** as the file minted in Step 1 (name `ai_conversations`). Then `list_migrations` to verify the ledger matches the committed filename; if the MCP stamped its own version (known gotcha), run `scripts/reconcile-migration-version.sh` to realign. Confirm with `list_tables` that both tables + policies exist.

- [ ] **Step 3: Regenerate types**

Run `pnpm db:types` (or `supabase-dev` `generate_typescript_types`) → overwrite `src/types/database.types.ts`. Verify `Database["public"]["Tables"]["ai_conversations"]` and `ai_messages` now exist.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (types now include the new tables).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_ai_conversations.sql src/types/database.types.ts
git commit -m "feat(ai): add ai_conversations + ai_messages tables with owner-scoped rls"
```

---

## Task 2: RLS boundary integration test

Mirrors `src/lib/ai/org-ai-settings.rls.integration.test.ts` (service-role `admin` fixture client; signed-in anon clients prove RLS; `describe.skipIf(!integrationTargetReady())`).

**Files:**

- Create: `src/lib/ai/ask/ai-conversations.rls.integration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!integrationTargetReady())(
  "RLS: ai_conversations / ai_messages",
  () => {
    let admin: SupabaseClient<Database>;
    const userIds: string[] = [];

    // Helpers provisionUser()/provisionOrg() mirror org-ai-settings.rls.integration.test.ts:
    //   provisionUser -> admin.auth.admin.createUser({email,password,email_confirm:true});
    //     anon = createClient(URL,ANON); signInWithRetry(anon,{email,password}); return {id, anon}
    //   provisionOrg(u) -> u.anon.rpc("create_organization",{p_name,p_slug}) returns org id (creator=owner)

    beforeAll(async () => {
      admin = createClient<Database>(URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }, 120_000);

    afterAll(async () => {
      for (const id of userIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("a user reads and writes only their own conversations", async () => {
      const alice = await provisionUser("alice");
      userIds.push(alice.id);
      const orgA = await provisionOrg(alice);

      const ins = await alice.anon
        .from("ai_conversations")
        .insert({ org_id: orgA, user_id: alice.id, title: "Alice chat" })
        .select("id")
        .single();
      expect(ins.error).toBeNull();
      const convId = ins.data!.id;

      const bob = await provisionUser("bob");
      userIds.push(bob.id);
      // Bob cannot see Alice's conversation.
      const bobRead = await bob.anon
        .from("ai_conversations")
        .select("id")
        .eq("id", convId);
      expect(bobRead.data).toEqual([]);
      // Bob cannot insert a message into Alice's conversation.
      const bobWrite = await bob.anon
        .from("ai_messages")
        .insert({ conversation_id: convId, role: "user", content: "hi" });
      expect(bobWrite.error).not.toBeNull();
    });
  },
);
```

- [ ] **Step 2: Run it (verify it exercises RLS)**

Run: `PULSE_TEST_DB=1 pnpm test ai-conversations.rls` (or the repo's integration invocation; skips cleanly without the DEV target)
Expected: PASS against DEV (or SKIPPED when the integration target is not configured).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/ask/ai-conversations.rls.integration.test.ts
git commit -m "test(ai): rls boundary for ai_conversations and ai_messages"
```

---

## Task 3: Conversation read queries

**Files:**

- Create: `src/lib/ai/ask/conversations.ts`
- Test: `src/lib/ai/ask/conversations.test.ts`

- [ ] **Step 1: Write the failing test** (mocks the cookie client, mirrors `settings-actions.test.ts` mocking style)

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from })),
}));

import { listConversations, getMessages } from "./conversations";

beforeEach(() => from.mockReset());

describe("listConversations", () => {
  it("returns the user's conversations newest-first, bounded", async () => {
    const order = vi.fn().mockReturnValue({
      limit: vi
        .fn()
        .mockResolvedValue({ data: [{ id: "c1", title: "A" }], error: null }),
    });
    const eq = vi.fn().mockReturnValue({ order });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    const rows = await listConversations("user-1");
    expect(rows).toEqual([{ id: "c1", title: "A" }]);
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test conversations.test`
Expected: FAIL ("Cannot find module './conversations'").

- [ ] **Step 3: Implement**

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

export type ConversationRow = Pick<
  Database["public"]["Tables"]["ai_conversations"]["Row"],
  "id" | "title" | "updated_at"
>;
export type MessageRow = Pick<
  Database["public"]["Tables"]["ai_messages"]["Row"],
  "id" | "role" | "content" | "tool_trace" | "created_at"
>;

const CONVERSATIONS_LIMIT = 100;
const MESSAGES_LIMIT = 200;

export async function listConversations(
  userId: string,
): Promise<ConversationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(CONVERSATIONS_LIMIT);
  if (error) throw new Error(`listConversations: ${error.message}`);
  return data ?? [];
}

export async function getMessages(
  conversationId: string,
): Promise<MessageRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_messages")
    .select("id, role, content, tool_trace, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(MESSAGES_LIMIT);
  if (error) throw new Error(`getMessages: ${error.message}`);
  return data ?? [];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test conversations.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ask/conversations.ts src/lib/ai/ask/conversations.test.ts
git commit -m "feat(ai): conversation + message read queries"
```

---

## Task 4: Conversation mutation Server Actions

**Files:**

- Create: `src/lib/ai/ask/conversation-actions.ts`
- Test: `src/lib/ai/ask/conversation-actions.test.ts`

Actions: `createConversation({ firstMessage })` → inserts conversation + first user message, returns `{ conversationId }`; `appendUserMessage({ conversationId, content })`; `renameConversation({ conversationId, title })`; `deleteConversation({ conversationId })`. All use the cookie client (RLS), Zod at the boundary, `ActionResult<T>`, and `revalidatePath("/ask")` where a list changes.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const rpcUser = { id: "u1" };
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => rpcUser),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: vi.fn(async () => ({
    id: "org1",
    name: "O",
    timezone: "UTC",
  })),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: vi.fn(async () => [{ id: "ws1" }]),
}));
vi.mock("@/lib/workspaces/active", () => ({
  getActiveWorkspaceId: vi.fn(async () => "ws1"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const insertConv = vi.fn();
const insertMsg = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (t: string) =>
      t === "ai_conversations" ? insertConv() : insertMsg(),
  })),
}));

import { createConversation } from "./conversation-actions";

beforeEach(() => {
  insertConv.mockReset();
  insertMsg.mockReset();
});

it("createConversation inserts a conversation + first user message", async () => {
  insertConv.mockReturnValue({
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "c9" }, error: null }),
      }),
    }),
  });
  insertMsg.mockReturnValue({
    insert: vi.fn().mockResolvedValue({ error: null }),
  });

  const res = await createConversation({ firstMessage: "what is overdue?" });
  expect(res).toEqual({ ok: true, data: { conversationId: "c9" } });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test conversation-actions.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
// Canonical shared result type — never re-declare locally (AGENTS.md invariant).
import { type ActionResult, fail } from "@/lib/actions/result";

const messageSchema = z.string().trim().min(1).max(4000);
const titleSchema = z.string().trim().min(1).max(120);

export async function createConversation(input: {
  firstMessage: string;
}): Promise<ActionResult<{ conversationId: string }>> {
  const parsed = messageSchema.safeParse(input.firstMessage);
  if (!parsed.success) return fail("Message must be 1–4000 characters.");
  const user = await requireUser();
  // resolveActiveOrg() honors the org switcher — mirrors src/lib/ai/ask/actions.ts.
  // Do NOT use getUserOrgs()[0]: that picks an arbitrary first org and would
  // scope conversations/workspaces to the wrong tenant for multi-org users.
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  const workspaceId = await getActiveWorkspaceId(
    await listWorkspacesCached(org.id),
  );

  const supabase = await createClient();
  const conv = await supabase
    .from("ai_conversations")
    .insert({
      org_id: org.id,
      user_id: user.id,
      workspace_id: workspaceId,
      title: "New chat",
    })
    .select("id")
    .single();
  if (conv.error || !conv.data) return fail("Couldn't start the conversation.");

  const msg = await supabase.from("ai_messages").insert({
    conversation_id: conv.data.id,
    role: "user",
    content: parsed.data,
  });
  if (msg.error) return fail("Couldn't save your message.");

  revalidatePath("/ask");
  return { ok: true, data: { conversationId: conv.data.id } };
}

export async function appendUserMessage(input: {
  conversationId: string;
  content: string;
}): Promise<ActionResult<{ messageId: string }>> {
  const content = messageSchema.safeParse(input.content);
  const id = z.string().uuid().safeParse(input.conversationId);
  if (!content.success || !id.success) return fail("Invalid message.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_messages")
    .insert({ conversation_id: id.data, role: "user", content: content.data })
    .select("id")
    .single();
  if (error || !data) return fail("Couldn't save your message.");
  return { ok: true, data: { messageId: data.id } };
}

export async function renameConversation(input: {
  conversationId: string;
  title: string;
}): Promise<ActionResult<{ title: string }>> {
  const title = titleSchema.safeParse(input.title);
  const id = z.string().uuid().safeParse(input.conversationId);
  if (!title.success || !id.success) return fail("Invalid title.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_conversations")
    .update({ title: title.data })
    .eq("id", id.data);
  if (error) return fail("Couldn't rename the conversation.");
  revalidatePath("/ask");
  return { ok: true, data: { title: title.data } };
}

export async function deleteConversation(input: {
  conversationId: string;
}): Promise<ActionResult<Record<string, never>>> {
  const id = z.string().uuid().safeParse(input.conversationId);
  if (!id.success) return fail("Invalid conversation.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", id.data);
  if (error) return fail("Couldn't delete the conversation.");
  revalidatePath("/ask");
  return { ok: true, data: {} };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test conversation-actions.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ask/conversation-actions.ts src/lib/ai/ask/conversation-actions.test.ts
git commit -m "feat(ai): conversation mutation server actions (create/append/rename/delete)"
```

---

## Task 5: Context assembler + rolling-summary compaction (pure logic)

**Files:**

- Create: `src/lib/ai/ask/context.ts`
- Test: `src/lib/ai/ask/context.test.ts`

Two pure functions + one impure orchestrator:

- `buildAskMessages(rows: MessageRow[]): Anthropic.MessageParam[]` — map DB rows to Anthropic messages.
- `splitForCompaction(rows, keepRecent): { toFold: MessageRow[]; recent: MessageRow[] }` — decide which older turns fold into the summary.
- `composeSystem(baseSystem: string, summary: string | null): string` — append summary block to the system prompt.

Compaction and titling that call the model live here too but are exercised via DI in Task 6/8 tests.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildAskMessages, splitForCompaction, composeSystem } from "./context";

const row = (role: "user" | "assistant", content: string, i: number) => ({
  id: String(i),
  role,
  content,
  tool_trace: null,
  created_at: `2026-01-01T00:00:0${i}Z`,
});

describe("buildAskMessages", () => {
  it("maps rows to Anthropic message params in order", () => {
    const msgs = buildAskMessages([
      row("user", "hi", 1),
      row("assistant", "hello", 2),
    ]);
    expect(msgs).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
});

describe("splitForCompaction", () => {
  it("folds everything older than the most recent N, keeps N verbatim", () => {
    const rows = Array.from({ length: 14 }, (_, i) =>
      row(i % 2 ? "assistant" : "user", `m${i}`, i),
    );
    const { toFold, recent } = splitForCompaction(rows, 10);
    expect(recent).toHaveLength(10);
    expect(toFold).toHaveLength(4);
    expect(recent[0].content).toBe("m4");
  });
  it("folds nothing when at or under the budget", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row("user", `m${i}`, i));
    expect(splitForCompaction(rows, 10).toFold).toHaveLength(0);
  });
});

describe("composeSystem", () => {
  it("appends the summary block when present", () => {
    expect(composeSystem("BASE", "prior stuff")).toContain("prior stuff");
    expect(composeSystem("BASE", null)).toBe("BASE");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test context.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageRow } from "./conversations";

export const KEEP_RECENT = 10; // verbatim turns; older fold into the rolling summary

export function buildAskMessages(rows: MessageRow[]): Anthropic.MessageParam[] {
  return rows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));
}

export function splitForCompaction(
  rows: MessageRow[],
  keepRecent = KEEP_RECENT,
): {
  toFold: MessageRow[];
  recent: MessageRow[];
} {
  if (rows.length <= keepRecent) return { toFold: [], recent: rows };
  const cut = rows.length - keepRecent;
  return { toFold: rows.slice(0, cut), recent: rows.slice(cut) };
}

export function composeSystem(
  baseSystem: string,
  summary: string | null,
): string {
  if (!summary) return baseSystem;
  return `${baseSystem}\n\nConversation so far (summary of earlier turns):\n${summary}`;
}

// Impure — summarize folded turns into an updated rolling summary. Model call injected for tests.
export async function summarize(
  client: Pick<Anthropic["messages"], "create">,
  model: string,
  priorSummary: string | null,
  toFold: MessageRow[],
): Promise<{
  summary: string;
  usage: { inputTokens: number; outputTokens: number };
}> {
  const transcript = toFold.map((m) => `${m.role}: ${m.content}`).join("\n");
  const res = await client.create({
    model,
    max_tokens: 512,
    system:
      "You compress a chat transcript into a compact factual summary. Keep names, ids, decisions. No preamble.",
    messages: [
      {
        role: "user",
        content: `Prior summary:\n${priorSummary ?? "(none)"}\n\nNew turns to fold in:\n${transcript}`,
      },
    ],
  });
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");
  return {
    summary: text,
    usage: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    },
  };
}

export async function generateTitle(
  client: Pick<Anthropic["messages"], "create">,
  model: string,
  firstQuestion: string,
): Promise<{
  title: string;
  usage: { inputTokens: number; outputTokens: number };
}> {
  const res = await client.create({
    model,
    max_tokens: 24,
    system:
      "Reply with a 3–6 word title for this chat. No quotes, no punctuation at the end.",
    messages: [{ role: "user", content: firstQuestion }],
  });
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join(" ")
    .trim();
  return {
    title: text.slice(0, 120) || firstQuestion.slice(0, 60),
    usage: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test context.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ask/context.ts src/lib/ai/ask/context.test.ts
git commit -m "feat(ai): rolling-summary context assembler + summarize/title helpers"
```

---

## Task 6: Streaming tool-use loop + shared stream protocol

**Files:**

- Create: `src/lib/ai/ask/stream-protocol.ts` (shared types, importable by client)
- Create: `src/lib/ai/ask/ask-stream.ts`
- Test: `src/lib/ai/ask/ask-stream.test.ts`

Generalizes `askPulseLoop` to (a) accept a prebuilt `messages` array + `system`, and (b) **stream** text deltas via a callback. Uses `client.messages.stream(...)` and `await stream.finalMessage()` per round (the SDK exposes `.on("text", cb)` and `finalMessage()`). Tool rounds run buffered between streams; the final answer streams token-by-token.

- [ ] **Step 1: Write `stream-protocol.ts`** (no test needed — pure types/constants)

```ts
// Client-safe (no server-only). NDJSON events over the /api/ask response body.
export type AskStreamEvent =
  | { type: "token"; text: string }
  | { type: "status"; text: string }
  | {
      type: "done";
      conversationId: string;
      assistantMessageId: string;
      boardsConsulted: string[];
      title?: string;
    }
  | { type: "error"; message: string };

export function encodeEvent(e: AskStreamEvent): string {
  return JSON.stringify(e) + "\n";
}
```

- [ ] **Step 2: Write the failing test** (fake streaming client via DI)

```ts
import { describe, expect, it, vi } from "vitest";
import { askPulseStream } from "./ask-stream";

// Fake Anthropic .stream() — one round: emits two text deltas, no tool use.
function fakeClient(finalText: string) {
  return {
    messages: {
      stream: vi.fn(() => {
        const handlers: Record<string, (arg: string) => void> = {};
        const p: any = {
          on: (evt: string, cb: (arg: string) => void) => {
            handlers[evt] = cb;
            return p;
          },
          finalMessage: async () => {
            handlers["text"]?.("Hel");
            handlers["text"]?.("lo");
            return {
              stop_reason: "end_turn",
              content: [{ type: "text", text: finalText }],
              usage: { input_tokens: 5, output_tokens: 2 },
            };
          },
        };
        return p;
      }),
    },
  };
}

it("streams text deltas and returns the final answer + usage", async () => {
  const tokens: string[] = [];
  const res = await askPulseStream({
    client: fakeClient("Hello") as any,
    apiKey: "k",
    workspaceId: "ws1",
    messages: [{ role: "user", content: "hi" }],
    system: "SYS",
    emit: (e) => {
      if (e.type === "token") tokens.push(e.text);
    },
  });
  expect(tokens.join("")).toBe("Hello");
  expect(res.answer).toBe("Hello");
  expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test ask-stream.test`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement**

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/ai/providers/anthropic";
import { ASK_TOOLS, executeAskTool } from "./tools";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import type { AskStreamEvent } from "./stream-protocol";

const MAX_ROUNDS = 6;

export async function askPulseStream(args: {
  apiKey: string;
  workspaceId: string;
  messages: Anthropic.MessageParam[];
  system: string;
  emit: (e: AskStreamEvent) => void;
  client?: Anthropic;
}): Promise<{
  answer: string;
  boardsConsulted: string[];
  usage: AiUsageTokens;
}> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const messages = [...args.messages];
  const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 };
  const boards = new Set<string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let streamedText = "";
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: args.system,
      tools: ASK_TOOLS,
      messages,
    });
    stream.on("text", (t) => {
      streamedText += t;
      args.emit({ type: "token", text: t });
    });
    const final = await stream.finalMessage();
    usage.inputTokens += final.usage.input_tokens;
    usage.outputTokens += final.usage.output_tokens;

    if (final.stop_reason !== "tool_use") {
      const answer = streamedText || textOf(final.content);
      return { answer, boardsConsulted: [...boards], usage };
    }

    messages.push({ role: "assistant", content: final.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let consulted = 0;
    for (const block of final.content) {
      if (block.type !== "tool_use") continue;
      const r = await executeAskTool(block.name, block.input, {
        workspaceId: args.workspaceId,
      });
      if (r.boardId) {
        boards.add(r.boardId);
        consulted++;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: r.content,
      });
    }
    args.emit({
      type: "status",
      text: consulted
        ? `Consulting ${boards.size} board${boards.size === 1 ? "" : "s"}…`
        : "Thinking…",
    });
    messages.push({ role: "user", content: toolResults });
  }
  // Cap reached: one final buffered answer.
  const capped = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: args.system,
    messages: [
      ...messages,
      { role: "user", content: "Answer now with what you have." },
    ],
  });
  usage.inputTokens += capped.usage.input_tokens;
  usage.outputTokens += capped.usage.output_tokens;
  const answer = textOf(capped.content);
  args.emit({ type: "token", text: answer });
  return { answer, boardsConsulted: [...boards], usage };
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n");
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test ask-stream.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/ask/stream-protocol.ts src/lib/ai/ask/ask-stream.ts src/lib/ai/ask/ask-stream.test.ts
git commit -m "feat(ai): streaming tool-use loop + ndjson stream protocol"
```

---

## Task 7: Streaming Route Handler `/api/ask` (+ Task 8 titling wired here)

**Files:**

- Create: `src/app/api/ask/route.ts`
- Test: `src/app/api/ask/route.test.ts`

The **one documented exception** to "Server Actions for mutations." POST `{ conversationId }`; the user message was already persisted by Task 4's action. Handler: resolve user/org/workspace → `requireAiEntitlement(org.id, "ask_pulse")` (return 402 JSON on throw) → open a `ReadableStream` → inside `runAi`, compact if needed (Task 5 `summarize`), build context, `askPulseStream`, forward events → persist assistant message (cookie client) → if first exchange, `generateTitle` + update title → emit `done`.

- [ ] **Step 1: Write the failing test** (mock session, entitlement, engine)

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1" })),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: vi.fn(async () => ({ id: "org1" })),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: vi.fn(async () => [{ id: "ws1" }]),
}));
vi.mock("@/lib/workspaces/active", () => ({
  getActiveWorkspaceId: vi.fn(async () => "ws1"),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/gateway", () => ({
  runAi: vi.fn(
    async (_a, fn) =>
      (await fn({ apiKey: "k", adapter: { supportsTools: true } })).result,
  ),
}));
vi.mock("@/lib/ai/ask/ask-stream", () => ({
  askPulseStream: vi.fn(async ({ emit }) => {
    emit({ type: "token", text: "Hi" });
    return {
      answer: "Hi",
      boardsConsulted: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }),
}));
vi.mock("@/lib/ai/ask/conversations", () => ({
  getMessages: vi.fn(async () => [
    {
      id: "m1",
      role: "user",
      content: "hi",
      tool_trace: null,
      created_at: "t",
    },
  ]),
}));
// conversation fetch + assistant insert + title update via a chained mock client
const single = vi.fn(async () => ({ data: { id: "a1" }, error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: vi.fn(async () => ({
            data: { summary: null, summarized_upto: null },
            error: null,
          })),
        }),
      }),
      insert: () => ({ select: () => ({ single }) }),
      update: () => ({ eq: vi.fn(async () => ({ error: null })) }),
    }),
  })),
}));

import { POST } from "./route";

beforeEach(() => vi.clearAllMocks());

it("streams tokens then a done event with the assistant message id", async () => {
  const req = new Request("http://x/api/ask", {
    method: "POST",
    body: JSON.stringify({
      conversationId: "11111111-1111-1111-1111-111111111111",
    }),
  });
  const res = await POST(req);
  const text = await res.text();
  expect(text).toContain('"type":"token"');
  expect(text).toContain('"type":"done"');
  expect(text).toContain('"assistantMessageId":"a1"');
});

it("returns 402 when entitlement throws", async () => {
  const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
  (requireAiEntitlement as any).mockRejectedValueOnce(
    new Error("AiQuotaExceeded"),
  );
  const req = new Request("http://x/api/ask", {
    method: "POST",
    body: JSON.stringify({
      conversationId: "11111111-1111-1111-1111-111111111111",
    }),
  });
  const res = await POST(req);
  expect(res.status).toBe(402);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test app/api/ask/route.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { runAi } from "@/lib/ai/gateway";
import { ProviderNotCapableError } from "@/lib/ai/errors";
import { createClient } from "@/lib/supabase/server";
import { getMessages } from "@/lib/ai/ask/conversations";
import { askPulseStream } from "@/lib/ai/ask/ask-stream";
import {
  buildAskMessages,
  splitForCompaction,
  composeSystem,
  summarize,
  generateTitle,
  KEEP_RECENT,
} from "@/lib/ai/ask/context";
import { encodeEvent, type AskStreamEvent } from "@/lib/ai/ask/stream-protocol";
import { MODEL } from "@/lib/ai/providers/anthropic";

export const runtime = "nodejs";

const SYSTEM = [
  "You are Ask Pulse, a helpful analyst answering questions about the user's boards.",
  "Use the read tools to ground every claim in real data. Never fabricate.",
  "If you cannot answer from the data, say so plainly.",
].join("\n");

const bodySchema = z.object({ conversationId: z.string().uuid() });

export async function POST(req: Request) {
  const user = await requireUser();
  // Active org (org switcher), mirroring src/lib/ai/ask/actions.ts — NOT getUserOrgs()[0].
  const org = await resolveActiveOrg();
  if (!org)
    return NextResponse.json({ error: "No organization." }, { status: 400 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { conversationId } = parsed.data;

  try {
    await requireAiEntitlement(org.id, "ask_pulse");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 402 });
  }

  const supabase = await createClient();
  const workspaceId = await getActiveWorkspaceId(
    await listWorkspacesCached(org.id),
  );
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace." }, { status: 400 });

  const conv = await supabase
    .from("ai_conversations")
    .select("summary, summarized_upto")
    .eq("id", conversationId)
    .single();
  if (conv.error || !conv.data)
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 },
    );

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (e: AskStreamEvent) =>
        controller.enqueue(enc.encode(encodeEvent(e)));
      try {
        const allRows = await getMessages(conversationId);
        let summary = conv.data.summary;

        // Rolling-summary compaction of older turns.
        const { toFold, recent } = splitForCompaction(allRows, KEEP_RECENT);
        const result = await runAi(
          { orgId: org.id, userId: user.id, feature: "ask_pulse" },
          async ({ apiKey, adapter }) => {
            if (!adapter.supportsTools)
              throw new ProviderNotCapableError("ask_pulse");
            const client = new Anthropic({ apiKey });
            if (toFold.length > 0) {
              const s = await summarize(
                client.messages,
                MODEL,
                summary,
                toFold,
              );
              summary = s.summary;
              await supabase
                .from("ai_conversations")
                .update({
                  summary,
                  summarized_upto: toFold[toFold.length - 1].created_at,
                })
                .eq("id", conversationId);
            }
            const r = await askPulseStream({
              apiKey,
              workspaceId,
              client,
              messages: buildAskMessages(recent),
              system: composeSystem(SYSTEM, summary),
              emit,
            });
            return { result: r, usage: r.usage, model: MODEL };
          },
        );

        const ins = await supabase
          .from("ai_messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content: result.answer,
            tool_trace: { boardsConsulted: result.boardsConsulted },
          })
          .select("id")
          .single();

        // First exchange (1 user + this assistant) → auto-title.
        let title: string | undefined;
        if (allRows.length === 1 && allRows[0].role === "user") {
          const client = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY ?? "",
          });
          try {
            const t = await generateTitle(
              client.messages,
              MODEL,
              allRows[0].content,
            );
            title = t.title;
            await supabase
              .from("ai_conversations")
              .update({ title })
              .eq("id", conversationId);
          } catch {
            /* title is best-effort */
          }
        }

        emit({
          type: "done",
          conversationId,
          assistantMessageId: ins.data?.id ?? "",
          boardsConsulted: result.boardsConsulted,
          title,
        });
      } catch (e) {
        emit({
          type: "error",
          message: (e as Error).message || "Ask Pulse hit a snag.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test app/api/ask/route.test`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ask/route.ts src/app/api/ask/route.test.ts
git commit -m "feat(ai): streaming /api/ask route with compaction, persistence, auto-title"
```

---

## Task 8: (folded into Task 7)

Auto-titling and compaction are implemented and tested in Task 7 (title on first exchange; `summarize` on overflow). No separate task — verify the Task 7 test asserts a `title` path by adding one more case:

- [ ] **Step 1: Add a titling test case to `route.test.ts`**

```ts
it("auto-titles on the first exchange", async () => {
  const { generateTitle } = await import("@/lib/ai/ask/context");
  // getMessages already returns a single user row → first-exchange branch runs.
  const req = new Request("http://x/api/ask", {
    method: "POST",
    body: JSON.stringify({
      conversationId: "11111111-1111-1111-1111-111111111111",
    }),
  });
  const res = await POST(req);
  const text = await res.text();
  expect(text).toMatch(/"type":"done"/);
});
```

Mock `generateTitle` to return `{ title: "Overdue items", usage: {inputTokens:1,outputTokens:1} }` in the module mock and assert `text` contains `"title":"Overdue items"`.

- [ ] **Step 2: Run + Commit**

Run: `pnpm test app/api/ask/route.test` → PASS.

```bash
git add src/app/api/ask/route.test.ts
git commit -m "test(ai): assert /api/ask auto-titles the first exchange"
```

---

## Task 9: Chat UI — components + stream hook

**Files:**

- Create: `src/components/ai/ask/use-ask-stream.ts`
- Create: `src/components/ai/ask/Composer.tsx`
- Create: `src/components/ai/ask/MessageList.tsx`
- Create: `src/components/ai/ask/ConversationRail.tsx`
- Create: `src/components/ai/ask/AskChat.tsx`
- Test: `src/components/ai/ask/use-ask-stream.test.ts`, `src/components/ai/ask/AskChat.test.tsx`

**Load `pulse-ui` + `frontend-design` before styling.** Dark-first, periwinkle accent, mono kickers, radius-14, existing `Button`/`Textarea`/`Kicker` primitives. User bubbles right-aligned (`bg-muted`), assistant left-aligned; the streaming bubble appends `token` events live; a `status` line shows "Consulting N boards…".

- [ ] **Step 1: Write the failing hook test**

```ts
import { describe, expect, it, vi } from "vitest";
import { readAskStream } from "./use-ask-stream";

function ndjsonResponse(lines: string[]) {
  const body = new ReadableStream({
    start(c) {
      const e = new TextEncoder();
      for (const l of lines) c.enqueue(e.encode(l + "\n"));
      c.close();
    },
  });
  return new Response(body);
}

it("parses NDJSON events in order", async () => {
  const got: string[] = [];
  await readAskStream(
    ndjsonResponse([
      '{"type":"token","text":"Hi"}',
      '{"type":"done","conversationId":"c","assistantMessageId":"a","boardsConsulted":[]}',
    ]),
    (e) => got.push(e.type),
  );
  expect(got).toEqual(["token", "done"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test use-ask-stream.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the hook + parser**

```ts
"use client";
import { useCallback, useState } from "react";
import type { AskStreamEvent } from "@/lib/ai/ask/stream-protocol";

export async function readAskStream(
  res: Response,
  onEvent: (e: AskStreamEvent) => void,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as AskStreamEvent);
    }
  }
}

export function useAskStream() {
  const [streaming, setStreaming] = useState(false);
  const send = useCallback(
    async (conversationId: string, onEvent: (e: AskStreamEvent) => void) => {
      setStreaming(true);
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId }),
        });
        if (!res.ok) {
          onEvent({
            type: "error",
            message:
              (await res.json().catch(() => ({}))).error ?? "Request failed.",
          });
          return;
        }
        await readAskStream(res, onEvent);
      } finally {
        setStreaming(false);
      }
    },
    [],
  );
  return { streaming, send };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test use-ask-stream.test`
Expected: PASS.

- [ ] **Step 5: Implement `Composer.tsx`, `MessageList.tsx`, `ConversationRail.tsx`, `AskChat.tsx`**

`AskChat.tsx` (controller — holds messages state, calls actions + hook):

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createConversation,
  appendUserMessage,
} from "@/lib/ai/ask/conversation-actions";
import { useAskStream } from "./use-ask-stream";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import type { MessageRow } from "@/lib/ai/ask/conversations";

type UIMsg = Pick<MessageRow, "id" | "role" | "content">;

export function AskChat({
  conversationId,
  initialMessages,
}: {
  conversationId: string | null;
  initialMessages: UIMsg[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<UIMsg[]>(initialMessages);
  const [streamText, setStreamText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const { streaming, send } = useAskStream();

  async function onSubmit(text: string) {
    let convId = conversationId;
    setMessages((m) => [
      ...m,
      { id: `tmp-${Date.now()}`, role: "user", content: text },
    ]);
    if (!convId) {
      const res = await createConversation({ firstMessage: text });
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
      convId = res.data.conversationId;
      window.history.pushState(null, "", `/ask/${convId}`); // client nav — no RSC refetch
    } else {
      const res = await appendUserMessage({
        conversationId: convId,
        content: text,
      });
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
    }
    setStreamText("");
    await send(convId, (e) => {
      if (e.type === "token") setStreamText((s) => s + e.text);
      else if (e.type === "status") setStatus(e.text);
      else if (e.type === "error") setStatus(e.message);
      else if (e.type === "done") {
        setMessages((m) => [
          ...m,
          { id: e.assistantMessageId, role: "assistant", content: "" },
        ]);
        setStreamText("");
        setStatus(null);
        router.refresh(); // refresh rail (titles) once, after completion
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <MessageList
        messages={messages}
        streamingText={streaming ? streamText : null}
        status={status}
      />
      <Composer disabled={streaming} onSubmit={onSubmit} />
    </div>
  );
}
```

`MessageList.tsx`, `Composer.tsx`, `ConversationRail.tsx`: render per `pulse-ui`. Composer = `Textarea` + submit on ⌘/Ctrl+Enter (mirror `AskPulse.tsx`). ConversationRail = "New chat" button (→ `router.push("/ask")`), list of `<Link href={/ask/${id}}>` with active state, per-row rename (inline) + delete (calls the actions). **Note:** clicking a conversation IS an RSC navigation (loads that thread server-side) — acceptable and correct: it loads _different_ server data. In-conversation streaming and new-chat pushState stay client-side.

- [ ] **Step 6: Write `AskChat.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/ai/ask/conversation-actions", () => ({
  createConversation: vi.fn(async () => ({
    ok: true,
    data: { conversationId: "c1" },
  })),
  appendUserMessage: vi.fn(async () => ({
    ok: true,
    data: { messageId: "m2" },
  })),
}));
vi.mock("./use-ask-stream", () => ({
  useAskStream: () => ({
    streaming: false,
    send: vi.fn(async (_id, onEvent) => {
      onEvent({ type: "token", text: "Answer" });
      onEvent({
        type: "done",
        conversationId: "c1",
        assistantMessageId: "a1",
        boardsConsulted: [],
      });
    }),
  }),
}));

import { AskChat } from "./AskChat";

it("sends a message and renders the streamed answer", async () => {
  render(<AskChat conversationId={null} initialMessages={[]} />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "what's overdue?" },
  });
  fireEvent.keyDown(screen.getByRole("textbox"), {
    key: "Enter",
    metaKey: true,
  });
  await waitFor(() =>
    expect(screen.getByText("what's overdue?")).toBeInTheDocument(),
  );
});
```

- [ ] **Step 7: Run to verify pass**

Run: `pnpm test AskChat.test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/ai/ask/use-ask-stream.ts src/components/ai/ask/Composer.tsx src/components/ai/ask/MessageList.tsx src/components/ai/ask/ConversationRail.tsx src/components/ai/ask/AskChat.tsx src/components/ai/ask/use-ask-stream.test.ts src/components/ai/ask/AskChat.test.tsx
git commit -m "feat(ai): ask chat components + streaming client hook"
```

---

## Task 10: `/ask` route + Layout B

**Route placement (decided):** `/ask` lives **outside** the `(app)` route group — at `src/app/ask/` — because `(app)/layout.tsx` wraps every child in `AuthenticatedShell` (the Monolith sidebar nav + header), and layout B needs the _conversation rail in place of_ that nav. This mirrors the repo's own precedent: `(app)/layout.tsx` documents that `admin` and `home` "deliberately stay OUTSIDE this group." `/ask` gets its own auth-guarded layout that renders the layout-B frame. (Optional polish: reuse the header cluster — `CommandTrigger`/`ThemeToggle`/user — inside this layout for consistency; not required for v1.)

**Files:**

- Create: `src/app/ask/layout.tsx`
- Create: `src/app/ask/page.tsx`
- Create: `src/app/ask/[conversationId]/page.tsx`

- [ ] **Step 1: Implement the layout (conversation rail replaces the Monolith nav)**

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listConversations } from "@/lib/ai/ask/conversations";
import { ConversationRail } from "@/components/ai/ask/ConversationRail";

export default async function AskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const conversations = await listConversations(user.id);
  return (
    <div className="flex h-full">
      <aside className="bg-sidebar flex w-64 shrink-0 flex-col border-r">
        <Link
          href="/my-work"
          className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-4 py-3 text-sm"
        >
          <ArrowLeft className="size-4" /> Back to Pulse
        </Link>
        <ConversationRail conversations={conversations} />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
```

Because `/ask` sits outside `(app)`, it does **not** inherit `AuthenticatedShell` — this layout fully owns the frame, so the conversation rail cleanly takes the place of the Monolith nav with no route-group surgery. `requireUser()` provides the same auth guard the shell would.

- [ ] **Step 2: Implement `page.tsx` (new chat) and `[conversationId]/page.tsx`**

```tsx
// src/app/ask/page.tsx  — new chat
import { AskChat } from "@/components/ai/ask/AskChat";
export default function NewAskPage() {
  return <AskChat conversationId={null} initialMessages={[]} />;
}
```

```tsx
// src/app/ask/[conversationId]/page.tsx
import { notFound } from "next/navigation";
import { getMessages } from "@/lib/ai/ask/conversations";
import { AskChat } from "@/components/ai/ask/AskChat";

export default async function AskConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const rows = await getMessages(conversationId); // RLS: empty if not the owner
  if (rows.length === 0) notFound();
  return (
    <AskChat
      conversationId={conversationId}
      initialMessages={rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
      }))}
    />
  );
}
```

- [ ] **Step 3: Verify build + manual smoke**

Run: `pnpm build`
Expected: PASS; `/ask` compiles as a dynamic route.
Manually: sign in, visit `/ask`, ask a question, watch it stream, refresh — the conversation persists and appears in the rail.

- [ ] **Step 4: Commit**

```bash
git add src/app/ask
git commit -m "feat(ai): /ask route with layout b conversation rail"
```

---

## Task 11: Nav entry, ⌘K repoint, retire the popup

**Files:**

- Modify: `src/components/shell/sidebar-nav.tsx` (add `ASK` NavLink)
- Modify: `src/components/command-palette.tsx` (repoint Ask Monolith to `/ask`)
- Modify: `src/components/app-shell.tsx` (remove `AskPulseTrigger` + `AskPulseHost`)
- Modify: `src/stores/ui.ts` (remove `askPulseOpen` slice)
- Delete: `src/components/ai/ask/AskPulse.tsx`, `AskPulseHost.tsx`, `AskPulseTrigger.tsx` (+ their tests)
- Update any test asserting the header Ask button or the `askPulseOpen` command entry.

- [ ] **Step 1: Add the nav entry**

In `sidebar-nav.tsx`, add `Sparkles` to the `lucide-react` import and:

```ts
const ASK: NavLink = { label: "Ask Pulse", href: "/ask", icon: Sparkles };
const ALL_LINKS: NavLink[] = [HOME, ASK, ...PLANNING, ...PERSONAL, TRASH];
```

Render `<ExpandedLink item={ASK} .../>` directly under HOME in the expanded `<nav>` (match HOME's markup).

- [ ] **Step 2: Repoint ⌘K**

In `command-palette.tsx`, replace the Ask Monolith `onSelect`:

```tsx
<CommandItem onSelect={() => run(() => router.push("/ask"))}>
  <Sparkles className="size-4" /> Ask Pulse…
</CommandItem>
```

Remove the now-unused `setAskPulseOpen` reference from this file.

- [ ] **Step 3: Remove the popup wiring**

- Delete `<AskPulseTrigger />` and `<AskPulseHost />` + their imports from `app-shell.tsx`.
- Delete the three component files and their `.test.tsx`.
- Remove `askPulseOpen` + `setAskPulseOpen` from `src/stores/ui.ts` (and any type in `UIState`).

- [ ] **Step 4: Fix broken tests**

Run: `pnpm test` — update/remove tests referencing the deleted popup or store slice (e.g. an app-shell test asserting the Ask button). Grep first:

```bash
grep -rn "askPulseOpen\|AskPulseTrigger\|AskPulseHost" src
```

Expected after fixes: no references remain except the new nav/⌘K entries.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/sidebar-nav.tsx src/components/command-palette.tsx src/components/app-shell.tsx src/stores/ui.ts
git rm src/components/ai/ask/AskPulse.tsx src/components/ai/ask/AskPulseHost.tsx src/components/ai/ask/AskPulseTrigger.tsx src/components/ai/ask/AskPulse.test.tsx
git commit -m "feat(ai): promote ask pulse to /ask nav page; retire the popup"
```

---

## Task 12: Final verification + closure

- [ ] **Step 1: Run all four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 2: Manual acceptance (drives the "How to test" walkthrough)**

1. Sign in as an org member. A new **"Ask Monolith"** item appears in the sidebar (Sparkles icon) under My Work; ⌘K → "Ask Monolith…" also lands there.
2. `/ask` opens with an empty thread + composer; the left rail shows "Back to Monolith", "New chat", and (once created) past conversations.
3. Ask "what's overdue and unassigned across my boards?" → the answer **streams** token-by-token; a "Consulting N boards…" status shows during tool rounds.
4. The conversation gets an **auto-title** in the rail. Reload → the thread and title persist.
5. Ask a **follow-up** ("which of those is highest priority?") → it answers with memory of the prior turn.
6. Rename and delete a conversation from the rail; deleting removes it and its messages.
7. **Isolation:** a second user cannot open another user's `/ask/[id]` (404 via RLS).
8. **Entitlement:** set org mode to Off (Settings → AI) → asking returns a clean "AI is turned off" error, no crash. Managed with 0 credits → "used this month's allowance."

- [ ] **Step 3: Finish the branch**

Run `scripts/finish-task.sh` from the worktree (rebases onto `develop`, runs gates, merges, cleans up). Then record the ADR (`vault/decisions/…-ask-becomes-standalone-surface.md`) capturing the reversal of the "AI at the seams" stance, and update `vault/00-north-star.md` §3 + `vault/moc/platform-roadmap.md`.

---

## Self-review notes

- **Spec coverage:** layout B (T10), tables + owner-scoped RLS (T1–2), read-only reuse of `ask/tools.ts` (T6), rolling-summary multi-turn (T5+T7), streaming via route handler with mutations staying Server Actions (T4/T7), retire popup + ⌘K repoint (T11), perf budget — first paint = bounded list+thread, in-conversation streaming + new-chat via History API (T9), metering/entitlement reuse (T7). Phase 2 write actions intentionally deferred to a follow-on plan (per spec §0/§10).
- **Route placement resolved (T10):** `/ask` lives outside the `(app)` group (at `src/app/ask/`), so it owns its own frame and the conversation rail replaces the Monolith nav with no route-group surgery — matching the repo's existing precedent for `admin`/`home`. No open structural decisions remain.
- **Type consistency:** `MessageRow`/`ConversationRow` (T3) reused by T5/T9/T10; `AskStreamEvent` (T6) reused by T7/T9; `askPulseStream` signature (T6) matches its T7 call site; `ActionResult<T>` shape matches the repo convention.
