import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUser, loginRedirectPath } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

export const metadata = { title: "Change your password" };

// Lives in the (auth) group so the app auth gates (requireUser /
// requirePlatformAdmin) don't run here — avoids a redirect loop with
// enforcePasswordChange. Uses getUser() directly, not requireUser().
async function ChangePasswordGate({
  searchParams,
}: {
  searchParams: Promise<{ recovery?: string }>;
}) {
  // Both dynamic reads resolve inside the Suspense boundary (Cache Components).
  const [{ recovery }, user] = await Promise.all([searchParams, getUser()]);
  if (!user) redirect(await loginRedirectPath());
  return (
    <ChangePasswordForm variant={recovery === "1" ? "recovery" : "forced"} />
  );
}

export default function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ recovery?: string }>;
}) {
  // The cookie-bound user read + searchParams stream behind a Suspense boundary
  // so the route satisfies Cache Components (no uncached data outside <Suspense>).
  return (
    <Suspense>
      <ChangePasswordGate searchParams={searchParams} />
    </Suspense>
  );
}
