"use server";
import {
  platformDeactivateUser,
  platformReactivateUser,
  platformResetUserPassword,
  platformSetUserPassword,
  platformDeleteUser,
} from "./actions";

import type { ActionResult } from "@/lib/actions/result";

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

export async function resetUserPasswordAction(
  userId: string,
): Promise<ActionResult> {
  return platformResetUserPassword({ userId });
}

export async function setUserPasswordAction(
  userId: string,
  password: string,
): Promise<ActionResult> {
  return platformSetUserPassword({ userId, password });
}

export async function deleteUserAction(userId: string): Promise<ActionResult> {
  return platformDeleteUser({ userId });
}
