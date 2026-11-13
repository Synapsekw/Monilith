import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand/brand";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { getUserOrgs, requireUser } from "@/lib/auth/session";
import { redeemInvitationsForUser } from "@/lib/auth/redeem";
import { createClient } from "@/lib/supabase/server";

/** Exported for the page test (the default export is a sync Suspense wrapper). */
export async function OnboardingGate() {
  await requireUser();

  const orgs = await getUserOrgs();
  if (orgs.length > 0) redirect("/");

  // An account approved after signing up never ran the callback's setup, so a
  // pending invitation may still be waiting: redeem it rather than asking the
  // user to create an org. A redeem error falls through to the form.
  let redeemed = 0;
  try {
    redeemed = await redeemInvitationsForUser(await createClient());
  } catch {
    redeemed = 0;
  }
  // redirect() throws — keep it outside the try/catch.
  if (redeemed > 0) redirect("/");

  return (
    <div className="w-full max-w-sm">
      <OnboardingForm />
    </div>
  );
}

export default function OnboardingPage() {
  // The cookie-bound auth check + org lookup stream behind a Suspense boundary so
  // the route satisfies Cache Components; the brand chrome is the static shell.
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <Brand />
      <Suspense>
        <OnboardingGate />
      </Suspense>
    </main>
  );
}
