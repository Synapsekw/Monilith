# PWA Installable Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Monolith installable (iOS add-to-home-screen + Chromium "Install app") as a chrome-less standalone window with a proper name, icon, splash, and theme color — no offline, no service worker.

**Architecture:** Purely additive Next.js 16 metadata. A typed `app/manifest.ts` (`MetadataRoute.Manifest`) served at `/manifest.webmanifest`, three new raster icon PNGs (192/512/maskable-512) in `public/` reusing the existing slab mark, and `viewport` + `appleWebApp` (+ manifest-link) additions to the root `layout.tsx`. No service worker, no `next.config` change, no new dependency, no runtime/boot env dependency.

**Tech Stack:** Next.js 16.2.x (App Router, Cache Components/PPR), React 19, TypeScript strict, Vitest (jsdom). Existing icon conventions already use `next/og` (`app/apple-icon.tsx`).

## Global Constraints

- **Read the Next 16 docs, not training data.** Metadata/manifest/viewport APIs live at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md` and `.../04-functions/generate-viewport.md` and `.../generate-metadata.md`. Confirm shapes there.
- **No service worker.** Offline is out of scope; do not add `serwist`/`next-pwa`/`workbox` or a `sw.js`, and do not touch `next.config.ts`.
- **No new boot-time / request-time env dependency.** `manifest.ts` MUST be a pure synchronous function — no import of `@/lib/env.*`, no Supabase client, no `cookies()`/`headers()`/`searchParams`. This keeps it statically prerendered and cannot regress the `src/instrumentation.ts` boot-env guard (the known CI gotcha where boot validation 500s `next start`/Lighthouse jobs lacking `SUPABASE_SERVICE_ROLE_KEY`).
- **Do not lock zoom.** In `viewport`, do NOT set `maximumScale`/`userScalable` — locking pinch-zoom is an a11y anti-pattern and fights the parent iPad-touch program.
- **Theme colors (verbatim):** dark base `#0d0d0f`, light base `#fafafa`. Manifest `background_color` and `theme_color` = `#0d0d0f`.
- **Copy (verbatim):** `name` = `"Monolith — Work OS"`, `short_name` = `"Monolith"`, Apple web-app `title` = `"Monolith"`. Reuse the existing `metadata.description` string for the manifest `description`.
- **Commit identity** is pinned by the worktree; stage explicitly by path (never `git add -A`). Commit subjects lowercase after `type(scope):`, with a descriptive body + the `Co-Authored-By` trailer.
- **Gates per task:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must pass.

---

### Task 1: Icon raster assets (192 / 512 / maskable-512)

**Files:**

- Create (asset, build-time task — see note): `public/icon-192.png` (192×192)
- Create (asset): `public/icon-512.png` (512×512)
- Create (asset): `public/icon-maskable-512.png` (512×512, maskable safe-zone)

**Interfaces:**

- Consumes: nothing.
- Produces: three stable public paths `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png` that Task 2's manifest `icons` array cites.

> **ASSET-GENERATION NOTE (flagged out-of-code scope):** These are binary PNGs, not code. They are rendered **once** from the existing cleaved-slab mark and committed. Two acceptable production methods — pick whichever the implementer has tooling for:
>
> **Method A (static PNGs, recommended):** Rasterize the mark from `src/app/apple-icon.tsx`'s `markSvg` onto a solid `#0D0D0F` background at each size. For `icon-192.png` / `icon-512.png` the mark fills the same relative box as the 180 apple-icon (`purpose:"any"`). For `icon-maskable-512.png` the mark must sit inside the **maskable safe zone**: keep all mark pixels within the centered circle of radius 40% (i.e. ~20% padding on every edge) so Android's mask never clips it; background stays full-bleed `#0D0D0F`. Any rasterizer works (`sharp`/`resvg`/`@vercel/og` offline, or export from a design tool). Commit the three files.
>
> **Method B (dynamic `next/og`, no binaries):** Instead of committing PNGs, create route files that mirror `src/app/apple-icon.tsx` exactly at each size — e.g. `src/app/icon-192/route.tsx`, `src/app/icon-512/route.tsx`, `src/app/icon-maskable-512/route.tsx` — each returning an `ImageResponse` of the slab mark on `#0D0D0F` (maskable one padded to the safe zone). Then Task 2 cites `/icon-192`, `/icon-512`, `/icon-maskable-512`. Use this if committing binaries is undesirable; it keeps the mark single-sourced but adds one cached render per size.

- [ ] **Step 1: Produce the three assets (Method A) or routes (Method B)**

Method A: generate and place the three PNGs at the paths above. Method B: create the three `route.tsx` files copying the `apple-icon.tsx` structure, adjusting `size` and (for maskable) the mark scale to the safe zone.

- [ ] **Step 2: Verify each asset resolves and has the right dimensions**

