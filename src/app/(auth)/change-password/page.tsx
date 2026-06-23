import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/components/auth/change-password-form";

export const metadata = { title: "Change your password" };

// Lives in the (auth) group so the app auth gates (requireUser /
// requirePlatformAdmin) don't run here — avoids a redirect loop with
// enforcePasswordChange. Uses getUser() directly, not requireUser().
async function ChangePasswordGate() {
  const user = await getUser();
  if (!user) redirect("/login");
  return <ChangePasswordForm />;
}

export default function ChangePasswordPage() {
  // The cookie-bound user read streams behind a Suspense boundary so the route
  // satisfies Cache Components (no uncached data outside <Suspense>).
  return (
    <Suspense>
      <ChangePasswordGate />
    </Suspense>
  );
}
