/**
 * The `?next=` post-sign-in redirect rules, shared by every gate that bounces an
 * unauthenticated visitor to /login and by every consumer that sends them back
 * afterwards.
 *
 * This module is deliberately PURE — no `next/*` imports. `src/proxy.ts` imports
 * it, and a proxy bundle must not pull in `next/headers` or a route module. The
 * request-bound read (`loginRedirectPath`) lives in `src/lib/auth/session.ts`.
 */

/**
 * Request header `src/proxy.ts` stamps on the forwarded request so server-side
 * gates (`requireUser`, `requirePlatformAdmin`, …) can rebuild the `?next=`
 * target without a parameter at each of their ~48 call sites. RSC has no
 * `usePathname` equivalent; passing information from proxy to app via a request
 * header is the documented mechanism
 * (next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 */
export const NEXT_PATH_HEADER = "x-pulse-path";

/**
 * Origin used only to resolve a candidate against a *known* base so we can ask
 * "did this stay same-origin?". `.invalid` is reserved by RFC 2606, so it can
 * never be a real host we might confuse with a real target.
 */
const PROBE_ORIGIN = "https://pulse.invalid";

/** Refuse `next` targets inside the auth flow itself: sending a signed-in user
 * back to /login is a redirect loop, and "sign in, then land on a sign-in page"
 * is a credential-phishing shape we should never generate. */
const AUTH_FLOW_PATHS = [
  "/login",
  "/signup",
  "/auth",
  "/forgot-password",
] as const;

/** Cap on the accepted value so a hostile `next` cannot push the `Location`
 * header toward a 431 Request Header Fields Too Large. */
const MAX_LENGTH = 2048;

/**
 * Reduce an untrusted `next` value to a guaranteed same-origin, rooted path, or
 * `"/"`.
 *
 * TOTAL by design — it never throws and always returns a usable path, so a
 * malformed `next` degrades to the dashboard instead of turning a valid sign-in
 * into an error page. Call it at EVERY boundary that reads a `next`, including
 * the `FormData` field (which the browser can forge independently of the URL).
 *
 * Accepts `string[]` because Next.js `searchParams` yields an array for a
 * repeated param (`?next=a&next=b`).
 */
export function safeNextPath(
  next: string | string[] | null | undefined,
): string {
  if (typeof next !== "string" || next === "") return "/";
  if (next.length > MAX_LENGTH) return "/";

  // Browsers AND the WHATWG URL parser STRIP tab/LF/CR before parsing, so
  // "/\n/evil.com" silently becomes "//evil.com" — protocol-relative, i.e.
  // off-site. (Verified: new URL("/\n/evil.com", origin) === "https://evil.com/".)
  // A raw LF in a value that reaches a Location header is also header injection.
  // Reject the whole ASCII control range rather than trying to strip it.

  if (/[\u0000-\u001F\u007F]/.test(next)) return "/";

  // Must be rooted at a SINGLE "/": reject "//host" (protocol-relative),
  // "/\host" (browsers normalize backslashes), and anything not rooted at all
  // ("https://evil.com", "evil.com", "javascript:…").
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.startsWith("/\\")) return "/";

  // Belt-and-braces: resolve against a known origin and require it to stay
  // there. This makes the guarantee structural instead of a list of known
  // tricks, so the next unknown parser quirk fails closed.
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== PROBE_ORIGIN) return "/";

  if (
    AUTH_FLOW_PATHS.some(
      (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
    )
  ) {
    return "/";
  }

  const target = `${url.pathname}${url.search}${url.hash}`;
  // Canonicalization can MANUFACTURE a protocol-relative value the checks above
  // never saw: new URL("/..//evil.com", origin).pathname === "//evil.com".
  // Re-check the output, not just the input.
  if (target.startsWith("//")) return "/";
  return target;
}

/**
 * The `/login` URL to redirect an unauthenticated visitor to, carrying a
 * sanitized `?next=` when there is a destination worth resuming. `"/"` is the
 * post-sign-in default, so it is expressed as a bare `/login` (no noise param).
 */
export function loginPath(next: string | string[] | null | undefined): string {
  const safe = safeNextPath(next);
  return safe === "/" ? "/login" : `/login?next=${encodeURIComponent(safe)}`;
}
