import { MonolithHero } from "@/components/landing/monolith-hero";
import { getUser } from "@/lib/auth/session";

/**
 * Public splash route. Unlike `/` (which redirects authenticated users into the
 * app), `/landing` always renders the MONOLITH hero — it's where the nav logo
 * points. Clicking the hero sends a signed-in viewer back into the app (`/`,
 * which routes on to their board) and a logged-out visitor to `/login`.
 */
export default async function LandingPage() {
  const user = await getUser();
  return <MonolithHero href={user ? "/" : "/login"} />;
}
