# /board — Refresh the mission-control plan board

Refresh `vault/board.html` (the visual plan board) from the project's canonical state and redeploy
it as a claude.ai Artifact at the permanent URL below. The board is a **DERIVED view** — it is
never a source of truth; never edit project state here first.

**Permanent URL (never mint a new one):** https://claude.ai/code/artifact/eb984761-bee4-4d1a-b6ba-30c6bc05119c
**Favicon (always the same):** 🗿
**Design spec:** `vault/decisions/2026-07-17-decision-28-mission-control-board.md`

## Refresh procedure

1. **Gather state** from the canonical sources (read them directly — there is deliberately no
   parser/generator script, so their format can evolve freely):
   - `vault/00-north-star.md` — frontmatter `last-updated` → `updated`; §3 "Now" → `headline`
     (Phase, compressed to one line), `chips` (Branch bullet: develop/main/prod sync state), and
     `gates` (Next + Owed bullets, one gate each); §2 phase list → `roadmap` nodes + `progress`
     fraction (Done tracks / all tracks).
   - `git worktree list` — every worktree besides the main checkout → `worktrees` (branch, short
     head, one-word note if known).
   - Newest note in `vault/sessions/` (excluding `_draft-*`) → `session` (id, when, 2–3 bullets
     from "What changed").
2. **Rewrite ONLY the `#board-data` JSON island** in `vault/board.html`. LED semantics: pulsing
   `red` = critical/exposed (e.g. unvalidated path live in prod), `amber` = in flight/parked,
   `hollow` = open/owed, `green` = done, `brand` = informational. Tags are short uppercase
   (`CRITICAL`, `PARKED`, `NEXT?`, `OWED`).
3. **Validate the JSON parses** before deploying — a syntax error blanks the board:

   ```bash
   node -e '
   const fs = require("fs");
   const html = fs.readFileSync("vault/board.html", "utf8");
   const m = html.match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/);
   const d = JSON.parse(m[1]);
   console.log("OK schema", d.schema, "| gates:", d.gates.length, "| roadmap:", d.roadmap.length);
   '
   ```

4. **Redeploy** with the Artifact tool: `file_path = vault/board.html`, `url` = the permanent URL
   above, `favicon` = 🗿, a short `label` naming the refresh (e.g. `after-e6-merge`).
5. **Report what changed** — one or two lines: which gates flipped, roadmap moves, new session.
   Include the board URL.

## Hard rules

- **JSON island only.** Never touch markup, CSS, or render JS on a refresh; redesigns happen only
  on explicit user request, and structural changes are a deliberate `"schema"` bump — not drift.
- **Never mint a new artifact URL.** Always redeploy to the recorded permanent URL with the same
  favicon. If the redeploy conflicts (409), reconcile with the other session's version — don't
  force.
- **The board is a DERIVED view**, never a source of truth. State lives in the north-star, the
  sessions, and git; the board only reflects them.
- **Don't commit from /board.** The session-end flow (`/wrapup` stages `vault/`) picks the file up
  with everything else.
- **No live updates between sessions.** Freshness is bounded by the last `/board` or wrapup, same
  as the status docs themselves.
- **Best-effort.** If the Artifact tool is unavailable, update the JSON anyway, note the skip, and
  move on — never block or fail a wrapup (or anything else) on the board.
