# /wrapup — Capture this session as a note in `vault/sessions/` and bump the north-star

Write a structured session summary in `vault/sessions/YYYY-MM-DD-HHmm-<slug>.md`, then update
`vault/00-north-star.md` so the entry point reflects reality.

## Steps to follow

1. **Gather state — one call:** run `scripts/wrapup-context.sh`. It emits everything this step
   needs in labeled sections: date/time (including the `YYYY-MM-DD-HHmm` note-id), repo root +
   worktree detection, branch + HEAD, `git status --short` (with `.obsidian/*` noise separated),
   ahead/behind vs `origin/develop`, the **full north-star §3 "Now" text**, any `_draft-*.md` left
   by the Stop hook, and the 3 newest session notes. **Do not improvise separate `date`/`git`/`cat`
   calls for anything this script already prints.** (For "What changed" detail you may still run
   `git diff --stat HEAD~5..HEAD` or `git log` — that's content, not boot context.)

2. **Derive a slug** (3–6 words, kebab-case) from the most prominent work in this session.
   Examples: `phase2-boards-core`, `rls-policy-audit`, `kanban-view-dnd`, `wrapup-skill-setup`.

3. **Pick a title** — a short headline matching the slug.

4. **Write the file** at `vault/sessions/<date>-<slug>.md` using this exact structure:

```markdown
---
type: session
date: <YYYY-MM-DD-HHmm>
branch: <branch>
trigger: wrapup
status: complete
tags: [session]
related: []
---

# <Title>

## What changed

- (3–6 bullets: files touched, commits made, key decisions)

## Why

(1–3 sentences — the context git log can't capture. Why was this work needed? What broader goal does it serve?)

## How to test (for the user)

(Numbered, concrete manual-test steps for a shipped, user-observable feature: where to go, what to
click/enter, expected result at each step — plus any setup like "pull `develop`" / which env. This
mirrors the closing-message walkthrough required at task closure, AGENTS.md working agreement #1.
If the work is NOT user-observable — pure refactor, infra, internal lib — write a single line:
"No user-facing behavior to test — verified by the test suite.")

## Open threads

- (anything left unfinished, blockers, follow-ups; bullet list)

## Next session entry point

(1–2 sentences pointing the next session at where to start.)
```

5. **Bump the north-star** (`vault/00-north-star.md`). **Read it with the Read tool first — always,
   before any Edit.** The §3 excerpt from step 1 is for orientation only; Edit's old_string must
   match the file on disk exactly, and the file has almost certainly changed since any prior
   session you remember. (Same rule for amending an existing session note: Read it before editing.
   Never edit either file from memory.) The north-star is a **concise live snapshot,
   not a changelog** — session-by-session history lives in `vault/sessions/` and is surfaced
   automatically by the dataview blocks in §3. So **overwrite, never append:**
   - Update **§3 "Now"** in place — refresh the `Phase`, `Branch`, `In flight`, `Next`, and `Owed`
     bullets to this session's end state. **Do NOT add a per-session "Latest:" line** — replace the
     existing bullets, don't accumulate. If a bullet is now stale (e.g. an "In flight" item shipped,
     an "Owed" item was cleared), edit or delete it.
   - If a build phase closed or its status changed, update **§2** — the phase's **status tag +
     one-line outcome only** (per-slice detail belongs in [[platform-roadmap]] and the session note,
     not here). There is no "Where we are" paragraph; don't reintroduce one.
   - **Bump `last-updated`** in the frontmatter to today's date.
   - Add the new session to the `related:` of anything it closes out, and link it with `[[<session-filename-without-ext>]]` where relevant.

