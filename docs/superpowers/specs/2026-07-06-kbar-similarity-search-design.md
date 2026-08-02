---
type: spec
status: awaiting-review
date: 2026-07-06
feature: kbar-similarity-search
tags: [project/monolith, spec, search, command-palette, migration-gated]
related:
  - "[[00-north-star]]"
  - "docs/superpowers/plans/2026-07-06-kbar-similarity-search.md"
---

# Similarity-ranked ⌘K command-palette search — design

> **Status:** spec written, awaiting review. Migration-gated deferral queued in the north-star §3.
> This is a scope-only document. No source has been written.

## 1. Problem

The ⌘K command palette's global item search (`src/lib/search/item-search.ts` → `searchItems`)
currently does a plain case-insensitive **substring contains** match:

```ts
.ilike("name", `%${escapeLikePattern(query)}%`)
.order("updated_at", { ascending: false })
.limit(25)
```

Two weaknesses:

1. **No typo tolerance.** `desing` finds nothing even though the user obviously means `Design`.
   ILIKE is exact-substring only.
2. **Recency is not relevance.** Results are ordered purely by `updated_at desc`, so a marginal
   substring hit on a recently-touched item outranks a much stronger name match on an older item.
   For a search box the user expects _best name match first_, not _most-recently-edited first_.

The `pg_trgm` extension and the `items_name_trgm_idx` GIN trigram index **already exist**
(migration `20260702120000_perf_set_based_rls_and_indexes.sql`), added originally to keep the
leading-wildcard ILIKE indexed. That index also supports trigram **similarity** operators — so we
can add fuzzy, relevance-ranked search with **no new table, column, or index**, only a new RPC and
a one-file lib swap.

## 2. Goals & non-goals

**Goals**

- Fuzzy, **typo-tolerant** item search in ⌘K (`desing` → `Design spec`).
- **Relevance-ranked** results: exact substring matches first, then trigram similarity, with
  recency only as a final tie-break.
- **No regression** on today's behaviour: every item that the current ILIKE match would return
  must still be returned (so the change is strictly additive for the exact-match case).
- Keep the read a **bounded, indexed, hot-path** query — the GIN trigram index must be used, the
  result set capped, and the ⌘K first-paint cost unchanged (search still fires only on debounced
  2+ char input).
- RLS still scopes results to items on boards the caller can read — **no cross-tenant leakage**.

**Non-goals (YAGNI for this slice)**

- **No UI change.** `CommandPalette` and `CommandPaletteData` already call `searchItems(term)` and
  render `ItemSearchResult[]`. The lib keeps the same signature and return shape, so the components
  are untouched (confirmed by reading both — see §6).
- **No search over other entity types.** Boards, dashboards, and workspaces are already loaded
  into the palette client-side and filtered locally by cmdk; they don't round-trip. Extending the
  RPC to boards/dashboards is noted as a future extension, not built here.
- **No new search surface / results page.** This is the existing ⌘K "Items" group only.
- **No full-text search (`tsvector`).** Trigram similarity is the right tool for short,
  name-shaped queries with typos; FTS is a heavier, different feature.

## 3. Approaches considered

**A — Pure `word_similarity` ranking (fuzzy only).** Replace ILIKE with
`WHERE query <% name ORDER BY word_similarity(query, name) DESC`. Clean and fully fuzzy.
_Rejected:_ it can **regress** on short/exact substrings. `word_similarity('desing','Design spec')`
measured at **0.571** on the live dev DB — _below_ pg_trgm's default `word_similarity_threshold`
of **0.6** — so even the motivating typo would be filtered out at defaults, and 2–3 char queries
(dominated by trigram padding) match weakly. Dropping the guaranteed-substring branch is a
correctness risk.

**B — Hybrid: index-assisted `ILIKE` OR `word_similarity`, ranked (RECOMMENDED).** Keep the ILIKE
contains branch (guarantees today's matches) **and** add a `word_similarity` branch (adds typo
tolerance), unioned in one `WHERE`, then rank in a `Sort` node: exact-contains first, then
similarity, then recency. Verified on the live dev DB that **both** branches use the existing GIN
index via a `BitmapOr` of two `Bitmap Index Scan`s (see §5). Best relevance, no regression, index
stays hot. **Chosen.**

**C — Switch the index to GiST for KNN `<->` ordering.** GiST supports index-assisted
`ORDER BY name <-> query` (nearest-neighbour). _Rejected:_ it needs a **new index** (GiST trgm),
GIN is faster for our search-heavy / write-light shape, and KNN ordering can't express the
"exact-contains-first" tie-break we want. The brief also says "no new index"; approach B reuses the
GIN index we already have.

## 4. Design (approach B)

### 4.1 The RPC — `public.search_items(p_query text, p_limit int)`

