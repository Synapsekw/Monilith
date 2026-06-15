---
type: adr
date: 2026-06-15
status: accepted
tags: [decision, gotcha]
related:
  [
    "[[2026-06-15-1053-phase2a-boards-core]]",
    "[[2026-06-14-gotcha-01-next16-not-next15]]",
  ]
---

# Gotcha 04 — dispatch Server Actions inside `startTransition` or redirects don't navigate

## Context

In React 19 + Next 16, when a `useActionState` dispatcher is called manually (e.g. inside a
react-hook-form `handleSubmit` callback) rather than via a form's `action={formAction}` prop, it
runs **outside a transition**. The server action still executes — the Supabase session cookie is
set — but Next does **not** process the action's `redirect(...)` as a client navigation. The user
stays on the current page (e.g. stuck on `/login` after a successful sign-in). `proxy.ts` only
redirects _unauthenticated_ users _off_ protected routes, so there is no safety net.

This shipped latent in Phase 1 (`auth-form.tsx`, `onboarding-form.tsx`); unit tests run in jsdom
and the Phase-1 e2e only covered unauthenticated routes, so nothing exercised the real redirect.
The first authenticated e2e (Phase 2a) surfaced it.

## Decision

Any manual `useActionState` dispatch that relies on a server-side `redirect()` MUST be wrapped:

```ts
startTransition(() => {
  formAction(formData);
});
```

## Rationale

The redirect-as-navigation handoff is part of React's transition machinery; dispatching outside a
transition both emits the "called outside of a transition" warning and silently drops the
navigation. Wrapping restores it. Verified empirically: with the fix, the boards e2e passes
**without** its earlier `page.goto()` / `waitForTimeout` workarounds.

## Consequences

- Positive: post-login and post-onboarding navigation works for real users, not just in tests.
- Watch-out: this applies to every future form that dispatches an action + redirects (e.g. 2b
  flows). Prefer `<form action={formAction}>` when not using RHF; when using RHF + manual dispatch,
  always wrap in `startTransition`.

## Related

- [[2026-06-14-gotcha-01-next16-not-next15]] — this is "not the Next.js you know" in action.
- [[2026-06-15-1053-phase2a-boards-core]]
