// Which platform accounts are NOT real customers?
//
// `/admin/users` lists every user across every organization, so it is the one
// surface where the app's own system actor and leftover test accounts sit
// side-by-side with paying humans. Rather than hand-maintaining a list of ids
// (which silently rots the moment a new fixture is seeded), classification is
// by DOMAIN — the two families of address that can never belong to a customer:
//
//   * RFC 2606 / RFC 6761 reserved domains (`example.com/net/org`). IANA
//     guarantees these are un-registerable, so a signup can never legitimately
//     produce one. Every seeded fixture and E2E throwaway already uses them.
//   * `.internal` — the reserved suffix for non-public infrastructure names,
//     used by the platform's own agent actor (`pulse-autopilot@pulse.internal`,
//     seeded by migration 20260720120517).
//
// The classification is applied INSIDE the `platform_search_users` RPC (as
// ILIKE patterns), before LIMIT/OFFSET — so the admin can page through people
// alone and a burst of seeded fixtures can never bury them (2026-09-12: 37
// browser-verification accounts filled page 0 and hid every real user).
// `isNonCustomerAccount` is the same rule in TypeScript, kept in lock-step by
// test-accounts.test.ts.
//
// This is presentation-only: it decides what the admin console COLLAPSES, never
// what is authorized or deleted. RLS remains the security boundary.

/**
 * SQL ILIKE patterns for every non-customer address family. Each is a pure
 * suffix match (`%` only at the front) so it reads identically in Postgres and
 * in `isNonCustomerAccount`.
 */
export const NON_CUSTOMER_EMAIL_PATTERNS = [
  // IANA-reserved second-level domains — never registerable, so never a customer.
  "%@example.com",
  "%@example.net",
  "%@example.org",
  // Reserved suffix for internal-only infrastructure names.
  "%.internal",
] as const satisfies readonly `%${string}`[];

/**
 * True when the address belongs to a system actor or a reserved-domain test
 * account rather than a real person. A missing address is treated as a real
 * user: unknown is never grounds for hiding a row from an administrator.
 */
export function isNonCustomerAccount(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return NON_CUSTOMER_EMAIL_PATTERNS.some((pattern) =>
    normalized.endsWith(pattern.slice(1)),
  );
}