Method A — confirm files exist and are valid PNGs of the stated size:

```bash
node -e "const s=require('fs').statSync('public/icon-512.png'); console.log('bytes', s.size)"
```

Expected: prints a non-zero byte count for each of the three files (repeat for 192 and maskable). If a rasterizer with metadata is available, also confirm width/height equal the target. Method B — `pnpm dev` and `curl -I http://localhost:3000/icon-512` returns `200` with `content-type: image/png`.

- [ ] **Step 3: Commit**

Method A:

```bash
git add public/icon-192.png public/icon-512.png public/icon-maskable-512.png
git commit
```

Commit subject: `feat(pwa): add 192/512/maskable app icons for the web manifest`
(Method B: `git add src/app/icon-192/route.tsx src/app/icon-512/route.tsx src/app/icon-maskable-512/route.tsx` with subject `feat(pwa): add next/og icon routes for the web manifest`.)

---

### Task 2: Web app manifest (`app/manifest.ts`) + test

**Files:**

- Create: `src/app/manifest.ts`
- Test: `src/app/manifest.test.ts`

**Interfaces:**

- Consumes: the icon paths from Task 1 (`/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png` for Method A; `/icon-192`, `/icon-512`, `/icon-maskable-512` for Method B) plus the existing `/icon.svg`.
- Produces: a default-exported `manifest(): MetadataRoute.Manifest` served at `/manifest.webmanifest`. Task 3 references the route path `/manifest.webmanifest`.

- [ ] **Step 1: Write the failing test**

`src/app/manifest.test.ts` — models `src/app/streaming-shell-config.test.ts` (import + assert shape):

```ts
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest (installability contract)", () => {
  const m = manifest();

  it("carries the app identity", () => {
    expect(m.name).toBe("Monolith — Work OS");
    expect(m.short_name).toBe("Monolith");
    expect(m.description).toBeTruthy();
  });

  it("declares a standalone, root-scoped launch", () => {
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.background_color).toBe("#0d0d0f");
    expect(m.theme_color).toBe("#0d0d0f");
  });

  it("ships the icon sizes Chromium installability requires", () => {
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const purposes = (m.icons ?? []).map((i) => i.purpose);
    expect(purposes).toContain("maskable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/manifest.test.ts`
Expected: FAIL — `Cannot find module './manifest'`.

- [ ] **Step 3: Write the minimal implementation**

`src/app/manifest.ts` — pure synchronous function, no env/Supabase/request-time imports. (Method A paths shown; for Method B drop the `.png` suffixes.)

```ts
import type { MetadataRoute } from "next";

// Static web app manifest (served at /manifest.webmanifest). Pure + synchronous
// on purpose: no env, Supabase, or request-time API, so Next prerenders it
// statically and it adds ZERO boot-time/CI env requirements. Offline is out of
// scope — no service worker references here. Icons reuse the cleaved-slab mark.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Monolith — Work OS",
    short_name: "Monolith",
    description:
      "Monolith — a cloud-native Work OS. Visual boards, deep hierarchy, goals, and automations in one coherent product.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0d0d0f",
    theme_color: "#0d0d0f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/manifest.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Typecheck the new file**

Run: `pnpm typecheck`
Expected: no errors (confirms `MetadataRoute.Manifest` field/enum names — e.g. `display`, `purpose` — are valid in this Next version).

- [ ] **Step 6: Commit**

```bash
git add src/app/manifest.ts src/app/manifest.test.ts
git commit
```

Commit subject: `feat(pwa): add typed web app manifest served at /manifest.webmanifest`

---

### Task 3: Root metadata — viewport, appleWebApp, manifest link + test

**Files:**

- Modify: `src/app/layout.tsx` (the `metadata` export at lines ~16-20; add a `viewport` export)
- Test: `src/app/pwa-metadata.test.ts`

**Interfaces:**

- Consumes: the `/manifest.webmanifest` route from Task 2.
- Produces: nothing downstream (terminal task).

- [ ] **Step 1: Confirm whether Next auto-injects the manifest link**

Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md` and `.../04-functions/generate-metadata.md` (the `manifest` field, line ~660). Determine if `app/manifest.ts` alone emits `<link rel="manifest">`. Decision rule: if the docs/behavior confirm auto-injection, omit `metadata.manifest`; **if unconfirmed, set `manifest: "/manifest.webmanifest"` explicitly** (harmless if also auto-injected — dedupe is fine). Default to setting it explicitly.

- [ ] **Step 2: Write the failing test**

`src/app/pwa-metadata.test.ts` — import the exports from `layout.tsx` and assert the PWA shape. (`layout.tsx` is a server component importing only `next/font` + `@/components/providers`; if it imports cleanly under jsdom, assert the objects directly. If the import drags in client-only deps, fall back to the `readFileSync` source-assertion style of `src/app/app-shell-structure.test.ts`.)

