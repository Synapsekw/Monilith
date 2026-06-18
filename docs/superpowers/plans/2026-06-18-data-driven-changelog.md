# Data-driven changelog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public `/updates` changelog data-driven from opt-in `Changelog:` git commit trailers (merged with a frozen seed), so it never silently goes stale.

**Architecture:** A pure parser turns `git log` trailer output into `ChangelogEntry[]`. A thin generator script runs `git log` and writes a committed `generated.ts`. The page renders `[...SEED, ...GENERATED]` — UI unchanged. A develop-scoped CI job regenerates and fails on drift. Because `main` is squashed (trailers never reach it), the generated file is a committed artifact that rides to production via promotion; production never reads git.

**Tech Stack:** TypeScript, Zod (v4), Vitest, `tsx` (new devDep, to run the TS generator), prettier, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-18-data-driven-changelog-design.md`

---

## File Structure

| File                                | Responsibility                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/lib/changelog/types.ts`        | _(unchanged)_ `ChangelogEntry`, `ChangelogKind`.                                                           |
| `src/lib/changelog/parse.ts`        | **New.** Pure `parseChangelogTrailers(gitLog) → ChangelogEntry[]` + exported separators (format contract). |
| `src/lib/changelog/parse.test.ts`   | **New.** Unit tests for the parser.                                                                        |
| `src/lib/changelog/seed.ts`         | **New.** Frozen `SEED` of pre-convention entries.                                                          |
| `src/lib/changelog/generated.ts`    | **New (committed, auto-generated).** `GENERATED` from trailers. Starts `[]`.                               |
| `src/lib/changelog/entries.ts`      | **Modify.** `CHANGELOG = [...SEED, ...GENERATED]`. `groupByDate`/`formatDate` unchanged.                   |
| `src/lib/changelog/entries.test.ts` | **New.** `groupByDate` ordering/merge test.                                                                |
| `scripts/generate-changelog.ts`     | **New.** Thin git→parser→file generator.                                                                   |
| `package.json`                      | **Modify.** Add `tsx` devDep + `changelog:gen` script.                                                     |
| `.github/workflows/ci.yml`          | **Modify.** Add develop-scoped `changelog` drift-guard job.                                                |
| `CONTRIBUTING.md`                   | **Modify.** Document the `Changelog:` trailer convention.                                                  |

---

## Task 1: Pure trailer parser (`parse.ts`)

**Files:**

- Create: `src/lib/changelog/parse.ts`
- Test: `src/lib/changelog/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/changelog/parse.test.ts`. The fixture builder uses the parser's
exported separators so the format contract is single-sourced (the generator
builds its `git log --format` from the same constants in Task 4).

```ts
import { describe, it, expect, vi } from "vitest";
import {
  parseChangelogTrailers,
  RECORD_SEP,
  FIELD_SEP,
  VALUE_SEP,
} from "@/lib/changelog/parse";

/** Build one git-log record in the exact --format the generator emits. */
function record(date: string, ...trailers: string[]): string {
  return `${date}${FIELD_SEP}${trailers.join(VALUE_SEP)}${RECORD_SEP}`;
}

describe("parseChangelogTrailers", () => {
  it("parses a single full trailer", () => {
    const log = record(
      "2026-06-18",
      "new | Board automations | Rules that react to changes.",
    );
    expect(parseChangelogTrailers(log)).toEqual([
      {
        date: "2026-06-18",
        kind: "new",
        title: "Board automations",
        description: "Rules that react to changes.",
      },
    ]);
  });

  it("omits description when absent", () => {
    const log = record("2026-06-18", "improved | Faster loads");
    expect(parseChangelogTrailers(log)).toEqual([
      { date: "2026-06-18", kind: "improved", title: "Faster loads" },
    ]);
  });

  it("supports multiple trailers in one commit", () => {
    const log = record("2026-06-18", "new | A", "fixed | B");
    expect(parseChangelogTrailers(log)).toEqual([
      { date: "2026-06-18", kind: "new", title: "A" },
      { date: "2026-06-18", kind: "fixed", title: "B" },
    ]);
  });

  it("skips commits with no Changelog trailer", () => {
    const log = record("2026-06-18") + record("2026-06-17", "new | Real");
    expect(parseChangelogTrailers(log)).toEqual([
      { date: "2026-06-17", kind: "new", title: "Real" },
    ]);
  });

  it("skips malformed trailers (bad kind / blank title) with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = record("2026-06-18", "bogus | X", "new |   ", "fixed | Good");
    expect(parseChangelogTrailers(log)).toEqual([
      { date: "2026-06-18", kind: "fixed", title: "Good" },
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips records with a malformed date", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = record("not-a-date", "new | X");
    expect(parseChangelogTrailers(log)).toEqual([]);
    warn.mockRestore();
  });

  it("returns [] for empty input", () => {
    expect(parseChangelogTrailers("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/changelog/parse.test.ts`
