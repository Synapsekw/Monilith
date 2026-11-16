"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { safeNextPath } from "@/lib/auth/next-path";
import { getAppOrigin } from "@/lib/auth/origin";
import {
  PENDING_APPROVAL_PATH,
  readAccountApproval,
} from "@/lib/auth/approval";
import { LAST_BOARD_COOKIE } from "@/lib/boards/last-board";
import { fail, type ActionResult } from "@/lib/actions/result";
import { deleteTokensForUser } from "@/lib/mcp/oauth/token-store";
import {
  signInSchema,
  signUpSchema,
  changePasswordSchema,
  forgotPasswordSchema,
} from "@/lib/validations/auth";
import {
  checkRateLimit,
  throttleResult,
} from "@/lib/rate-limit/auth-rate-limit";

export type AuthState = {
  error?: string;
  success?: string;
};

/**
 * Read the post-sign-in destination off the submitted form.
 *
 * The field is FULLY CLIENT-CONTROLLED — the browser can forge it independently
 * of the `?next=` the page rendered — so this is the security-critical sanitize,
 * not the one in the page. `safeNextPath` is total: a hostile value degrades to
 * "/" rather than failing an otherwise valid sign-in.
 */
function nextFrom(formData: FormData): string {
  const raw = formData.get("next");
  return safeNextPath(typeof raw === "string" ? raw : null);
}

/**
 * Where a freshly signed-in account should land: the waiting screen when the
 * account is not approved (read live), otherwise `next`. Going straight there
 * avoids the gate's redirect inside the streaming app shell, which can leave an
 * empty content column on a soft navigation. A failed status read must NOT
 * block a sign-in: fall through to `next` and let the gate on that page decide.
 */
async function postAuthDestination(
  userId: string | undefined,
  next: string,
): Promise<string> {
  if (!userId) return next;
  try {
    return (await readAccountApproval(userId)) === "approved"
      ? next
      : PENDING_APPROVAL_PATH;
  } catch {
    return next;
  }
}

export async function signIn(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid credentials" };
  }

  const gate = await checkRateLimit({
    endpoint: "signIn",
    email: parsed.data.email,
  });
  if (!gate.allowed) return throttleResult("signIn", gate.retryAfterSeconds);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  // redirect() throws — must be called outside any try/catch.
  redirect(await postAuthDestination(data?.user?.id, nextFrom(formData)));
}

export async function signUp(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    orgName: formData.get("orgName"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const gate = await checkRateLimit({
    endpoint: "signUp",
    email: parsed.data.email,
  });
  if (!gate.allowed) return throttleResult("signUp", gate.retryAfterSeconds);

  const origin = await getAppOrigin();
  const next = nextFrom(formData);
  // Sanitize BEFORE embedding: an unvalidated value here would mint an off-site
  // redirect inside an email we send. Same shape as requestPasswordReset below.
  const emailRedirectTo =
    next === "/"
      ? `${origin}/auth/callback`
      : `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo,
      data: { org_name: parsed.data.orgName },
    },
  });

  if (error) {
    // Weak-password is genuinely actionable and reveals nothing about whether
    // the email already exists — surface it verbatim so the user can fix it.
    if (error.code === "weak_password" || /password/i.test(error.message)) {
      return { error: error.message };
    }
    // Every other error (notably "User already registered", but also
    // rate-limits) must NOT confirm account existence. Fall through to the same
    // "check your email" outcome a brand-new signup produces, so a duplicate
    // signup is indistinguishable from a fresh one to the client. This is the
    // standard anti-enumeration posture; Supabase still emails the existing
    // user when configured to.
    return { success: "check-email" };
  }

  // When email confirmation is disabled, Supabase returns an active session.
  if (data.session) {
    redirect(await postAuthDestination(data.user?.id, next));
  }

  return { success: "check-email" };
}

/**
 * Self-serve "forgot password": email a recovery link that lands the user on
 * the existing change-password screen (via the PKCE `/auth/callback` code
 * exchange, `?next=/change-password`).
 *
 * Anti-enumeration: after validation this ALWAYS reports success — a
 * nonexistent account, a rate-limit, or any other Supabase error is
 * indistinguishable from the account-exists outcome, mirroring `signUp`
 * above. Supabase only actually sends the email when the account exists.
 */
export async function requestPasswordReset(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid email" };
  }

  const gate = await checkRateLimit({
    endpoint: "requestPasswordReset",
    email: parsed.data.email,
  });
  if (!gate.allowed)
    return throttleResult("requestPasswordReset", gate.retryAfterSeconds);

  const origin = await getAppOrigin();
  const supabase = await createClient();
  // `recovery=1` makes /change-password show self-serve copy (not the
  // admin-forced wording). Encoded because it rides as the `next` param value.
  const next = encodeURIComponent("/change-password?recovery=1");
  // Result deliberately ignored — see anti-enumeration note above.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=${next}`,
  });

  return { success: "reset-email-sent" };
}