```ts
import { describe, expect, it } from "vitest";
import { metadata, viewport } from "./layout";

describe("root PWA metadata", () => {
  it("sets a media-split theme color in the viewport export", () => {
    const tc = viewport.themeColor;
    expect(tc).toBeDefined();
    const colors = Array.isArray(tc)
      ? tc.map((t) => (typeof t === "string" ? t : t.color))
      : [typeof tc === "string" ? tc : tc?.color];
    expect(colors).toContain("#0d0d0f");
  });

  it("declares itself an installable apple web app", () => {
    expect(metadata.appleWebApp).toMatchObject({
      capable: true,
      title: "Monolith",
    });
  });

  it("links the web manifest", () => {
    expect(metadata.manifest).toBe("/manifest.webmanifest");
  });

  it("does NOT lock user zoom (a11y + iPad pinch-zoom)", () => {
    expect(viewport.userScalable).not.toBe(false);
    expect(viewport.maximumScale).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/app/pwa-metadata.test.ts`
Expected: FAIL — `viewport` is not exported / `metadata.appleWebApp` undefined.

- [ ] **Step 4: Implement the metadata additions**

Edit `src/app/layout.tsx`. Add `Viewport` to the type import, extend `metadata`, and add a `viewport` export:

```tsx
import type { Metadata, Viewport } from "next";
```

```tsx
export const metadata: Metadata = {
  title: "Monolith — Work OS",
  description:
    "Monolith — a cloud-native Work OS. Visual boards, deep hierarchy, goals, and automations in one coherent product.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Monolith",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0f" },
  ],
};
```

Leave the default component body untouched. Do NOT add `maximumScale`/`userScalable`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/app/pwa-metadata.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 6: Verify the rendered `<head>` in a real build**

Run: `pnpm build && pnpm start` (ensure `.env.local` is present so the `instrumentation.ts` boot guard passes), then:

```bash
curl -s http://localhost:3000/ | grep -Eio '<link[^>]*rel="manifest"[^>]*>|<meta[^>]*name="theme-color"[^>]*>|mobile-web-app-capable'
```

Expected: a `rel="manifest"` link to `/manifest.webmanifest`, two `theme-color` metas (light/dark), and `mobile-web-app-capable`. Also `curl -s http://localhost:3000/manifest.webmanifest` returns the JSON with the `name`/`icons` from Task 2.

- [ ] **Step 7: Commit**

```bash
git add src/app/layout.tsx src/app/pwa-metadata.test.ts
git commit
```

Commit subject: `feat(pwa): add viewport theme-color, apple web-app meta, and manifest link`

---

### Task 4: Full-gate verification + close out

**Files:** none (verification only).

**Interfaces:** Consumes Tasks 1-3.

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four pass. (`build` also confirms `manifest.ts` prerenders statically — look for `/manifest.webmanifest` as a static/prerendered route in the build output, not a dynamic ƒ.)

- [ ] **Step 2: Confirm no dependency / config drift**

Run: `git diff --stat develop...HEAD` and confirm the change set is only: the three icon assets (or routes), `src/app/manifest.ts`, `src/app/layout.tsx`, and the two/three test files. Confirm `package.json`, `pnpm-lock.yaml`, and `next.config.ts` are **unchanged** (no service worker / PWA plugin crept in).

- [ ] **Step 3: Finish the task**

Run `scripts/finish-task.sh` from inside the worktree (rebases onto `develop`, re-runs gates, merges, cleans up).

---

## Execution DAG (working-agreement #6)

**Dependency graph:**

- Task 1 (icon assets) → depends on nothing.
- Task 2 (manifest) → **depends on Task 1** (must not cite icon paths that don't exist, or the installability/Lighthouse check fails on missing icons).
- Task 3 (layout metadata) → depends only on the **fixed constant** `/manifest.webmanifest` (Task 2's route path), not on Task 2's internals — it can be authored in parallel with Tasks 1-2.
- Task 4 (full-gate close-out) → depends on Tasks 1, 2, 3.

**Parallel batches:**

- **Batch A (concurrent):** Task 1 **and** Task 3. They touch disjoint files (`public/*` vs `src/app/layout.tsx`) with no shared state.
- **Batch B:** Task 2 (after Task 1 merges — needs the real icon paths).
- **Batch C:** Task 4 (after all merge).

**Critical path (wall-clock floor):** Task 1 → Task 2 → Task 4. Task 3 hides under that chain.

**Practical note:** This is a small, mostly-additive change; the whole thing is comfortably one worktree/session. The one ordering rule an implementer must not violate is **icons before the manifest that references them** — everything else is free ordering. Dispatch Batch A's two tasks concurrently only if using parallel subagents; otherwise the natural order Task 1 → 2 → 3 → 4 is fine.
