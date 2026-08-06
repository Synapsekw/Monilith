/**
 * Redirect-URI matching for the MCP OAuth authorization server.
 *
 * PURE by design — no `server-only`, no `next/*`, no DB. Both gates that decide
 * whether a redirect_uri belongs to a client call this one function:
 * `src/app/api/oauth/authorize/route.ts` (pre-consent) and
 * `src/app/oauth/consent/actions.ts` (at code issuance). They must never drift
 * apart: a laxer authorize than consent shows a consent screen that then throws,
 * and a laxer consent than authorize is an open redirect.
 *
 * ## Why this is not just `redirect_uris.includes(candidate)`
 *
 * Exact string matching is correct for web clients (claude.ai registers one
 * fixed https callback) but silently breaks every NATIVE/CLI client. A CLI
 * asks the OS for an EPHEMERAL loopback port at login time, so the port differs
 * on every run: it registers `http://127.0.0.1:38559/callback` once, and its
 * next `login` arrives on `http://127.0.0.1:45011/callback` and is rejected
 * `invalid_client`. That is exactly why RFC 8252 §7.3 REQUIRES an authorization
 * server to "allow any port to be specified at the time of the request for
 * loopback IP redirect URIs".
 *
 * So: port flexibility is granted ONLY to `http` loopback URIs, and ONLY the
 * port may vary. Scheme, host, path, query, fragment and any embedded
 * credentials must still match the registration byte for byte — otherwise this
 * would be an open redirect on the loopback interface (a local attacker process
 * could not be sent to a different path than the one the client registered).
 *
 * Note also what is deliberately NOT normalized: `127.0.0.1`, `[::1]` and
 * `localhost` stay three distinct registrations. RFC 8252 §8.3 warns that
 * `localhost` resolves through the host's name resolution and may not reach the
 * loopback interface at all, so a client that registered the IP literal must
 * not become redirectable to a name.
 *
 * The token endpoint (`src/app/api/oauth/token/route.ts`) stays on a strict
 * `!==` comparison and must NOT use this helper: there it compares the
 * redirect_uri presented at exchange against the concrete one recorded on the
 * authorization code, which is a different question (RFC 6749 §4.1.3) and is
 * meant to be exact.
 */

/**
 * Hosts that name the loopback interface, as the WHATWG URL parser spells them
 * (`new URL("http://[::1]/").hostname === "[::1]"` — brackets retained).
 * Compared with `===`, never a prefix test, so `127.0.0.1.evil.com` is not a
 * loopback host.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** True when `url` is the `http` loopback form RFC 8252 §7.3 covers. */
function isHttpLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/** Everything about a redirect URI except its port — all of which must match. */
function invariants(url: URL): string {
  return JSON.stringify([
    url.protocol,
    url.hostname,
    url.username,
    url.password,
    url.pathname,
    url.search,
    url.hash,
  ]);
}

/**
 * Does `candidate` match one of the client's `registered` redirect URIs?
 *
 * Exact match always wins. Beyond that, a registered `http` loopback URI also
 * matches a candidate that differs ONLY in port (RFC 8252 §7.3).
 *
 * TOTAL — never throws. An unparseable candidate is simply unmatched, and an
 * unparseable registration row is skipped rather than poisoning the whole list.
 */
export function isRegisteredRedirectUri(
  registered: readonly string[],
  candidate: string,
): boolean {
  if (registered.includes(candidate)) return true;

  const target = parse(candidate);
  if (!target || !isHttpLoopback(target)) return false;

  const targetInvariants = invariants(target);
  return registered.some((entry) => {
    const source = parse(entry);
    if (!source || !isHttpLoopback(source)) return false;
    return invariants(source) === targetInvariants;
  });
}
