import path from "node:path";
import bundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

// Opt-in bundle report (dev tool). Fully inert in normal builds — with
// ANALYZE unset the wrapper returns the config untouched. NOTE: this webpack
// analyzer does NOT run under our default Turbopack `next build` (ANALYZE=true
// pnpm build only warns and emits no report). The working command for the
// default Turbopack path is `pnpm build:analyze` (→ `next experimental-analyze`,
// the Turbopack-native analyzer, v16.1+; writes to .next/diagnostics/analyze).
// This wrapper is kept only for the `next build --webpack` fallback.
// See package-bundling.md.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

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
    // `widget` for dashboard widget aggregations (Phase 9.3b): the board
    // cell-data feeding them changes from too many sources to tag reliably, so
    // freshness is bounded by a short TTL (widget *config* edits stay instant
    // via updateTag on the per-widget tag). revalidate >= 30 / expire >= 300
    // keeps it from forcing a dynamic hole in the 9.2 streaming shell (see
    // cacheLife.md, Prerendering behavior).
    widget: { stale: 30, revalidate: 30, expire: 300 },
  },
  images: {
    // Supabase Storage public avatar host (project-ref is a subdomain that
    // differs dev↔prod → wildcard). Avatars currently render `unoptimized`
    // so this allowlist is not load-bearing yet; it makes a future switch to
    // optimized avatars one flag away.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  experimental: {
    // The import wizard advertises a 5MB file cap, and files travel to the
    // preview/commit Server Actions as base64 (~1.37x inflation, ~6.9MB) inside
    // a JSON body. Next's default Server Action body limit is 1MB, which would
    // kill any real upload in transport before our friendly size guard ever
    // runs — 8mb gives the 5MB cap headroom. See serverActions.md#bodysizelimit.
    serverActions: {
      bodySizeLimit: "8mb",
    },
    // Barrel-optimize single-package deps whose named imports would otherwise
    // drag their whole barrel into a chunk: `radix-ui` (shadcn primitives) +
    // `framer-motion` (landing hero animation). Only list packages NOT already
    // optimized by default — `lucide-react` / `recharts` are default-optimized,
    // and `cmdk` / `react-day-picker` are single-component (no heavy barrel), so
    // they gain nothing here (see optimizePackageImports.md).
    optimizePackageImports: ["radix-ui", "framer-motion"],
  },
  // Baseline security response headers applied to every route. These are the
  // low-risk, high-value defaults:
  //   - X-Frame-Options: DENY — clickjacking protection (no framing anywhere).
  //   - X-Content-Type-Options: nosniff — stop MIME-type sniffing.
  //   - Referrer-Policy: strict-origin-when-cross-origin — don't leak full URLs
  //     (paths/query) to third-party origins.
  //   - Strict-Transport-Security — force HTTPS for 2 years incl. subdomains.
  // NOTE: a Content-Security-Policy is deliberately NOT set here. An enforced
  // CSP breaks Next's inline hydration/runtime scripts without a nonce pipeline
  // (middleware-generated per-request nonce), which is a larger change. CSP is
  // tracked as a deliberate follow-up.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
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

export default withBundleAnalyzer(nextConfig);
