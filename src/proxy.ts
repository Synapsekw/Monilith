// proxy.ts replaces middleware.ts in Next 16 (the `middleware` convention was
// renamed to `proxy`). Exports `proxy`, runs on the Node runtime.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import type { Database } from "@/types/database.types";

const AUTH_ROUTES = ["/login", "/signup", "/auth"];
// Public routes an unauthenticated visitor may view (exact match). The root is
// the MONOLITH landing page; the page itself redirects authenticated users on.
const PUBLIC_ROUTES = ["/"];

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
    // Match everything except Next internals, the favicon, and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|otf|map)$).*)",
  ],
};
