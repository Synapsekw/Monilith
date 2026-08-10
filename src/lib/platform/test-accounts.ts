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
// This is presentation-only: it decides what the admin console COLLAPSES, never
// what is authorized or deleted. RLS remains the security boundary.

/** IANA-reserved second-level domains — never registerable, so never a customer. */
const RESERVED_TEST_DOMAINS = [
  "@example.com",
  "@example.net",
  "@example.org",
] as const;

/** Reserved suffix for internal-only infrastructure names. */
const INTERNAL_DOMAIN_SUFFIX = ".internal";

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
  if (normalized.endsWith(INTERNAL_DOMAIN_SUFFIX)) return true;
  return RESERVED_TEST_DOMAINS.some((domain) => normalized.endsWith(domain));
}

/**
 * Split a page of users into the people an administrator came to see and the
 * system/test accounts that would otherwise bury them. Order is preserved
 * within each bucket so the caller's sort still holds.
 */
export function partitionByAccountKind<T extends { email: string | null }>(
  users: readonly T[],
): { people: T[]; systemAndTest: T[] } {
  const people: T[] = [];
  const systemAndTest: T[] = [];
  for (const user of users) {
    if (isNonCustomerAccount(user.email)) systemAndTest.push(user);
    else people.push(user);
  }
  return { people, systemAndTest };
}
