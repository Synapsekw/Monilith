import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ADMIN = join(process.cwd(), "src/app/admin");
const read = (p: string) => readFileSync(join(ADMIN, p), "utf8");

/**
 * The three admin list fallbacks pass their column template to
 * AdminListSkeleton as a literal. Nothing type-checks that literal against the
 * page it stands in for — if a page gains a column, the skeleton silently keeps
 * the old tracks and the table snaps sideways on commit. This pins them
 * together.
 *
 * `users` reads its template from the exported USER_ROW_GRID constant, so the
 * expectation is asserted against that module rather than the page.
 */
describe("admin list skeleton column templates", () => {
  const cases = [
    {
      name: "users",
      source: join(process.cwd(), "src/components/admin/user-row.tsx"),
      loading: "users/loading.tsx",
    },
    {
      name: "organizations",
      source: join(ADMIN, "organizations/page.tsx"),
      loading: "organizations/loading.tsx",
    },
    {
      name: "feedback",
      source: join(
        process.cwd(),
        "src/components/feedback/FeedbackFilters.tsx",
      ),
      loading: "feedback/loading.tsx",
    },
  ];

  for (const { name, source, loading } of cases) {
    it(`${name}: the fallback uses the same grid template as the page`, () => {
      const template = /grid-cols-\[[^\]]+\]/.exec(
        readFileSync(source, "utf8"),
      );
      expect(template, `no grid template found in ${source}`).not.toBeNull();
      expect(read(loading)).toContain(template![0]);
    });
  }
});
