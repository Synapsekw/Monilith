import { Suspense } from "react";
import { AssemblyLanding } from "@/components/landing/assembly-landing";
import { getUser } from "@/lib/auth/session";

/**
 * Public splash route. Unlike `/` (which redirects authenticated users into the
 * app), `/landing` always renders the MONOLITH hero — it's where the nav logo
 * points. Clicking the hero sends a signed-in viewer back into the app (`/`,
 * which routes on to their board) via the "Enter app" CTA; logged-out visitors
 * get the Log in / Sign up entry points.
 */
export async function LandingInner() {
  const user = await getUser();
  return <AssemblyLanding signedIn={!!user} />;
}

export default function LandingPage() {
  // Hero is identical for everyone; the signed-in/out CTA difference streams in
  // behind a Suspense boundary (Cache Components), with the signed-out hero as
  // the prerendered fallback.
  return (
    <Suspense fallback={<AssemblyLanding signedIn={false} />}>
      <LandingInner />
    </Suspense>
  );
}
