import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components / PPR by default (Next 16): the static app shell (sidebar +
  // header chrome) is prerendered, while per-user data streams into the Suspense
  // boundaries declared in the authenticated layouts (Phase 9.2).
  cacheComponents: true,
  // Phase 9.3 named cache profiles. `nav` for per-user/per-org sidebar lists
  // (tolerate ~1m staleness; read-your-own-writes handled by updateTag). `guard`
  // for the admin-flag reads (change very rarely). Both keep revalidate >= 60s
  // and expire >= 5m so neither becomes a forced dynamic hole inside the 9.2
  // streaming shell (see cacheLife.md, Prerendering behavior).
  cacheLife: {
    nav: { stale: 60, revalidate: 60, expire: 3600 },
    guard: { stale: 60, revalidate: 300, expire: 3600 },
  },
  // Move the on-screen dev indicator (the Next.js logo button) to the bottom
  // right; it defaults to bottom-left. See devIndicators.md.
  devIndicators: {
    position: "bottom-right",
  },
  // Pin the workspace root to this project. Without this, Turbopack walks up and
  // finds C:\Users\D\package-lock.json (the user's global husky/lint-staged setup)
  // and mis-infers the root. See node_modules/next/.../turbopack.md#root-directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
