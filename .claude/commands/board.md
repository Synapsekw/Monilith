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
   - `vault/00-north-star.md` — frontmatter `last-updated` → `updated`; §1 Pitch → `product`;
     §3 "Now" → `environment` (the DEV-database bullet), `ship` (Branch bullet), `next` (Next
     bullet, split into ranked actions) and `risks` (Owed bullets + anything live and unverified);
     §2 phase list → `stand.meter` + `pillars`.
   - `git worktree list` — every worktree besides the main checkout → `worktrees` (branch, short
     head, one-word note if known).
   - Newest note in `vault/sessions/` (excluding `_draft-*`) → `session` (id, when, title, 3–4
     bullets from "What changed" / "Why").
2. **Rewrite ONLY the `#board-data` JSON island** in `vault/board.html` (schema 2). The board
   answers four questions in order — keep each field doing its own job and don't let prose leak
   across them:
   - `product` — `kicker`, `thesis` (one sentence: what Monolith is), `stack`.
   - `environment` — the standing DEV-database warning. `title` + `text`.
   - `stand` — `percent` (fully-complete tracks ÷ all tracks, rounded), `fraction`
     ("13 of 15 tracks complete"), `caption` (the weighted-by-slice reading and what's actually
     left), and `meter`: one entry per roadmap track, `state` `done` | `part` (with `pct`) |
     `todo`. The meter IS the percentage — keep it in sync with the number above it.
   - `pillars` — 6 capability groups a person recognises, each `pct`, `have` (what exists today),
     `left` (empty string when nothing is open). A pillar under 100 renders amber.
   - `ship` — `stages` (develop → main → production: `value`, `tone`, `note`) and `gates`
     (typecheck/lint/test/build/ledger). Tones: `ok` | `warn` | `bad`.
   - `next` — **ranked**, most-urgent first; rank 1 renders in the accent. Each: `title`, `why`
     (the evidence and the catch, plain sentences), `tags` (short lowercase; the literal tag
     `critical` renders red).
   - `risks` — standing conditions, NOT tasks. `sev` `red` (pulses) | `amber` | `open`.
   - `worktrees`, `session` — as gathered above.
3. **Validate before deploying — both checks, every time.** A syntax error blanks the board, and a
   stray design edit silently restyles it:

   ```bash
   # (a) the data still parses and every section has content
   node -e '
   const fs = require("fs");
   const html = fs.readFileSync("vault/board.html", "utf8");
   const m = html.match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/);
   const d = JSON.parse(m[1]);
   console.log("OK schema", d.schema, "| pillars:", d.pillars.length,
     "| next:", d.next.length, "| risks:", d.risks.length, "| meter:", d.stand.meter.length);
   '

   # (b) the DESIGN is byte-identical to its baseline — a data-only refresh passes
   node scripts/check-board-chrome.mjs
   ```

   **If (b) fails, do not deploy.** The refresh changed markup, CSS or render JS. Restore the design
   and redo the edit inside the island only. `--accept` re-baselines and is for an owner-requested
   redesign — never for making a failing refresh go through.

4. **Redeploy** with the Artifact tool: `file_path = vault/board.html`, `url` = the permanent URL
   above, `favicon` = 🗿, a short `label` naming the refresh (e.g. `after-e6-merge`).
5. **Report what changed** — one or two lines: which gates flipped, roadmap moves, new session.
   Include the board URL.

## Hard rules

- **JSON island only — and this is enforced, not trusted.** Never touch markup, CSS, or render JS on
  a refresh. `scripts/check-board-chrome.mjs` hashes everything outside the island and fails the
  refresh if a single byte moved, so "I'll just tidy that spacing while I'm here" is caught before it
  deploys. The layout, palette, type and section order are the owner's; a refresh only ever changes
  what the sections SAY. Redesigns happen solely on explicit user request, and are a deliberate
  `"schema"` bump plus `node scripts/check-board-chrome.mjs --accept` — never drift.
- **Fit the content to the design, not the design to the content.** If a field feels too small for
  what you want to say, shorten the text. Do not widen a column, add a section, or restyle a card to
  fit a longer sentence.
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
