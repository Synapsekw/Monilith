/**
 * Cache tag for one account's approval status.
 *
 * MUST match `approvalTag` in `src/lib/auth/approval.ts` (built in a parallel
 * task), which tags the cached status read with this exact string. This local
 * copy exists only because that file is not on this branch yet; replace it with
 * an import from `@/lib/auth/approval` when the branches are merged.
 */
export function approvalTag(userId: string): string {
  return `account-approval:${userId}`;
}
