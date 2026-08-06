/**
 * e2e: Offline read-only boards
 *
 * Auth strategy is copied verbatim from `e2e/boards.spec.ts`: a CONFIRMED
 * user is created via the service-role admin API in `beforeAll` (a plain UI
 * signup can be blocked by email confirmation on the dev Supabase project),
 * then the rest of the flow drives through the real UI — login, onboarding,
 * board creation. See that file's header comment for the full rationale. If
 * SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is absent, the whole
 * describe block is skipped gracefully.
 *
 * All of task-10-brief.md's acceptance points are covered in ONE test that
 * shares a single page/session, for the same reason `boards.spec.ts` does:
 * user/org/board setup is expensive, and two tests hitting the same account
 * in parallel (this config runs `fullyParallel: true`) can race each other.
 */

import * as dotenv from "dotenv";
import * as path from "node:path";

// Load .env.local for the Playwright test process (playwright.config.ts does
// not ship a dotenv call; the webServer process gets its own env from Next.js).
dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasSecrets = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

const PASSWORD = "Test-Password-123!";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * The service worker registers on idle AFTER load (see
 * `ServiceWorkerRegistrar.tsx`: `requestIdleCallback` with a 5s timeout, or a
 * 2s `setTimeout` fallback) — not during hydration. There is no single DOM
 * event to await for that, so poll the real observable instead of guessing a
 * sleep: `navigator.serviceWorker.ready` resolves the instant an active
 * worker exists for this scope, however long the idle callback took.
 */
async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
}

/**
 * The board snapshot is written to IndexedDB from a React effect
 * (`useBoardSnapshot` -> `OfflinePersistence`'s `persistQueryClientSubscribe`)
 * asynchronously after render — also not a single event. Poll the actual
 * IndexedDB record (idb-keyval's default `keyval-store` database / `keyval`
 * object store — see `src/lib/offline/persister.ts`) rather than a fixed
 * `waitForTimeout`.
 *
 * `persistQueryClientSubscribe` (see `@tanstack/query-persist-client-core`'s
 * `persist.ts`) re-persists the WHOLE client on every single query-cache
 * event, unthrottled — so the very first write can land before
 * `useBoardSnapshot`'s effect has set the `boardSnapshot` entry (e.g. it can
 * fire off the board's own data query being added). Checking only "a record
 * exists at this key" would resolve on that early, incomplete write and race
 * ahead of the real snapshot — so this inspects the persisted
 * `clientState.queries` (the exact shape `dehydrate()` produces, keyed by
 * `queryKey`/`queryHash`) for the specific `["boardSnapshot", boardId]` entry
 * this test is about to depend on, not merely "something" at the IDB key.
 *
 * The poll must never CREATE or MUTATE the database it is observing. An earlier
 * version of this helper called `indexedDB.open("keyval-store")` unconditionally
 * and aborted the resulting `onupgradeneeded` transaction, on the theory that
 * aborting makes the probe observe-only. It does not: aborting a version-change
 * transaction that was creating the database rolls the database back to version
 * 0, destroying the object store and everything in it. Measured directly — with
 * that probe in place, `indexedDB.databases()` reported `keyval-store` absent
 * immediately after the probe had just confirmed the snapshot present, and
 * `/offline` then reported a just-visited board as never visited. The probe was
 * manufacturing the very symptom under investigation.
 *
 * So this version never opens a database that does not already exist:
 * `indexedDB.databases()` reports existence with no connection at all, and only
 * once the app itself has created the store is it opened for reading — at which
 * point `onupgradeneeded` cannot fire for this probe.
 */
async function waitForOfflineSnapshot(
  page: Page,
  idbKey: string,
  boardId: string,
) {
  await page.waitForFunction(
    async ({ k, boardId: bid }) => {
      // Existence check first, with no connection and therefore no possibility
      // of triggering (or aborting) a version change.
      const databases = await indexedDB.databases();
      if (!databases.some((d) => d.name === "keyval-store")) return false;

      return await new Promise<boolean>((resolve) => {
        // Safe: the database demonstrably exists, so `onupgradeneeded` cannot
        // fire for this request.
        const req = indexedDB.open("keyval-store");
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("keyval")) {
            db.close();
            resolve(false);
            return;
          }
          const getReq = db
            .transaction("keyval", "readonly")
            .objectStore("keyval")
            .get(k);
          getReq.onsuccess = () => {
            const persisted = getReq.result as
              | { clientState?: { queries?: Array<{ queryKey: unknown }> } }
              | undefined;
            const queries = persisted?.clientState?.queries ?? [];
            const hasSnapshot = queries.some(
              (q) =>
                Array.isArray(q.queryKey) &&
                q.queryKey[0] === "boardSnapshot" &&
                q.queryKey[1] === bid,
            );
            db.close();
            resolve(hasSnapshot);
          };
          getReq.onerror = () => {
            db.close();
            resolve(false);
          };
        };
      });
    },
    { k: idbKey, boardId },
    { timeout: 30_000 },
  );
}

