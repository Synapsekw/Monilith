---
type: decision
date: 2026-07-17
status: accepted
tags: [decision, tooling, dev-memory, board]
related:
  ["[[00-north-star]]", "[[2026-07-17-1441-promote-report-builder-sync-prod]]"]
---

# decision-28: Permanent visual plan board ("mission control") as a claude.ai Artifact

## Context

The north-star + session notes are the canonical project state, but they are markdown — no
at-a-glance view of phase progress, debts, and in-flight work. The owner runs the same system in
another project (Mubarak AI) and wants it here: one **stable Artifact URL** showing a visual board,
kept current by the existing session lifecycle. Visual direction picked from three live mockups:
**Keystone Console** (the app's own Monolith Keystone identity + status LEDs).

## Decision — three pieces, no new dependencies

1. **`vault/board.html`** — a single self-contained HTML page (no external requests; Artifact CSP
   blocks them). Designed once. ALL volatile state lives in one embedded JSON island:
   `<script type="application/json" id="board-data">{...}</script>` with a `"schema": 1` version
   field. Inline JS renders the whole page from that JSON. A refresh edits **only** the JSON —
   markup/CSS/render-JS are never touched. It lives in `vault/` so `/wrapup`'s existing
   `git add vault/` commits it with the rest of dev-memory — no new git rules.
2. **`.claude/commands/board.md`** — owns the refresh procedure: gather state from the canonical
   sources, rewrite only the `#board-data` JSON (validate it parses), redeploy via the Artifact
   tool to the **same permanent URL + same favicon**, report the delta. The minted URL is recorded
   in `board.md` itself.
3. **One best-effort `/wrapup` step** — "Refresh the plan board — follow
   `.claude/commands/board.md`", placed **before** the vault commit so the refreshed board rides
   the wrapup commit. Never blocks or fails a wrapup; if the Artifact tool is unavailable, update
   the JSON anyway and note the skip.

## JSON schema (v1)

```jsonc
{
  "schema": 1,
  "updated": "YYYY-MM-DD HH:mm", // north-star frontmatter last-updated
  "kicker": "PULSE / NORTH STAR",
  "headline": "…", // §3 Phase, compressed to one line
  "chips": [
    {
      "label": "develop",
      "value": "0282058",
      "note": "== origin",
      "tone": "ok|warn|bad",
    },
  ],
  "progress": { "done": 13, "total": 15 }, // §2 phases: Done vs all tracks
  "gates": [
    {
      "led": "red|amber|green|hollow|brand",
      "text": "…",
      "tag": "CRITICAL|PARKED|NEXT?|OWED|…",
    },
  ],
  "worktrees": [
    { "led": "amber", "branch": "task/…", "head": "1e2b815", "note": "…" },
  ],
  "session": {
    "id": "<note filename>",
    "when": "MM-DD HH:mm",
    "bullets": ["…"],
  },
  "roadmap": [{ "label": "0 Setup", "state": "done|prog|future" }],
}
```

## Zone → source-of-truth map (the board is a DERIVED view)

| Zone                        | Source                                                  |
| --------------------------- | ------------------------------------------------------- |
| Header strip                | north-star frontmatter `last-updated` + §3 Phase/Branch |
| Gate board (Now/Owed LEDs)  | north-star §3 "Next" + "Owed" (+ critical risks)        |
| Roadmap rail                | north-star §2 phase list statuses                       |
| In-flight + session summary | `git worktree list` + newest note in `vault/sessions/`  |

No parser/generator script: Claude reads the markdown directly each refresh, so source formats can
evolve freely.

## Non-goals

- Not a source of truth — never edit project state on the board first.
- No live updates between sessions; freshness = last `/board` or wrapup, same as the docs.
- No redesigns on refresh — visual changes only on explicit user request (schema bump).
- `/board` never commits; the session-end flow stages `vault/board.html` with everything else.
