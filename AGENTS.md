<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Working agreement (how to build in this repo)

These rules are mandatory for agents and humans. See `CONTRIBUTING.md` for the full workflow.

1. **Branch lifecycle.** Work on a `feat/…` or `chore/…` branch off `main`; open a PR; merge once
   CI is green. Branches are **deleted on merge** (GitHub auto-deletes them — never leave stale
   branches around). `main` is protected: no direct pushes.

2. **Use Superpowers skills for non-trivial work — but don't overthink trivial changes.** For
   anything beyond a simple/obvious edit (new features, components, behavior changes, debugging,
   multi-file work), leverage the relevant Superpowers skill (`brainstorming` before building,
   `test-driven-development`, `verification-before-completion`, `subagent-driven-development`,
   `systematic-debugging`, etc.). For a one-line fix, typo, or trivial tweak, just do it.

3. **UI work requires the design skills.** Before building or styling any UI, load the front-end
   design skills — the project `pulse-ui` skill (Pulse's monochromatic + single-accent system,
   tokens, app primitives) and the generic `frontend-design` skill. This is not optional for
   visual/component work.

4. **Tests are mandatory.** Every feature — at spec time and at build time — ships with tests that
   are **written and executed**. A feature is not "done" until `pnpm typecheck`, `pnpm lint`,
   `pnpm test`, and `pnpm build` all pass (and behavior is verified). This is the Superpowers
   `test-driven-development` + `verification-before-completion` discipline: evidence before claims.
