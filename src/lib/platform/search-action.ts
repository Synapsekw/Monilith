"use server";
import { platformDeactivateUser, platformReactivateUser } from "./actions";

type ActionResult = { ok: true; data: unknown } | { ok: false; error: string };

/**
 * Async server-action wrappers for ban/unban, callable from the client
 * `UserRowActions` component. Re-exported as async function declarations so the
 * Turbopack "use server" export check accepts them across the client boundary.
 * Both already fail closed via isPlatformAdmin().
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
