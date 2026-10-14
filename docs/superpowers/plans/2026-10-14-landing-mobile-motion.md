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
