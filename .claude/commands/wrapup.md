# /wrapup — Capture this session as a note in `vault/sessions/` and bump the north-star

Write a structured session summary in `vault/sessions/YYYY-MM-DD-HHmm-<slug>.md`, then update
`vault/00-north-star.md` so the entry point reflects reality.

## Steps to follow

1. **Gather state:**
   - Run `git status --porcelain` and `git diff --stat HEAD~5..HEAD`
   - Get the current branch via `git rev-parse --abbrev-ref HEAD`
   - Get the current date/time in `YYYY-MM-DD-HHmm` format

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

5. **Bump the north-star** (`vault/00-north-star.md`):
   - Update **§3 "Now"** — `Phase`, `Branch`, and the `Latest:` line to reflect this session's end state, and point `Next:` at what comes next.
   - If a build phase closed or its status changed, update **§2** (the phase's status tag + one-line note) and the **"Where we are"** line.
   - **Bump `last-updated`** in the frontmatter to today's date.
   - Add the new session to the `related:` of anything it closes out, and link it with `[[<session-filename-without-ext>]]` where relevant.

6. **Commit the vault (vault paths only).** Dev-memory's value is durability, so `/wrapup`
   commits its own output:

   ```bash
   git add vault/ && git commit -m "docs(vault): <slug> session + north-star bump"
   ```

   - **Stage `vault/` only** — never `git add -A`/`.`. This commits the session note, the
     north-star bump, any ADRs you wrote, and removes the folded-in `_draft-*.md`. It must not
     pull in source changes; those follow the normal "don't commit unless asked" rule.
   - If there are also source changes in the working tree, leave them staged-out and untouched.
   - Don't push unless the user asks.

7. **Report back** to the user with the session file path, the commit hash, and a one-line
   summary, and note what you changed in the north-star.

## Discipline

- **Keep it tight.** If the summary is more than ~30 lines, the work belonged in a spec or ADR, not a session note. Trim and split rather than expanding.
- **Commit vault paths only.** The standing "never commit unless asked" preference protects
  _source code_ from surprise commits/deploys — it does **not** apply to the vault, whose whole
  point is durable dev-memory. So `/wrapup` commits `vault/` (and only `vault/`) per step 6. Never
  stage or commit source changes during a wrapup.
- **No emoji** in the file body unless the user asked for them.
- **Cross-link** any decisions worth surfacing — if a real architectural decision or a non-obvious gotcha came up, also create an ADR in `vault/decisions/` using the `decision.md` template (tag gotchas with `gotcha`).

## Edge cases

- **Multi-day session.** If the conversation spans more than a day, pick the date the work mostly happened on. The `branch` field is the branch at the time of writing.
- **No git changes.** Still write the note — research/learning sessions matter. Note in "What changed" that no files were modified, and skip the north-star §2/§3 edits if nothing shipped (but you may still bump `last-updated` if the plan changed).
- **A `_draft-*.md` exists in `vault/sessions/`** (left by the Stop hook). Read it, fold its content into the new note, then delete the draft.
