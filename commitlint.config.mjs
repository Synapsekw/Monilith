/**
 * Conventional Commits enforcement.
 * Format: type(optional-scope): subject  — e.g. `feat(boards): add group reordering`.
 * Allowed types come from @commitlint/config-conventional:
 *   feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
 * Scopes are free-form (auth, db, tenancy, ci, vault, …). Merge commits are ignored.
 */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Allow longer wrapped body/footer lines (our commit bodies + Co-Authored-By trailer).
    "body-max-line-length": [0, "always", Infinity],
    "footer-max-line-length": [0, "always", Infinity],
  },
};

export default config;
