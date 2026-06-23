import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand/brand";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { getUserOrgs, requireUser } from "@/lib/auth/session";

async function OnboardingGate() {
  await requireUser();

  const orgs = await getUserOrgs();
  if (orgs.length > 0) redirect("/");

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
