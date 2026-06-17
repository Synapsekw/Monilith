# MONOLITH landing page — design

**Date:** 2026-06-17
**Status:** Approved (design), ready for implementation plan
**Topic:** Public landing page — animated MONOLITH wordmark over a monolith, click → auth

## Summary

A deliberately minimal public landing page: the text wordmark **MONOLITH** centered on a
near-black background, with an animated monolith (a cleaved, floating slab + a rising column
of light) behind it. The entire hero is a click target that takes the visitor to `/login`.

The look was chosen interactively (visual companion): **Obelisk** direction → **Archivo 800**
wordmark → **Cleaved** slab shape → **Column** shaft glow → **Ice** (near-white) glow color.

## Decisions (locked)

| Aspect           | Decision                                                                        |
| ---------------- | ------------------------------------------------------------------------------- |
| Route            | Public root `/`. Logged-in users are redirected to their app (never see it).    |
| Click target     | `/login` (whole hero is the link).                                              |
| Content          | Just the `MONOLITH` wordmark + animation. No tagline, nav, or footer.           |
| Wordmark font    | **Archivo**, weight 800 (loaded via `next/font/google`, scoped to landing).     |
| Monolith shape   | **Cleaved** — a slab with an angled top cut (`clip-path` polygon).              |
| Glow             | **Column** — a vertical shaft of light rising behind the slab.                  |
| Glow color       | **Ice** — near-white `#bac8ff` (subtle, monochrome-leaning).                    |
| Background       | Dark-first palette: near-black base `#0d0d0f`, with a radial vignette.          |
| Hover affordance | Wordmark letter-spacing opens slightly + faint glow; "Click to enter" fades in. |
| Motion           | Slab `float` + shaft `shaft` breathing; both disabled under reduced-motion.     |

## Architecture

### Rendering — pure Server Component, zero JS

The hero animation is CSS-only, the hover affordance is CSS-only, and the action is a single
navigation. There is **no client component / island** — the hero is a Server Component wrapping
its content in a Next.js `<Link href="/login">`. Nothing is shipped to the client beyond the
markup, the CSS module, and the font.

### Routing — `src/app/page.tsx`

Today `/` calls `requireUser()` (redirects unauthenticated visitors to `/login`) and then routes
authenticated users onward. This changes so the **unauthenticated** branch renders the landing
instead of bouncing to `/login`:

```
const user = await getUser();           // nullable, no redirect
if (!user) return <MonolithHero />;     // public landing

// authenticated — UNCHANGED from today:
const orgs = await getUserOrgs();
if (orgs.length === 0) redirect("/onboarding");
const boards = await listBoards();
if (boards.length > 0) redirect(`/boards/${boards[0].id}`);
return <AppShell …>…Welcome…</AppShell>;
```

Net effect: logged-out visitors see the landing at `/`; logged-in users keep today's behavior
(onboarding / first board / Welcome shell) and never see the landing.

### Components

- **`src/components/landing/monolith-hero.tsx`** — Server Component. Renders, inside a
  `<Link href="/login">`: the vignette layer, the Ice column-shaft glow, the cleaved floating
  slab, the Archivo `MONOLITH` wordmark, and the "Click to enter" hover cue. Applies the Archivo
  `next/font` className to the wordmark. One clear purpose: present the clickable hero. Depends
  only on `next/link`, `next/font/google`, and its CSS module.
- **`src/components/landing/monolith-hero.module.css`** — landing-specific styles: the `float`
  and `shaft` keyframes, the `.slab` clip-path shape, the `.glow` Ice gradient, the vignette,
  and the `@media (prefers-reduced-motion: reduce)` override. Kept out of `globals.css` so the
  one-off landing animation doesn't pollute the global token/animation layer.

Both are understandable and testable in isolation; `monolith-hero` can be rendered standalone in
a test without auth or data.

## Data flow & performance budget

- **First paint:** static markup + one CSS module + one font. **No data fetch.**
- **Interactions:** the only action is clicking the hero → an RSC navigation to `/login`.
  There are no in-page toggles/tabs/filters, so the gotcha-09 refetch concern does not apply.
- **Authenticated path:** unchanged; keeps its existing bounded, indexed queries
  (`getUserOrgs`, `listBoards`).

## Error handling

- `getUser()` already returns `null` on no session — no throw, landing renders.
- No user input, no mutations, no external calls on the landing → no error surface beyond
  normal navigation. The authed branch retains today's behavior.

## Accessibility

- The `<Link>` gives a real, keyboard-focusable, semantic navigation target; `MONOLITH` is the
  accessible name. The "Click to enter" cue is decorative/supplementary.
- `prefers-reduced-motion: reduce` disables both animations (static slab + glow).
- Wordmark/background contrast is near-white on near-black — well above AA.

## Testing (Vitest + React Testing Library)

1. **`monolith-hero`**
   - renders the `MONOLITH` wordmark text;
   - the hero is a link whose `href` is `/login`;
   - the "Click to enter" cue is present in the markup.
2. **Root `page.tsx`**
   - when `getUser()` resolves to `null`, the landing renders (assert a `/login` link, no
     redirect);
   - when a user and a board exist, it redirects (assert `redirect` invoked) — mirrors the
     existing page-test mocking style for the Supabase/session layer.

## Out of scope (YAGNI)

- No tagline, marketing copy, nav, footer, or secondary CTAs.
- No theming/color switching of the glow at runtime — Ice is fixed.
- No signup link on the landing (the login page already offers the switch to signup).
- No analytics/telemetry hooks.

## Verification gate

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green before "done".
