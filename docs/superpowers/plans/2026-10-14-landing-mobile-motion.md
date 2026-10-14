# Landing mobile arrows and assembly repair

Approved scope: replace emoji-capable arrows with vectors and keep the mobile
assembly visible and responsive while scrolling. Preserve desktop design and
reduced-motion access. No API, model, credentials, or database changes.

## Execution DAG

- A: root reproduces mobile geometry, replaces arrows, and writes regressions.
  Consumes current landing; produces failing behavior tests and vector UI.
- B: independent read-only audit of mobile scroll/runtime (mobile_motion_audit).
  Consumes current landing; produces diagnosis and geometry recommendation.
- C: implement sticky art runway and elapsed-time smoothing. Depends on A + B.
- D: browser verification, independent review, required gates and release. Depends on C.

Parallel batch 1: A + B. Batch 2: C. Batch 3: review + visual verification.
Critical path: A/B → C → D → protected release checks.

## Performance budget

No new network requests on first paint or scroll. Arrows are inline SVG / a local
CSS mask. Reuse existing coalesced scroll listener, animation frame loop, bounded
canvas size/DPR, visibility observer, and disposal lifecycle. Mobile geometry
uses stable svh layout dimensions, not browser-toolbar-sensitive innerHeight.
Assembly reaches .84 before sticky release, holding the joined shape briefly;
.84 is the renderer's completed joint, before the desktop workspace transition.
Reduced-motion keeps a completed still shape without a scroll runway.

## Validation

Regression tests: vector/accessible arrows, forward/reverse runway progress,
viewport-height-only changes, reduced motion, existing cleanup and Mono flows.
Browser: small/large mobile, landscape, desktop; inspect pin bounds and progress.
Required finish gates: typecheck, lint, test, production build, DEV ledger check.
Release via develop→main PR only after checks pass, per standing owner authorization.

## Release evidence

- Source f4b03503; accessible-link regression adjustment f2bbaff5; integrated f1157a8b.
- 27 focused tests; 8,086 full-suite tests passed / 1 skipped; typecheck, lint,
  build and DEV ledger 176/176 passed through finish-task.sh.
- Develop CI 38600823667 and PR CI 38600907094 passed. PR #137 merged without
  conflicts to main 581449a3; healed develop 0528a291.
- Vercel production deployment 2KoJy7RTpVVHYbf8iyt3GbtxNfsx completed.
  Separate CLI preview was rejected as Not authorized; normal Git integration worked.
- Live 390×844: 15 landing SVG arrows, no Unicode arrows in rendered text,
  no horizontal overflow, artwork pinned at y=84 with height=480 through completed
  .84 progress; upward scroll restores .0. Mono exposes 3 vector prompt icons and
  a vector send icon. Local 375×667, short 667×375 and 1440×900 also checked.
- Reduced-motion behavior is regression-tested; physical iPhone acceptance remains.
- Post-merge main CI 38602621476 pending.