/**
 * Every board id currently present in the persisted record.
 *
 * Uses the same never-create discipline as `waitForOfflineSnapshot`:
 * `indexedDB.databases()` first, and the database is only opened once it
 * already exists, so this probe can never trigger (or abort) a version change
 * and destroy the store it is inspecting.
 */
async function readPersistedBoardIds(
  page: Page,
  idbKey: string,
): Promise<string[]> {
  return await page.evaluate(async (k) => {
    const databases = await indexedDB.databases();
    if (!databases.some((d) => d.name === "keyval-store")) return [];
    return await new Promise<string[]>((resolve) => {
      const req = indexedDB.open("keyval-store");
      req.onerror = () => resolve([]);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("keyval")) {
          db.close();
          return resolve([]);
        }
        const getReq = db
          .transaction("keyval", "readonly")
          .objectStore("keyval")
          .get(k);
        getReq.onerror = () => {
          db.close();
          resolve([]);
        };
        getReq.onsuccess = () => {
          const persisted = getReq.result as
            | { clientState?: { queries?: Array<{ queryKey: unknown }> } }
            | undefined;
          const ids = (persisted?.clientState?.queries ?? [])
            .map((q) => q.queryKey)
            .filter(
              (key): key is [string, string] =>
                Array.isArray(key) &&
                key[0] === "boardSnapshot" &&
                typeof key[1] === "string",
            )
            .map((key) => key[1]);
          db.close();
          resolve(ids);
        };
      };
    });
  }, idbKey);
}

