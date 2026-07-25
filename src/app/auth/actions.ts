"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getServerEnv } from "@/lib/env.server";
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
 * Resolve the canonical origin used to build `emailRedirectTo` for confirmation
 * / recovery links.
 *
 * Security: the `Origin`/`Host` request headers are client-controllable, so a
 * poisoned host could make a confirmation link point at an attacker origin. We
 * therefore PREFER the operator-set `APP_BASE_URL` env, which is not
 * attacker-controllable. We fall back to the request headers ONLY when
 * `APP_BASE_URL` is unset — this keeps local dev and Vercel preview deployments
 * working, where the per-deployment URL isn't known ahead of time (and those
 * origins are trusted). In production, set `APP_BASE_URL` to the canonical app
 * URL so the header path is never taken.
 */
async function getOrigin(): Promise<string> {
  const configured = getServerEnv().APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const headerStore = await headers();
  const origin = headerStore.get("origin");
  if (origin) return origin;

  const host = headerStore.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
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
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  // redirect() throws — must be called outside the try/catch above.
  redirect("/");
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

  const origin = await getOrigin();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
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
    redirect("/");
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

  const origin = await getOrigin();
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

  // redirect() throws — outside any try/catch.
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Revoke every session for this user on every device, not just this browser.
 * `scope: "global"` invalidates all refresh tokens server-side — the escape
 * hatch for "I signed in on a machine I no longer control". Plain signOut()
 * above only clears the local session, which would leave that machine logged
 * in until its refresh token expired.
 */
export async function signOutEverywhere(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}
