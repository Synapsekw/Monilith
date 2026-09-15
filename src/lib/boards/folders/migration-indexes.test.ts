import { describe, expect, it } from "vitest";
import { readMigrationSources } from "@/test/anon-conformance";

/**
 * OUTLIVES ITS MODULE ON PURPOSE. The private-folder application code is gone
 * (the sidebar reads shared `folders`/`folder_boards` now), but
 * `20260915123539_private_folders_copy_forward.sql` deliberately did NOT drop
 * `board_folders` / `board_folder_boards` — the tables still hold the live
 * rows the copy-forward was derived from, and a separate migration drops them
 * once the owner has verified the new sidebar. Until that lands this file and
 * `board-folders.rls.integration.test.ts` are the only cover those live tables
 * have; delete both WITH the drop migration, not before.
 *
 * `board_folder_boards`'s primary key is (user_id, board_id), so a predicate on
 * `board_id` ALONE cannot seek it — Postgres falls back to scanning the whole PK
 * index. The consumer of that predicate is not the app's unfile path (which runs
 * through the RLS client and therefore always supplies user_id); it is the
 * `boards ON DELETE CASCADE` referential-integrity check, which fires on every
 * board delete, for every user, and today scans the entire placement index.
 *
 * This is a FILE-SHAPE assertion and it knows it: the real acceptance evidence
 * is the `EXPLAIN` re-run against DEV recorded in the slice report. What this
 * test buys is that the index cannot be quietly dropped from the committed
 * migration corpus without a red suite.
 */
describe("board_folder_boards indexes", () => {
  const corpus = readMigrationSources().join("\n");

  it("covers the board_id foreign key with an index led by board_id", () => {
    // Leading column only: a composite index led by anything else (e.g.
    // (folder_id, board_id)) would not serve a board_id-only predicate, so the
    // regex anchors on the FIRST column inside the parens.
    const ledByBoardId =
      /create\s+index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?\w+\s+on\s+(?:public\.)?board_folder_boards\s*(?:using\s+btree\s*)?\(\s*"?board_id"?\s*[,)]/i;

    expect(corpus).toMatch(ledByBoardId);
  });
});