test.describe("offline read-only boards", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping offline e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-offline")}@example.com`;

    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await admin.auth.admin.createUser({
      email: testEmail,
      password: PASSWORD,
      email_confirm: true,
    });

    if (error || !data.user) {
      throw new Error(
        `Failed to create test user via service role: ${error?.message}`,
      );
    }
    createdUserId = data.user.id;
  });

  test.afterAll(async () => {
    if (!createdUserId) return;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin.deleteUser(createdUserId);
  });

  test("a visited board reads offline from cache, a never-visited one is honest about it, and reconnect heals", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);

    // ── 1. Log in via the UI (identical to boards.spec.ts) ──────────────────
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // ── 2. Onboarding (new user has no org) ──────────────────────────────────
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    // Port-tolerant (the sibling specs hardcode :3000). Still matches the
    // normal :3000 run, but lets this spec be verified against a server on
    // another port — which matters here because `playwright.config.ts` sets
    // `reuseExistingServer: !CI` against a fixed :3000, so a dev server left
    // running from a DIFFERENT checkout is silently used instead of this one.
    // That is not hypothetical: the main checkout's `develop` server answers
    // 404 for /sw.js, so the whole offline feature would appear broken.
    await page.waitForURL(/localhost:\d+\/$/, { timeout: 30_000 });
    await expect(page.getByText(/no boards yet/i)).toBeVisible({
      timeout: 15_000,
    });

    // ── 3. Create the board we will visit, cache, and reload offline ────────
    const boardName = unique("OfflineBoard");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    const boardUrl = page.url();
    const boardId = boardUrl.match(/\/boards\/([0-9a-f-]{36})/)?.[1];
    if (!boardId) {
      throw new Error(`Could not extract a board id from ${boardUrl}`);
    }
    await expect(page.getByText("Group 1")).toBeVisible({ timeout: 15_000 });

    // ── 4. Wait on real observable conditions, not sleeps ────────────────────
    await waitForServiceWorker(page);
    const userId = await page.evaluate(() =>
      window.localStorage.getItem("monolith.offline.userId"),
    );
    if (!userId) {
      throw new Error(
        "monolith.offline.userId was not set in localStorage after login " +
          "(rememberIdentity() should have run from OfflinePersistence's effect)",
      );
    }
    await waitForOfflineSnapshot(page, `monolith-offline:${userId}`, boardId);

    // ── 4b. A SECOND board, then an online reload ───────────────────────────
    //
    // Both halves of this matter, and neither was covered before:
    //
    //   * TWO boards. The persisted record holds one entry per user, and
    //     `persistQueryClientSave` dehydrates the CURRENT QueryClient and
    //     overwrites the whole thing. With only one board ever cached, a save
    //     that drops every OTHER board is indistinguishable from a correct one.
    //   * A reload BETWEEN them. A full page load starts a fresh QueryClient
    //     containing only the board being loaded, so the first save after any
    //     reload is exactly the moment the other boards were being destroyed.
    //     Measured before the fix: [Alpha, Beta] -> reload -> [Beta].
    //
    // So: cache A, cache B, reload, and require BOTH to still be there.
    const secondName = unique("SecondBoard");
    // "New board" is not on a board page; go to the app root first (which
    // redirects an authenticated user to their last board / boards index).
    await page.goto("/");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(secondName);
    const beforeCreate = page.url();
    await page.getByRole("button", { name: /create board/i }).click();
    // NOT waitForURL(/\/boards\/<uuid>/): "/" already redirected us onto a
    // board, so that pattern matches immediately and would capture the WRONG
    // board's URL. Wait for the URL to actually change.
    await page.waitForFunction(
      (b) =>
        location.href !== b &&
        /\/boards\/[0-9a-f-]{36}$/.test(location.pathname),
      beforeCreate,
      { timeout: 60_000 },
    );
    const secondUrl = page.url();
    const secondId = secondUrl.match(/\/boards\/([0-9a-f-]{36})/)?.[1];
    if (!secondId) {
      throw new Error(`Could not extract a board id from ${secondUrl}`);
    }
    await expect(page.getByText("Group 1").first()).toBeVisible({
      timeout: 15_000,
    });
    await waitForOfflineSnapshot(page, `monolith-offline:${userId}`, secondId);

    // The reload that used to destroy the first board's snapshot.
    await page.reload();
    await expect(page.getByText("Group 1").first()).toBeVisible({
      timeout: 30_000,
    });
    await waitForOfflineSnapshot(page, `monolith-offline:${userId}`, secondId);

    // BOTH boards must still be persisted after that reload.
    const cachedIds = await readPersistedBoardIds(
      page,
      `monolith-offline:${userId}`,
    );
    expect(cachedIds).toContain(secondId);
    expect(cachedIds).toContain(boardId);

    // ── 5. Go offline while still on the REAL app shell ─────────────────────
    await context.setOffline(true);
    // `context.setOffline` is a CDP call; wait for the renderer to actually
    // observe the flip before navigating, rather than assuming the two are
    // synchronous. Otherwise a navigation can race a still-open connection and
    // get a half-streamed online response instead of exercising the SW's
    // offline fallback at all.
    await page.waitForFunction(() => !navigator.onLine);

    // Filtered by text rather than a bare `getByRole("status")`: the rendered
    // board mounts dnd-kit, which injects its own empty `role="status"` live
    // regions (`#DndLiveRegion-*`), so the bare locator is a strict-mode
    // violation the moment the board actually renders — i.e. exactly when this
    // test is passing. The filter targets the banner specifically instead of
    // relaxing what is asserted.
    const offlineBanner = page
      .getByRole("status")
      .filter({ hasText: /offline/i });

    // ── 5a. The OTHER cached board reads offline ────────────────────────────
    //
    // This is defect 1's regression. `persistQueryClientSave` overwrites the
    // whole persisted record with a dehydrate of the CURRENT QueryClient, and a
    // full page load starts a fresh client holding only the board being loaded
    // — so the reload in step 4b used to destroy the FIRST board's snapshot.
    // Measured before the fix: [first, second] -> reload -> [second], and this
    // navigation then reported "isn't available offline" for a board that had
    // demonstrably been opened while online.
    //
    // Deliberately a document navigation rather than an in-app link click. The
    // click path is real and is fixed (OfflineNavigationGuard), but it cannot be
    // asserted deterministically here: once the network drops, the live app
    // shell can crash into its error boundary on a lazily-imported chunk that
    // was never precached, and the sidebar anchor stops existing. That recovery
    // path and the click interception are both covered by unit tests
    // (OfflineNavigationGuard.test.tsx, error-fallback.test.tsx); what this spec
    // pins is the user-visible outcome: a previously opened board is readable
    // with no network.
    await page.goto(boardUrl);
    await expect(offlineBanner).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Group 1").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/isn't available offline/i)).not.toBeVisible();
    await expect(page.getByLabel("Add item")).toHaveCount(0);

    // ── 5b. A reload of that board still works (document navigation) ────────
    await page.reload();
    await expect(offlineBanner).toBeVisible({ timeout: 15_000 });
    // ...and the board still renders, from the persisted snapshot — not a
    // blank page and not the generic "isn't available offline" fallback.
    await expect(page.getByText("Group 1").first()).toBeVisible();
    await expect(page.getByText(/isn't available offline/i)).not.toBeVisible();

    // And it renders read-only: OfflineBoard.tsx passes `access="viewer"`,
    // which is the same gate the online board already uses to decide
    // `canEdit` (BoardTableInner.tsx). The add-item affordance is a plain
    // text input with `aria-label="Add item"` (see AddItemRow.tsx) — not a
    // button — so assert against that real locator, matching how
    // boards.spec.ts drives the very same control online.
    await expect(page.getByLabel("Add item")).toHaveCount(0);

    // ── 6. A board never opened is honest about it ───────────────────────────
    await page.goto("/boards/00000000-0000-4000-8000-000000000000");
    // 15s like this spec's other offline assertions, not the 5s default: this
    // is a COLD navigation served by the worker — React boots, the grace check
    // resolves and the persisted client is restored from IndexedDB before the
    // copy can render. Verified rendering correctly with time to spare; the
    // default was simply tighter than the work involved.
    await expect(page.getByText(/isn't available offline/i)).toBeVisible({
      timeout: 15_000,
    });

    // ── 7. Reconnect: the banner clears, the visited board still renders ────
    await context.setOffline(false);
    await page.goto(boardUrl);
    // Same filtered locator as above — the online board still mounts dnd-kit's
    // `role="status"` live regions, so what must be gone is the BANNER, not
    // every status element on the page.
    await expect(offlineBanner).toHaveCount(0);
    await expect(page.getByText("Group 1")).toBeVisible();
  });
});
