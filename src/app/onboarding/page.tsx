import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { getUserOrgs, requireUser } from "@/lib/auth/session";

export default async function OnboardingPage() {
  await requireUser();

  const orgs = await getUserOrgs();
  if (orgs.length > 0) redirect("/");

  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-2">
        <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-sm font-semibold">
          P
        </div>
        <span className="text-sm font-semibold tracking-tight">Pulse</span>
      </div>
      <div className="w-full max-w-sm">
        <OnboardingForm />
      </div>
    </main>
  );
}
