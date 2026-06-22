// proxy.ts replaces middleware.ts in Next 16 (the `middleware` convention was
// renamed to `proxy`). Exports `proxy`, runs on the Node runtime.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import type { Database } from "@/types/database.types";

const AUTH_ROUTES = ["/login", "/signup", "/auth"];
// Public routes an unauthenticated visitor may view (exact match). `/` is the
// static MONOLITH landing for logged-out visitors (the proxy redirects an
// authenticated hit on `/` to /home below); `/landing` is the always-on splash
// the nav logo points to; `/updates` is the public changelog linked from the
// landing footer.
const PUBLIC_ROUTES = ["/", "/landing", "/updates"];

export async function proxy(request: NextRequest) {
  // Standard @supabase/ssr session-refresh pattern adapted to proxy.
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do NOT run any DB/org lookups here — session refresh + redirect only.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // A logged-in visitor never sees the static public landing: send them to the
  // dynamic /home dispatcher (orgs/boards lookup → board, onboarding, or welcome
  // shell). This is what lets `/` itself stay a static, edge-cached page for
  // anonymous traffic instead of a per-request server render.
  if (pathname === "/" && user) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

  if (!user && !isAuthRoute && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Match everything except Next internals, the favicon, static assets, and
    // the public marketing/auth routes that never gate on a server-resolved
    // `user` (`/login`, `/signup`, `/updates`). Dropping those lets Vercel serve
    // them straight from the CDN with zero proxy invocation — the TTFB win.
    // `/` stays matched (the authed → /home redirect above needs `user`); so
    // does `/auth/*` (the OAuth callback needs session-refresh cookies).
    "/((?!_next/static|_next/image|favicon.ico|login|signup|updates|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|otf|map)$).*)",
  ],
};