Expected: FAIL — cannot resolve `@/lib/changelog/parse` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/changelog/parse.ts`:

```ts
import { z } from "zod";
import type { ChangelogEntry } from "./types";

// Field separators shared with the generator's `git log --format` string
// (Task 4 derives the git `%x..` escapes from these). Control characters that
// never appear in commit text keep parsing unambiguous.
export const RECORD_SEP = "\x00"; // between commits
export const FIELD_SEP = "\x1f"; // between a commit's date and its trailer block
export const VALUE_SEP = "\x1e"; // between multiple Changelog trailers in one commit

const kindSchema = z.enum(["new", "improved", "fixed"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Parse `git log` output (in the generator's fixed --format) into changelog
 * entries. Pure: no git, no I/O. Malformed trailers/dates are skipped with a
 * warning so a historical typo can never wedge the build.
 */
export function parseChangelogTrailers(gitLog: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  for (const record of gitLog.split(RECORD_SEP)) {
    if (!record.trim()) continue;

    const [rawDate = "", rawTrailers = ""] = record.split(FIELD_SEP);
    if (!rawTrailers.trim()) continue; // commit has no Changelog trailer

    const date = rawDate.trim();
    if (!dateSchema.safeParse(date).success) {
      console.warn(`changelog: skipping commit with bad date "${date}"`);
      continue;
    }

    for (const raw of rawTrailers.split(VALUE_SEP)) {
      const value = raw.trim();
      if (!value) continue;

      const [rawKind = "", title = "", description = ""] = value
        .split("|")
        .map((p) => p.trim());

      const kind = kindSchema.safeParse(rawKind);
      if (!kind.success || !title) {
        console.warn(`changelog: skipping malformed trailer "${value}"`);
        continue;
      }

      entries.push({
        date,
        kind: kind.data,
        title,
        ...(description ? { description } : {}),
      });
    }
  }

  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/changelog/parse.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/changelog/parse.ts src/lib/changelog/parse.test.ts
git commit -m "feat(changelog): pure trailer parser with format contract"
```

---

## Task 2: Frozen seed (`seed.ts`)

**Files:**

- Create: `src/lib/changelog/seed.ts`

- [ ] **Step 1: Create the seed**

Create `src/lib/changelog/seed.ts`. Dates verified from git history (landing
hero `2026-06-18`, interactive table `2026-06-15`); the other three carry over
the existing curated entries. Wording is user-facing — no scopes/jargon.

```ts
import type { ChangelogEntry } from "./types";

/**
 * Frozen, hand-curated history that predates the `Changelog:` trailer
 * convention. New entries come from commit trailers (see `generated.ts`); add
 * here only to backfill something shipped before the convention existed.
 */
export const SEED: ChangelogEntry[] = [
  {
    date: "2026-06-18",
    kind: "new",
    title: "Board automations",
    description:
      "Set up rules that react to changes on your board — a guided builder with ready-made recipes.",
  },
  {
    date: "2026-06-18",
    kind: "new",
    title: "New landing page",
    description: "A refreshed home page with an animated hero.",
  },
  {
    date: "2026-06-15",
    kind: "new",
    title: "Interactive boards",
    description:
      "Edit cells inline on the table view — changes save and sync live.",
  },
  {
    date: "2026-06-10",
    kind: "improved",
    title: "Faster board loads",
    description: "Large boards open noticeably quicker.",
  },
  {
    date: "2026-06-02",
    kind: "new",
    title: "Command palette",
    description: "Press ⌘K to jump anywhere and run actions without the mouse.",
  },
];
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS (no errors). `seed.ts` is not imported yet, but tsc compiles it.

- [ ] **Step 3: Commit**

```bash
git add src/lib/changelog/seed.ts
git commit -m "feat(changelog): frozen seed of pre-convention entries"
```

---

## Task 3: Committed generated artifact (`generated.ts`)

**Files:**

- Create: `src/lib/changelog/generated.ts`

- [ ] **Step 1: Create the initial generated file**

No commits carry a `Changelog:` trailer yet, so the generated list starts empty.
This file is committed so the page's import always resolves; Task 4's generator
overwrites it. Create `src/lib/changelog/generated.ts`:

```ts
import type { ChangelogEntry } from "./types";

// AUTO-GENERATED by `pnpm changelog:gen` from `Changelog:` commit trailers.
// Do not edit by hand. CI (develop) fails if this file drifts from git history.
export const GENERATED: ChangelogEntry[] = [];
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/changelog/generated.ts
git commit -m "feat(changelog): committed generated artifact (empty baseline)"
```

---

## Task 4: Generator script + `changelog:gen`

**Files:**

- Create: `scripts/generate-changelog.ts`
- Modify: `package.json`

- [ ] **Step 1: Add `tsx` devDependency**

Run: `pnpm add -D tsx`
Expected: `tsx` added to `devDependencies`; lockfile updated.

- [ ] **Step 2: Add the `changelog:gen` script**

Edit `package.json` `scripts` — add this entry (keep alongside `db:types`):

```json
"changelog:gen": "tsx scripts/generate-changelog.ts && prettier --write src/lib/changelog/generated.ts",
```

- [ ] **Step 3: Write the generator**

Create `scripts/generate-changelog.ts`. It derives the git `--format` escapes
from the parser's shared separators, runs `git log`, parses, and writes
`generated.ts`. (`changelog:gen` then prettifies it.)

```ts
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseChangelogTrailers,
  RECORD_SEP,
  FIELD_SEP,
  VALUE_SEP,
} from "../src/lib/changelog/parse.ts";

// Translate a separator char into a git pretty-format `%xNN` hex escape.
const hex = (c: string) => `%x${c.charCodeAt(0).toString(16).padStart(2, "0")}`;

// Per commit: short author date, FIELD_SEP, the Changelog trailer values
// (VALUE_SEP between multiple), then RECORD_SEP.
const format =
  `%ad${hex(FIELD_SEP)}` +
  `%(trailers:key=Changelog,valueonly,separator=${hex(VALUE_SEP)})` +
  `${hex(RECORD_SEP)}`;

const gitLog = execFileSync(
  "git",
  ["log", "--date=short", `--format=${format}`],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

const entries = parseChangelogTrailers(gitLog);

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../src/lib/changelog/generated.ts");

const file = `import type { ChangelogEntry } from "./types";

// AUTO-GENERATED by \`pnpm changelog:gen\` from \`Changelog:\` commit trailers.
// Do not edit by hand. CI (develop) fails if this file drifts from git history.
export const GENERATED: ChangelogEntry[] = ${JSON.stringify(entries, null, 2)};
`;

writeFileSync(outPath, file);
console.log(
  `changelog: wrote ${entries.length} generated entr${
    entries.length === 1 ? "y" : "ies"
  }`,
);
```

- [ ] **Step 4: Run the generator and confirm no drift**

Run: `pnpm changelog:gen`
Expected: prints `changelog: wrote 0 generated entries`; `generated.ts` is
rewritten to the same empty-array baseline (prettier-formatted).

Run: `git diff --exit-code src/lib/changelog/generated.ts`
Expected: exit 0, no diff (proves the generator reproduces the committed file).

- [ ] **Step 5: End-to-end proof with a throwaway trailer**

Verify the git→entry pipeline against a real commit (then undo it so it doesn't
pollute the changelog):

```bash
git commit --allow-empty -m "test: changelog pipeline probe

Changelog: new | Pipeline probe | Temporary end-to-end check."
pnpm changelog:gen
```

Expected: prints `changelog: wrote 1 generated entry`; `generated.ts` now
contains one entry titled "Pipeline probe" with today's date.

Now undo both the probe commit and the regenerated file:

```bash
git reset --hard HEAD~1
pnpm changelog:gen
git diff --exit-code src/lib/changelog/generated.ts
```

Expected: probe commit gone; `generated.ts` back to empty baseline; diff exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/generate-changelog.ts
git commit -m "feat(changelog): git-trailer generator + changelog:gen script"
```

---

## Task 5: Compose `entries.ts` + ordering test

**Files:**

- Modify: `src/lib/changelog/entries.ts`
- Create: `src/lib/changelog/entries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/changelog/entries.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupByDate } from "@/lib/changelog/entries";
import type { ChangelogEntry } from "@/lib/changelog/types";

describe("groupByDate", () => {
  it("orders groups newest-date-first, preserving authored order within a date", () => {
    const entries: ChangelogEntry[] = [
      { date: "2026-06-10", kind: "improved", title: "Older" },
      { date: "2026-06-18", kind: "new", title: "First on day" },
      { date: "2026-06-18", kind: "fixed", title: "Second on day" },
    ];

    const groups = groupByDate(entries);

    expect(groups.map((g) => g.date)).toEqual(["2026-06-18", "2026-06-10"]);
    expect(groups[0].entries.map((e) => e.title)).toEqual([
      "First on day",
      "Second on day",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes against current code, then change the source**

Run: `pnpm test src/lib/changelog/entries.test.ts`
Expected: PASS — `groupByDate` already exists and is correct; this test pins its
behavior before we change `CHANGELOG`'s source.

- [ ] **Step 3: Change `CHANGELOG` to compose seed + generated**

Edit `src/lib/changelog/entries.ts`. Replace the hand-written `CHANGELOG` array
literal (and add the two imports at the top) so the source becomes seed +
generated. Leave `ChangelogGroup`, `groupByDate`, and `formatDate` unchanged.

Replace the file's top section — from the first `import` line through the
closing `];` of the `CHANGELOG` array — with:

```ts
import type { ChangelogEntry } from "./types";
import { SEED } from "./seed";
import { GENERATED } from "./generated";

export interface ChangelogGroup {
  date: string;
  entries: ChangelogEntry[];
}

/**
 * The user-facing changelog: frozen pre-convention `SEED` plus everything
 * generated from `Changelog:` commit trailers. `groupByDate` sorts; entries may
 * appear in any order here.
 */
export const CHANGELOG: ChangelogEntry[] = [...SEED, ...GENERATED];
```

Leave everything from `export function groupByDate(` onward exactly as-is.

- [ ] **Step 4: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — `parse.test.ts`, `entries.test.ts`, and all existing tests
green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/changelog/entries.ts src/lib/changelog/entries.test.ts
git commit -m "feat(changelog): source CHANGELOG from seed + generated trailers"
```

---

## Task 6: CI drift guard + CONTRIBUTING docs

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Add the develop-scoped `changelog` job**

Edit `.github/workflows/ci.yml`. Append this job under `jobs:` (sibling of
`verify` and `commitlint`). It needs full history (`fetch-depth: 0`) and runs
only for develop — on `main` the squashed history has no trailers, so
regenerating there would emit an empty file and falsely fail.

```yaml
changelog:
  name: changelog (drift)
  runs-on: ubuntu-latest
  # Only meaningful where granular history exists. main is squashed.
  if: github.ref == 'refs/heads/develop' || github.base_ref == 'develop'
  steps:
    - uses: actions/checkout@v6
      with:
        fetch-depth: 0

    - name: Install pnpm
      uses: pnpm/action-setup@v6

    - name: Setup Node
      uses: actions/setup-node@v6
      with:
        node-version: 24
        cache: pnpm

    - name: Install dependencies
      run: pnpm install --frozen-lockfile

    - name: Regenerate changelog
      run: pnpm changelog:gen

    - name: Fail if changelog is stale
      run: git diff --exit-code src/lib/changelog/generated.ts
```

- [ ] **Step 2: Document the trailer convention in CONTRIBUTING.md**

Open `CONTRIBUTING.md`, find the section on commit messages / conventions, and
add the following subsection (place it near the commit-message guidance):

```markdown
### Changelog entries (`/updates`)

The public `/updates` page is generated from opt-in git trailers — no manual
list to maintain. To surface a change to users, add a trailer to that commit's
body:
```

Changelog: <kind> | <title> | <description>

```

- `kind` is one of `new`, `improved`, `fixed`.
- `title` is required; `description` is optional (`Changelog: new | Board automations` is valid).
- Use **user-facing** wording — no scopes, milestone codes (e.g. `(5b-1)`), or file names.
- The entry's date is the commit's author date.

After adding or changing a trailer, run `pnpm changelog:gen` and commit the
updated `src/lib/changelog/generated.ts`. CI (on develop) fails if it is stale.
Pre-convention history lives in `src/lib/changelog/seed.ts`.
```

- [ ] **Step 3: Verify CI YAML is well-formed**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!/^\s{2}changelog:/m.test(y)) throw new Error('changelog job missing'); console.log('changelog job present')"`
Expected: prints `changelog job present`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml CONTRIBUTING.md
git commit -m "ci(changelog): develop-scoped drift guard + document trailer convention"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run each and confirm output:

```bash
pnpm typecheck   # tsc --noEmit  → no errors
pnpm lint        # eslint        → no errors
pnpm test        # vitest run    → all pass (incl. parse + entries)
pnpm build       # next build    → succeeds; /updates prerendered (static)
```

Expected: all four pass. In `pnpm build` output, `/updates` is listed as a
static/prerendered route.

- [ ] **Step 2: Confirm no drift one last time**

Run: `pnpm changelog:gen && git diff --exit-code src/lib/changelog/generated.ts`
Expected: exit 0 (committed artifact matches generation).

- [ ] **Step 3: Final commit (if verification produced any formatting changes)**

```bash
git add -A
git commit -m "chore(changelog): verification pass" || echo "nothing to commit"
```

---

## Done criteria

- `/updates` renders the 5 seed entries today, newest-first (unchanged UI).
- Adding a `Changelog:` trailer + `pnpm changelog:gen` adds an entry; the
  end-to-end probe in Task 4 Step 5 proves this.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
- CI `changelog` job fails if `generated.ts` drifts (develop only).
- No DB, no runtime fetches; page stays fully static.
