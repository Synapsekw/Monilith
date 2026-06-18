import { MagneticButton } from "./magnetic-button";
import { MonolithScene } from "./monolith-scene";
import styles from "./monolith-hero.module.css";

// Primary CTA: a white pill that stands clean against the always-dark hero
// (the bespoke surface is theme-independent, so it uses fixed light values
// rather than theme tokens — matching the wordmark's #f4f4f6). The secondary
// keeps the monochrome outline, pill-matched for a cohesive pair.
const PRIMARY_CTA =
  "h-11 rounded-full px-7 bg-[#f4f4f6] text-[#0a0a0c] hover:bg-white hover:shadow-[0_0_36px_-6px_rgba(255,255,255,0.55)]";
const SECONDARY_CTA =
  "h-11 rounded-full px-7 hover:shadow-[0_0_28px_-8px_rgba(232,232,234,0.4)]";

/**
 * Public landing hero. Server Component: derives the CTA labels/targets from
 * auth state and renders the interactive client `MonolithScene`. The hero CTAs
 * are the only entry points — logged-out visitors get Get started (sign up) +
 * Sign in (log in); a signed-in viewer (the `/landing` splash) gets a single
 * "Enter app" path back into the product (`/`, which routes on to their board).
 */
export function MonolithHero({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div className={styles.page}>
      <MonolithScene>
        {signedIn ? (
          <MagneticButton href="/" className={PRIMARY_CTA}>
            Enter app
          </MagneticButton>
        ) : (
          <>
            <MagneticButton href="/signup" className={PRIMARY_CTA}>
              Get started
            </MagneticButton>
            <MagneticButton
              href="/login"
              variant="outline"
              className={SECONDARY_CTA}
            >
              Sign in
            </MagneticButton>
          </>
        )}
      </MonolithScene>
    </div>
  );
}
