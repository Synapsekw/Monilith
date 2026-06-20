import { redirect } from "next/navigation";
import { Brand } from "@/components/brand/brand";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { getUserOrgs, requireUser } from "@/lib/auth/session";

export default async function OnboardingPage() {
  await requireUser();

  const orgs = await getUserOrgs();
  if (orgs.length > 0) redirect("/");

  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <Brand />
      <div className="w-full max-w-sm">
        <OnboardingForm />
      </div>
    </main>
  );
}
