---
type: adr
date: 2026-06-23
status: accepted
tags: [decision, gotcha, nextjs, rsc, client-components]
related:
  - "[[2026-06-23-1943-feedback-bugs-feature-requests]]"
---

# Gotcha 42: never pass a function child (render-prop) from a Server Component to a Client Component

## Context

The feedback admin list shipped a client `FeedbackFilters` as a **render-prop wrapper**:

```tsx
// FeedbackFilters.tsx  ("use client")
export function FeedbackFilters({ rows, children }: {
  rows: Row[];
  children: (filtered: Row[]) => React.ReactNode;   // ← render prop
}) { ... return <>{children(filtered)}</>; }

// page.tsx  (Server Component, async RSC)
<FeedbackFilters rows={rows}>
  {(filtered) => <table>…</table>}                  // ← function child
</FeedbackFilters>
```

It typechecked, linted, and **built** clean, then blew up at **runtime**:

```
Functions are not valid as a child of Client Components.
  <... rows={[...]} children={function children}>
```

Props (including `children`) handed from a Server Component to a Client Component must be
**serializable** — they cross the RSC payload. A function isn't serializable, so a render-prop /
function-as-child from an RSC parent is rejected. (Function children are fine **client→client** and
**server→server**; the trap is specifically the RSC→client hop.) It slips past every static gate
because it's only enforced when React actually serializes the tree on a request.

## Decision

When an interactive client component needs to wrap server-fetched data:

- **Render the dependent markup INSIDE the client component**, passing only serializable **data**
  (arrays/objects/strings) across the boundary — `<FeedbackFilters rows={rows} />`, list rendered
  within. This is the fix that shipped (`3bd9ac4`).
- If you genuinely need server-rendered markup inside a client shell, pass it as a **prebuilt
  element** via a prop/`children` (e.g. `<Client>{<ServerThing/>}</Client>`) — an element is
  serializable, a function is not. Do **not** reach for a render-prop across the boundary.

## Consequences

- Client wrappers over server data own their list rendering (slightly less "presentational"
  separation), which is the correct trade for App Router.
- **Testing gap to close:** leaf-component unit tests with mock props will NOT catch this — the
  failure is in the server/client _composition_. For any RSC-page → client-component seam, either a
  build-time prerender of the route or a runtime smoke check is the only thing that surfaces it.
  Add a route-level render check when a page composes a client component with non-trivial props.