A new SQL function added in a versioned migration. Properties:

- **`SECURITY INVOKER`** (the Postgres default, stated explicitly). The function reads `public.items`
  and joins `public.boards`; running as the _caller_ means the existing RLS SELECT policies on both
  tables apply, so results are org-scoped to boards the caller can read. This is the security
  boundary — the RPC adds **no** privilege. (Contrast the repo's `SECURITY DEFINER` helpers such as
  `readable_board_ids()`, which deliberately bypass RLS to _evaluate_ policies; a search that
  _returns rows_ must not.)
- **`STABLE`**, `LANGUAGE sql`, and pinned `SET search_path = ''` so every object is
  schema-qualified (`public.items`, `public.boards`) and pg_trgm's operators/functions resolve from
  the `extensions` schema regardless of the caller's search_path. pg_trgm is installed in
  `extensions` (confirmed live).
- Function-local **`SET pg_trgm.word_similarity_threshold = '0.3'`** — lowers the fuzzy cutoff from
  the 0.6 default so real typos pass (the 0.571 case above), while unrelated text still scores 0.0
  (`word_similarity('xyz','Design spec') = 0.000`, confirmed live). See §4.4 for the threshold
  rationale.
- Signature: `p_query text`, `p_limit int default 25`.
- Returns `TABLE (id uuid, name text, board_id uuid, board_name text, rank real)`. `rank` is the
  `word_similarity` score; the lib ignores it, but returning it makes the ranking-quality test and
  future debugging trivial.

**Body (illustrative — final SQL lives in the plan, Task 0):**

```sql
create or replace function public.search_items(
  p_query text,
  p_limit int default 25
)
returns table (id uuid, name text, board_id uuid, board_name text, rank real)
language sql
security invoker
stable
set search_path = ''
set pg_trgm.word_similarity_threshold = '0.3'
as $$
  select
    i.id,
    i.name,
    i.board_id,
    b.name as board_name,
    extensions.word_similarity(p_query, i.name) as rank
  from public.items i
  join public.boards b on b.id = i.board_id
  where i.name operator(extensions.%>) p_query          -- fuzzy branch (GIN)
     or i.name ilike '%' || public.escape_like(p_query) || '%'  -- exact-contains branch (GIN)
  order by
    (i.name ilike '%' || public.escape_like(p_query) || '%') desc,  -- exact contains first
    extensions.word_similarity(p_query, i.name) desc,               -- then best fuzzy match
    i.updated_at desc,                                              -- then recency
    i.id                                                            -- stable final tie-break
  limit least(greatest(p_limit, 1), 50);
$$;
```

Notes locked in for the plan:

