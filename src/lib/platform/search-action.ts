"use server";
import { searchUsers, type PlatformUser } from "./queries";
import { platformDeactivateUser, platformReactivateUser } from "./actions";

type ActionResult = { ok: true; data: unknown } | { ok: false; error: string };

/**
 * Thin server-action wrapper so client components can call the (server-only)
 * `searchUsers` query. `searchUsers` already fails closed via isPlatformAdmin().
 */
export async function searchUsersAction(
  query: string,
): Promise<PlatformUser[]> {
  return searchUsers(query);
}

/**
 * Async server-action wrappers for ban/unban. The underlying actions in
 * actions.ts are const-assigned arrow functions, which the Turbopack
 * "use server" export check does not accept across a client import boundary;
 * re-exporting them as async function declarations here makes them callable
 * from the UserSearch client component. Both already fail closed.
 */
export async function deactivateUserAction(
  userId: string,
): Promise<ActionResult> {
  return platformDeactivateUser({ userId });
}

export async function reactivateUserAction(
  userId: string,
): Promise<ActionResult> {
  return platformReactivateUser({ userId });
}
