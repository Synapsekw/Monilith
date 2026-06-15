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

6. **Report back** to the user with the session file path and a one-line summary, and note what you changed in the north-star.

## Discipline

- **Keep it tight.** If the summary is more than ~30 lines, the work belonged in a spec or ADR, not a session note. Trim and split rather than expanding.
- **Don't commit.** Per the user's standing preference, never commit unless they explicitly say so. Just write the files.
- **No emoji** in the file body unless the user asked for them.
- **Cross-link** any decisions worth surfacing — if a real architectural decision or a non-obvious gotcha came up, also create an ADR in `vault/decisions/` using the `decision.md` template (tag gotchas with `gotcha`).

## Edge cases

- **Multi-day session.** If the conversation spans more than a day, pick the date the work mostly happened on. The `branch` field is the branch at the time of writing.
- **No git changes.** Still write the note — research/learning sessions matter. Note in "What changed" that no files were modified, and skip the north-star §2/§3 edits if nothing shipped (but you may still bump `last-updated` if the plan changed).
- **A `_draft-*.md` exists in `vault/sessions/`** (left by the Stop hook). Read it, fold its content into the new note, then delete the draft.