- **LIKE-wildcard escaping moves into SQL.** Today the lib builds the escaped `%…%` pattern; with
  the RPC the raw query is a bound parameter and the _function_ must escape `%`, `_`, `\` before
  interpolating into the ILIKE pattern (else a query of `50%` over-matches). The plan adds a tiny
  `public.escape_like(text)` immutable helper (or inlines `replace(...)` three times) — the escaping
  logic is identical to the current `escapeLikePattern` in the lib. The `%>` operator branch takes
  the **raw** query (operators don't use LIKE metacharacters), so it is unaffected.
- **`operator(extensions.%>)`** is the schema-qualified word-similarity operator. `name %> query`
  ≡ `word_similarity(query, name) > threshold` ≡ "the query, as a set of trigrams, matches a word
  within name". Schema-qualifying is required under `search_path = ''` and is how the existing
  migration resolves the trgm opclass.
- **`least(greatest(p_limit,1),50)`** clamps the cap to a sane 1–50 window even though the lib will
  always pass 25; belt-and-suspenders against a bad caller.
- Grants mirror the other authenticated-callable functions:
  `revoke execute … from public; grant execute … to authenticated, service_role;`

### 4.2 The lib — `src/lib/search/item-search.ts`

`searchItems(query: string): Promise<ItemSearchResult[]>` keeps its exact public contract. Internals:

1. Validate at the boundary with the **existing** Zod schema (`query` trimmed, `min(2)`, `max(100)`)
   — unchanged; sub-threshold queries still return `[]` with **zero** round-trips.
2. Swap the `.from("items").select(...).ilike(...).order(...).limit(...)` chain for a single typed
   `supabase.rpc("search_items", { p_query: parsed.data.query, p_limit: LIMIT })`.
3. Map rows to `ItemSearchResult` (`id, name, boardId, boardName`) — drop `rank`.
4. On error return `[]` (unchanged fail-soft posture, so the palette never throws).

`escapeLikePattern` is **deleted from the lib** (escaping now lives in SQL). `ItemSearchResult` and
`LIMIT = 25` stay.

### 4.3 Empty / short / whitespace query behaviour

Unchanged and enforced in three places, defence-in-depth:

- **Client** (`command-palette.tsx`): `MIN_QUERY = 2`; the Items group is hidden and no request is
  issued below 2 chars.
- **Lib Zod boundary**: `min(2)` / `max(100)` → `[]`, no round-trip.
- Empty string never reaches the RPC.

### 4.4 Ranking & threshold — decisions (evidence-based)

Measured on the live dev DB (252 items):

| query           | name              | `word_similarity`      |
| --------------- | ----------------- | ---------------------- |
| `design`        | `Design spec`     | **1.000** (exact word) |
| `desing` (typo) | `Design spec`     | **0.571**              |
| `road`          | `Product Roadmap` | **0.800**              |
| `proj`          | `Project Alpha`   | **0.800**              |
| `xyz` (noise)   | `Design spec`     | **0.000**              |

- **Ranking function: `word_similarity`** (not `similarity`). `similarity()` compares the _whole_
  strings, penalising long item names for a short query (`similarity('design','Design spec')` is
  low because "spec" dilutes it). `word_similarity()` measures the best-matching _extent_ within
  the name — exactly "did the user type part of this item's name?", which is the command-palette
  intent. Non-strict (`word_similarity`, not `strict_word_similarity`) so partial-word prefixes
  like `proj` still match.
- **Threshold: `0.3`.** The typo case scores 0.571, so 0.6 (default) is too strict; 0.3 clears the
  typo comfortably while noise stays at 0.0. 0.3 is also pg_trgm's canonical `similarity` default,
  a well-understood value.
- **Tie-break order:** (1) exact substring contains, (2) `word_similarity` desc, (3) `updated_at`
  desc (recency), (4) `id` (stable, so pagination/tests are deterministic). Recency is demoted to a
  tie-break, directly fixing weakness #2.
- **Typo tolerance is bounded by the ILIKE branch.** Even when a very short query's
  `word_similarity` dips under 0.3, the ILIKE-contains branch still returns every exact substring
  hit — so the feature is a strict **superset** of today's matches.

## 5. Performance & data-fetching budget

This is a hot ⌘K path; the budget is explicit (working-agreement rule #5).

- **First paint of ⌘K: 0 new server round-trips for search.** The palette data (boards/dashboards/
  workspaces) is already streamed by `CommandPaletteData` behind its own `<Suspense>`; search only
  fires on user input. Unchanged.
- **Per interaction: exactly 1 bounded RPC round-trip, debounced.** `command-palette.tsx` debounces
  200 ms, gates on `MIN_QUERY = 2`, and drops out-of-order responses via a `requestId` ref. Each
  fired search is a single `rpc("search_items")` returning ≤ 25 rows. No change to the round-trip
  count or shape.
- **This is a legitimate server read, not a view toggle.** Rule #5(b) reserves round-trips for
  server-data changes and pushes _in-page toggles over already-loaded data_ to client state + the
  History API. Search is neither a toggle nor over already-loaded data — the full item corpus is
  not on the client — so a debounced server read per query is correct. It is a `"use server"`
  Server Action invoked from a client component (the existing pattern), **not** an RSC
  `<Link>`/`router` navigation, so it does **not** re-run the page or any RSC query. Verified this
  pattern against `node_modules/next/dist/docs/` (App Router Server Functions callable from client)
  and it matches the current, working code.
- **Bounded + indexed — confirmed empirically, not assumed.** `EXPLAIN (costs off)` on the dev DB
  for the hybrid query produced:

  ```
  Limit
    -> Sort
         Sort Key: ((name ~~* '%…%')) DESC, (word_similarity('…', name)) DESC, updated_at DESC
         -> Bitmap Heap Scan on items
              Recheck Cond: ((name %> '…') OR (name ~~* '%…%'))
              -> BitmapOr
                   -> Bitmap Index Scan on items_name_trgm_idx   (Index Cond: name %> '…')
                   -> Bitmap Index Scan on items_name_trgm_idx   (Index Cond: name ~~* '%…%')
  ```

  Both branches hit `items_name_trgm_idx`; the ranking `Sort` runs only over the bounded,
  index-filtered candidate set, then `Limit`. **The trigram GIN index is confirmed usable for the
  ranked query.** (Because the corpus is small in dev, the plan's Task 0 re-confirms with
  `SET enable_seqscan = off` so the check is meaningful before the corpus grows — the planner will
  prefer the index naturally once the table is large.)

- **No unbounded growth risk.** `items` is a growing table; the read is capped at 25 (clamped ≤ 50
  in SQL) and filtered on the indexed `name` column — never an unbounded `select *`.
- **RLS join cost.** The `boards` join is RLS-scoped and keyed on the PK; item visibility already
  flows through `readable_board_ids()` (an InitPlan, evaluated once). No N+1.

## 6. Consumers — confirmed no UI change

- `src/components/command-palette.tsx` (client): imports `searchItems` + `ItemSearchResult`, calls
  `searchItems(term)` in a debounced effect, renders `items.map(...)`. Depends only on the lib's
  signature and return shape — both preserved. **No change.**
- `src/components/shell/command-palette-data.tsx` (RSC): streams nav/create data; does not touch
  item search at all. **No change.**

The change is therefore: **1 migration + 1 lib file + its 2 tests**. Nothing renders differently
except that better/more results appear for the same keystrokes.

## 7. Testing strategy (TDD, mandatory)

Two layers, matching the repo's split (`vitest.config.ts`: `unit` project mocks Supabase;
`integration` project hits live cloud Supabase serially):

1. **Unit test** — `src/lib/search/item-search.test.ts` (rewritten). Mock `supabase.rpc` (instead of
   the current `.from().ilike()` mock). Assert: (a) sub-2-char / whitespace / over-100 queries
   return `[]` with **zero** rpc calls; (b) a valid query calls `rpc("search_items", { p_query,
p_limit: 25 })` with the **trimmed** query; (c) rows map to `ItemSearchResult` (drop `rank`);
   (d) an rpc error returns `[]`, no throw. This is a **behavioural rewrite** of the existing suite —
   the old assertions about the ilike pattern / `.order` are deleted with the code they described.
2. **Ranking-quality integration test** — `src/lib/search/item-search.rls.integration.test.ts` (new,
   live DB). Provision a throwaway `@example.com` user + test org + board (existing
   `integration-auth` / `signInWithRetry` harness; auto-purged by `src/test/global-teardown.ts`),
   seed items with known names, then assert on the **caller-scoped** RPC:
   - **Exact-contains-first:** a query that exactly-substring-matches item X and only fuzzy-matches
     item Y returns X before Y.
   - **Typo tolerance:** `desing` returns the `Design …` item (score ≈ 0.571 ≥ 0.3 threshold).
   - **Recency tie-break:** two items whose names match equally strongly come back most-recent
     first.
   - **RLS scoping (security):** a second org's user searching the same term gets **none** of org
     A's items — proves `SECURITY INVOKER` + RLS actually scopes the RPC.
   - **Bound:** seeding > 25 matches returns exactly 25.

All four gates must pass before the task is done: `pnpm typecheck && pnpm lint && pnpm test &&
pnpm build`.

## 8. Risks & mitigations

- **Integration tests write to the live (prod) Supabase.** Per the vault memory note, Vitest loads
  `.env.local` → remote DB, so the ranking suite provisions real `@example.com` users/org. Mitigation:
  reuse the existing `integrationTargetReady()` gate + `@example.com` naming so `global-teardown`
  purges them; keep seeded names test-scoped and delete the test org in `afterAll`.
- **Threshold too loose / too tight.** 0.3 is evidence-picked but a product judgement. It lives in
  **one place** (the function-local `SET`), so tuning is a one-line follow-up migration, not a code
  change. The ranking test pins the current behaviour so a future tweak is a conscious decision.
- **Function-local GUC not honoured.** If `SET pg_trgm.word_similarity_threshold` in the function
  header is rejected on the target Postgres, fall back to filtering with an explicit
  `word_similarity(p_query, i.name) >= 0.3` in the `WHERE` **in addition to** the `%>` operator
  (the operator keeps the index scan; the explicit predicate just re-filters). Task 0 verifies the
  header form works via the advisor/`EXPLAIN` step before downstream tasks start.
- **Planner picks seq scan in tiny dev corpus.** Expected at 252 rows; the `enable_seqscan = off`
  check proves index _capability_, and the index wins naturally as `items` grows. Documented, not a
  blocker.

## 9. Migration-gating & parallelization

- **Migration-gated.** The agent cannot push migrations to the cloud (working agreement + the
  migration's own header convention). **Task 0** writes the migration; the **USER applies it**
  (`supabase db push`), then the agent regenerates `src/types/database.types.ts` (`pnpm db:types`)
  and runs Supabase advisors. Every downstream task depends on the generated `search_items` type, so
  Task 0 is a hard gate.
- **Independent units (for the DAG in the plan):** after Task 0, the **unit test + lib swap** and
  the **ranking-quality integration test** touch different files and can proceed in parallel; final
  verification joins them. Full DAG, batches, and critical path are in the plan.

## 10. Open questions for reviewer

1. Threshold **0.3** — accept, or prefer 0.4 (stricter, fewer fuzzy hits)?
2. Keep search **items-only** this slice (recommended), or fold boards/dashboards into the same RPC
   now? (They're already client-filtered, so items-only is the tighter scope.)
3. Return `rank` from the RPC for debugging (recommended) or keep the wire shape minimal?