export async function changeOwnPassword(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = changePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid password" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const gate = await checkRateLimit({
    endpoint: "changeOwnPassword",
    userId: user.id,
  });
  if (!gate.allowed)
    return throttleResult("changeOwnPassword", gate.retryAfterSeconds);

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { error: error.message };

  // app_metadata is admin-only → clear the flag with the service-role client so
  // the user can't bypass the gate by editing their own metadata.
  const svc = createServiceClient();
  await svc.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, must_change_password: false },
  });

  // A connected MCP app holds its own long-lived credential and re-mints its
  // Supabase session when that dies, so a new password alone does not lock it
  // out — and "someone else may have my password" is exactly when it must.
  // After the flag is cleared, so a failure here leaves the user able to reach
  // Settings; and reported, never swallowed, because the password IS changed
  // and resubmitting this form would only be refused as the same password.
  if (!(await disconnectConnectedApps(user.id, "changeOwnPassword"))) {
    return {
      error:
        "Your password was changed, but your connected apps could not be disconnected. Open Settings, then Security, and use Sign out everywhere to cut them off.",
    };
  }

  // An account still waiting for a platform admin (every invited outsider who
  // has just set their first password) goes straight to the waiting screen
  // rather than through /home's gate; everyone else goes home as before.
  // redirect() throws — outside any try/catch.
  redirect(await postAuthDestination(user.id, "/"));
}

/**
 * Deletes every MCP connection of `userId` (which also frees their Vault
 * secrets). Returns false instead of throwing so each caller can word its own
 * failure; the cause is logged here and never shown to the user.
 */
async function disconnectConnectedApps(
  userId: string,
  caller: string,
): Promise<boolean> {
  try {
    await deleteTokensForUser(userId);
    return true;
  } catch (e) {
    console.error(`[${caller}] MCP disconnect failed:`, {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/**
 * The last-board cookie names a board the NEXT person to sign in on this
 * browser may not be able to read. The proxy sends an authenticated `/`
 * straight to it, so it must not outlive the session that stamped it.
 */
async function forgetLastBoard(): Promise<void> {
  (await cookies()).delete(LAST_BOARD_COOKIE);
}

/**
 * Ends this browser's session only. The scope is explicit because supabase-js
 * defaults `signOut()` to "global", which revokes every session the user has —
 * other devices, and the sessions that back their connected MCP apps.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  await forgetLastBoard();
  redirect("/login");
}

/**
 * Revoke every session for this user on every device, not just this browser.
 * `scope: "global"` invalidates all refresh tokens server-side — the escape
 * hatch for "I signed in on a machine I no longer control".
 *
 * Connected MCP apps are disconnected too: their tokens live on the machines
 * that connected them, and a connection can re-establish its own Supabase
 * session (`getRequestClient`), so revoking sessions alone would not cut them
 * off. Deleting the rows also frees their Vault secrets (before-delete trigger).
 *
 * FAILS CLOSED, in this order:
 *   1. Disconnect the apps. If that fails, stop: nothing has been signed out,
 *      the user is still on the page, and they are told to try again. Carrying
 *      on would end in a redirect to /login that reads as "everything is signed
 *      out" while the apps re-mint their sessions.
 *   2. Revoke the sessions. If that fails the apps are already cut off, and the
 *      user is told the other devices were not.
 * Only when both succeeded does it redirect. A returned result is therefore
 * always a failure; success never returns.
 */
export async function signOutEverywhere(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(await disconnectConnectedApps(user.id, "signOutEverywhere"))) {
    return fail(
      "Your connected apps could not be disconnected, so nothing was signed out. Please try again.",
    );
  }

  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) {
    console.error("[signOutEverywhere] global sign-out failed:", {
      error: error.message,
    });
    return fail(
      "Your connected apps were disconnected, but signing out your other devices failed. Please try again.",
    );
  }

  await forgetLastBoard();
  redirect("/login");
}
