import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand/brand";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { getUserOrgs, requireUser } from "@/lib/auth/session";
import { finishAccountSetup } from "@/lib/auth/finish-setup";
import { createClient } from "@/lib/supabase/server";

/** Exported for the page test (the default export is a sync Suspense wrapper). */
export async function OnboardingGate() {
  const user = await requireUser();

  const orgs = await getUserOrgs();
  if (orgs.length > 0) redirect("/");

  // An account approved after signing up never ran the callback's setup, so a
  // pending invitation may be waiting, or the org named at signup may not exist
  // yet: run the shared setup (redeem, otherwise provision) rather than asking
  // the user to create an org. With no `org_name` in the metadata nothing is
  // created. A failure falls through to the form.
  let created = false;
  try {
    const client = await createClient();
    const setup = await finishAccountSetup(user, client);
    if (setup.ok) {
      // getUserOrgs() is request-cached and still holds the empty list; ask
      // the database directly (RLS-scoped) whether an org exists now.
      const { data } = await client.from("organizations").select("id").limit(1);
      created = (data ?? []).length > 0;
    }
  } catch {
    created = false;
  }
  // redirect() throws — keep it outside the try/catch.
  if (created) redirect("/");

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
