# Landing scrollbar and Mono latency repair

## Evidence and scope

Chrome screenshot shows a light root scrollbar beside the dark Assembly landing. The landing sets a dark color scheme only on its child wrapper; the root scrollbar inherits the app theme. Live Mono connect took 2.7s and two replies 9.6s / 8.4s. Its chat path performs sequential remote storage work; Aria comparison is being checked independently. Preserve the approved design, gpt-6-luna, encrypted durable records, CSRF, rate ceilings, explicit contact consent and callback idempotency.

## Execution DAG

- A: root inspects scrollbar and reproduces light-root behavior; consumes Assembly CSS and Chrome screenshot, produces a scoped CSS repair and browser evidence.
- B: read-only comparison agent inspects Aria/Orbit; consumes public sources, produces request-path and timing evidence. Independent of A, dispatched concurrently.
- C: root measures Mono storage waits and adds a failing performance/recovery regression; consumes service + B evidence, produces bounded optimizations with preserved concurrency and recovery behavior.
- D: integration review and full repository gates depend on A and C; then merge to develop and clean the task worktree. Production promotion follows existing authorization and release checks.

## Performance and data budget

No new page-load requests, no UI refetches, no unbounded reads. Scrollbar styling is CSS scoped by landing presence and releases on navigation. Mono continues one model call per new message and never repeats it for saved-reply recovery; reduce only independent or redundant storage waits. Contact sends remain separate and consented. Test with controlled per-RPC latency and compare live timing if deployment proceeds.

## Verification

Reproduce light-theme scrollbar before/after, at desktop and mobile widths, then navigate away to verify isolation. Add behavior tests for reduced serialized storage latency, reply recovery after storage failures, concurrent requests and unchanged rate limits. Run typecheck, lint, full tests, build and ledger check through finish-task. Record exact evidence and do not claim live speedup from a local benchmark.