6. **Check for link rot (best-effort, via the `obsidian-cli` skill).** Catch broken wikilinks and
   newly-stranded notes so dev-memory doesn't silently rot. This needs the Obsidian desktop app
   running, so skip it cleanly when the binary is absent — never block a wrapup on it:

   ```bash
   command -v obsidian >/dev/null 2>&1 || echo "obsidian CLI not available — skipping link-rot check"
   ```

   If available:
   - `obsidian unresolved 2>/dev/null` — broken `[[wikilinks]]`. **Expect false positives** from
     code blocks and from intentional cross-refs to **auto-memory** slugs (those live in
     `~/.claude/.../memory/`, not the vault). Only act on links that point at _vault_ notes which
     should exist — fix them, or note them in "Open threads".
   - `obsidian orphans 2>/dev/null | grep '^vault/'` — vault notes with no links in or out (the
     whole repo is the Obsidian vault, so `grep '^vault/'` is required to cut the noise). New
     session notes land here; link the important ones into the graph (north-star, a MOC, or a
     `related:` entry) rather than leaving them stranded.

   Keep it light — a quick rot check, not a full audit. This is a `pulse` main-thread tool only;
   subagents in headless worktree builds can't reach the running desktop app.

7. **Refresh the plan board (best-effort) — follow `.claude/commands/board.md`.** Update the
   `#board-data` JSON island in `vault/board.html` from the just-bumped north-star + worktrees +
   this session's note, validate it parses, and redeploy to the permanent Artifact URL recorded in
   `board.md`. This runs **before** the vault commit so the refreshed board rides it. If the
   Artifact tool is unavailable, update the JSON anyway and note the skip — **never block or fail
   a wrapup on the board.**

8. **Commit the vault (vault paths only).** Dev-memory's value is durability, so `/wrapup`
   commits its own output:

   ```bash
   git add vault/ && git commit -m "docs(vault): <slug> session + north-star bump"
   ```

   - **Stage `vault/` only** — never `git add -A`/`.`. This commits the session note, the
     north-star bump, any ADRs you wrote, and removes the folded-in `_draft-*.md`. It must not
     pull in source changes; those follow the normal "don't commit unless asked" rule.
   - If there are also source changes in the working tree, leave them staged-out and untouched.
   - Don't push unless the user asks.

9. **Report back** to the user with the session file path, the commit hash, a one-line
   summary, and a note of what you changed in the north-star — plus the plan-board URL
   (from `.claude/commands/board.md`) with a one-liner on whether it was refreshed or skipped.

## Discipline

- **Read before Edit — no edits from memory.** `vault/00-north-star.md` (and any existing note you
  amend) must be Read with the Read tool in _this_ session before any Edit call. Editing from a
  remembered version is the top cause of failed-edit retries in wrapups.
- **One boot call.** `scripts/wrapup-context.sh` is the entire step-1 context gather; don't
  reconstruct it from ad-hoc shell calls.
- **Keep it tight.** If the summary is more than ~30 lines, the work belonged in a spec or ADR, not a session note. Trim and split rather than expanding.
- **The north-star is a snapshot, not a log.** §3 "Now" is overwritten each wrapup, never appended to; §2 stays at status + one-liner per phase. History is carried by the session notes + the §3 dataview blocks — if you feel the urge to add a dated "Latest" entry to the north-star, that's the session note's job.
- **Commit vault paths only.** The standing "never commit unless asked" preference protects
  _source code_ from surprise commits/deploys — it does **not** apply to the vault, whose whole
  point is durable dev-memory. So `/wrapup` commits `vault/` (and only `vault/`) per step 8. Never
  stage or commit source changes during a wrapup.
- **No emoji** in the file body unless the user asked for them.
- **Cross-link** any decisions worth surfacing — if a real architectural decision or a non-obvious gotcha came up, also create an ADR in `vault/decisions/` using the `decision.md` template (tag gotchas with `gotcha`).

## Edge cases

- **Multi-day session.** If the conversation spans more than a day, pick the date the work mostly happened on. The `branch` field is the branch at the time of writing.
- **No git changes.** Still write the note — research/learning sessions matter. Note in "What changed" that no files were modified, and skip the north-star §2/§3 edits if nothing shipped (but you may still bump `last-updated` if the plan changed).
- **A `_draft-*.md` exists in `vault/sessions/`** (left by the Stop hook). Read it, fold its content into the new note, then delete the draft.
