/**
 * Runs integration-test teardown steps in order, with per-step failure
 * isolation: a step that throws or returns a Supabase `{ error }` does NOT
 * stop the steps queued after it. Every step is always attempted.
 *
 * This matters specifically because these suites provision real rows against
 * a live database (never DEV/PROD in CI — gated by `integrationTargetReady()`
 * — but always a real Postgres when they do run). Without per-step isolation,
 * one failed delete in an `afterAll` silently strands every row queued after
 * it: a plain `for` loop of bare `await`s aborts on the first throw.
 *
 * Failures are collected, not swallowed: after every step has been
 * attempted, one aggregate error is thrown so a genuine teardown problem
 * fails the suite loudly instead of leaking rows unnoticed.
 *
 * Order is caller-controlled and MUST be preserved by the caller — e.g.
 * deleting an `organizations` row before the owning `auth.users` row, because
 * `organizations.created_by` is NOT NULL / NO ACTION (2026-07-25
 * account-deletion-fks migration). This helper does not reorder steps; it
 * only keeps an earlier step's failure from aborting the later steps that
 * still need to run.
 */
export type TeardownStep = {
  label: string;
  run: () => Promise<{ error: unknown }>;
};

export async function runTeardownSteps(steps: TeardownStep[]): Promise<void> {
  const failures: string[] = [];
  for (const step of steps) {
    try {
      const { error } = await step.run();
      if (error) failures.push(`${step.label}: ${describeError(error)}`);
    } catch (e) {
      failures.push(`${step.label}: ${describeError(e)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Teardown had ${failures.length} failure(s) — rows may be stranded:\n` +
        failures.join("\n"),
    );
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e)
    return String((e as { message: unknown }).message);
  return String(e);
}
