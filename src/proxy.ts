// proxy.ts replaces middleware.ts in Next 16 (the `middleware` convention was
// renamed to `proxy`). Exports `proxy`, runs on the Node runtime.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { boardIdFromPath, LAST_BOARD_COOKIE } from "@/lib/boards/last-board";
import { loginPath, NEXT_PATH_HEADER } from "@/lib/auth/next-path";
import type { Database } from "@/types/database.types";

// Auth-flow routes an unauthenticated visitor must reach. `/forgot-password`
// is the self-serve reset-request page — without it here the proxy's
// authed-only fallback (below) would bounce a logged-out user to /login,
// making the flow impossible. The recovery link lands on /change-password with
// a session already established, so that one gates on isAuthenticated normally.
const AUTH_ROUTES = ["/login", "/signup", "/auth", "/forgot-password"];
// Public routes an unauthenticated visitor may view (exact match). `/` is the
// static MONOLITH landing for logged-out visitors (the proxy redirects an
// authenticated hit on `/` to /home below); `/landing` is the always-on splash
// the nav logo points to; `/updates` is the public changelog linked from the
// landing footer.
const PUBLIC_ROUTES = ["/", "/landing", "/updates"];
// Prefix-matched routes that are NEVER authenticated by a session cookie, so a
// cookie-based gate can only break them. `/.well-known/oauth-*` is public
// metadata by RFC 8414 / RFC 9728; `/api/oauth/*` is the OAuth 2.1 authorization
// server, authenticated by PKCE + client_id (and `authorize` must reach its own
// handler so it can validate client_id/redirect_uri before bouncing to login);
// `/api/mcp` is Bearer-authenticated and must be free to answer 401 with the
// WWW-Authenticate challenge that starts MCP discovery. Without these, an MCP
// client gets an HTML login redirect where it expects JSON, and the connect flow
// cannot complete. Each endpoint authenticates itself — nothing new is exposed.
//
// The `pg_cron` -> `pg_net` endpoints belong here for exactly the same reason and
// were missing until 2026-08-01: a cron call carries NO session cookie, so the
// gate below 307'd each one to /login, and a POST to /login (a page route) answers
// **405**. pg_net records that in `net._http_response` but nothing surfaces it, so
// embed-sweep / automation-ai-reconcile / autopilot-sweep / health-digest-ping all
// reported `succeeded` while their work never ran. Every one of these verifies its
// own HMAC before doing anything (AI_PGNET_HMAC_SECRET via verifyBody; the digest
// uses DIGEST_SECRET), so exempting them from the cookie gate exposes nothing.
// Listed individually rather than as `/api/ai/` so a future session-authenticated
// route added under that path is not silently made public.
const PUBLIC_PREFIXES = [
  "/.well-known/oauth-",
  "/api/oauth/",
  "/api/mcp",
  "/api/ai/embed",
  "/api/ai/automation-step",
  "/api/ai/autopilot",
  "/api/ai/personal-agent",
  "/api/digest/run",
];

export async function proxy(request: NextRequest) {
  // Stamp the resolved path on the FORWARDED REQUEST (never on the
  // client-visible response) so server-side gates — requireUser(),
  // requirePlatformAdmin(), /home, /change-password — can rebuild the `?next=`
  // target without a parameter at each of their ~48 call sites. RSC has no
  // usePathname() equivalent; a proxy-set request header is the documented way
  // to pass information from proxy to app.
  //
  // Built fresh at EVERY construction site rather than cloned once up front: the
  // Supabase cookie adapter below calls request.cookies.set(...) on a session
  // refresh, which writes through to this request's `Cookie` header. A snapshot
  // taken before that would forward a STALE cookie upstream — a silent logout.
  const forwardedResponse = () => {
    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.set(
      NEXT_PATH_HEADER,
      request.nextUrl.pathname + request.nextUrl.search,
    );
    return NextResponse.next({ request: { headers: forwardedHeaders } });
  };

  // Standard @supabase/ssr session-refresh pattern adapted to proxy.
  let response = forwardedResponse();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write to BOTH the request (so getUser sees the refreshed session)
          // and a rebuilt response (so the browser receives the new cookies).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = forwardedResponse();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do NOT run any DB/org lookups here — session refresh + redirect only.
  //
  // getClaims() verifies the JWT LOCALLY against the cached JWKS (asymmetric
  // ES256 signing keys are enabled), so it adds NO network call in the common
  // case. Crucially it still routes through getSession() → __loadSession(),
  // which is where near-expiry token refresh happens and where the refreshed
  // cookies get written back via the cookie adapter above — so swapping
  // getUser() (which paid an extra unconditional GET /user every request) for
  // getClaims() keeps refresh intact while dropping that round-trip.
  // NB: never pass a token into getClaims() — the one-arg form skips
  // getSession() and would DISABLE refresh (silent logout). Call it with ().
  const { data: claimsData } = await supabase.auth.getClaims();
  const isAuthenticated = !!claimsData?.claims;

  const { pathname } = request.nextUrl;

  // A logged-in visitor never sees the static public landing: send them to the
  // dynamic /home dispatcher (orgs/boards lookup → board, onboarding, or welcome
  // shell). This is what lets `/` itself stay a static, edge-cached page for
  // anonymous traffic instead of a per-request server render.
  if (pathname === "/" && isAuthenticated) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const isPublicPrefix = PUBLIC_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );

  if (!isAuthenticated && !isAuthRoute && !isPublicRoute && !isPublicPrefix) {
    // Carry where they were going so /login can send them back after sign-in.
    return NextResponse.redirect(
      new URL(
        loginPath(request.nextUrl.pathname + request.nextUrl.search),
        request.url,
      ),
    );
  }

  // Remember the last board the user actually navigated to, so /home can skip
  // its list reads next login. Prefetches are excluded — a hovered board link
  // must not hijack the fast path. Set on the FINAL response object (the
  // supabase adapter above may have rebuilt `response`).
  const lastBoardId = isAuthenticated ? boardIdFromPath(pathname) : null;
  const isPrefetch =
    request.headers.get("next-router-prefetch") !== null ||
    request.headers.get("purpose") === "prefetch";
  if (lastBoardId && !isPrefetch) {
    response.cookies.set(LAST_BOARD_COOKIE, lastBoardId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export const config = {
  matcher: [
    // Match everything except Next internals, the favicon, the web manifest,
    // static assets, and the public marketing/auth routes that never gate on a
    // server-resolved `user` (`/login`, `/signup`, `/updates`). Dropping those
    // lets Vercel serve them straight from the CDN with zero proxy invocation —
    // the TTFB win. The manifest MUST be excluded: it is a public, static,
    // auth-free route, and an anonymous visitor on the landing page installs the
    // app, so gating it would 307 the manifest fetch to /login and break the
    // install prompt. `/` stays matched (the authed → /home redirect above needs
    // the resolved identity); so does `/auth/*` (the OAuth callback needs
    // session-refresh cookies).
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|login|signup|updates|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|otf|map)$).*)",
  ],
};
