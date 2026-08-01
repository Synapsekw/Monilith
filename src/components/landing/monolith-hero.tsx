import Link from "next/link";
import { MagneticButton } from "./magnetic-button";
import { MonolithScene } from "./monolith-scene";
import { LandingNav } from "./landing-nav";
import { LandingSections } from "./landing-sections";
import { AgentRoster, BoardWithAgentDock } from "./landing-agent-mocks";
import styles from "./monolith-hero.module.css";

// Primary CTA: the ONE earned loud moment in Keystone — periwinkle fill +
// near-black text + the sanctioned white glow (`shadow-glow-primary`). The
// landing is the system's natural home for the glow CTA (it has no in-app host).
// Secondary keeps the monochrome outline; its hairline BRIGHTENS (never
// thickens) on hover, per the Keystone hairline rule.
const PRIMARY_CTA =
  "h-11 rounded-full px-7 bg-primary text-primary-foreground shadow-glow-primary hover:brightness-110";
const SECONDARY_CTA =
  "h-11 rounded-full px-7 border-border hover:border-border-hover hover:bg-accent/40";

/**
 * Public landing hero. Server Component: derives the CTA labels/targets from
 * auth state and renders the interactive client `MonolithScene`. Logged-out
 * visitors get Get started (sign up) + Sign in (log in); a signed-in viewer (the
 * `/landing` splash) gets a single "Enter app" path back into the product (`/`,
 * which routes on to their board). The nav repeats those entry points.
 *
 * The agent roster is passed as a slot rather than imported inside the client
 * scene, so its markup stays a Server Component.
 */
export function MonolithHero({ signedIn = false }: { signedIn?: boolean }) {
  return (
    // Dark-locked: the hero is always dark regardless of the visitor's theme
    // (like /updates), so Keystone token-driven children (primary/border/kicker)
    // resolve to their dark values even on the static, theme-agnostic `/` route.
    <div className={`dark ${styles.page}`}>
      <LandingNav signedIn={signedIn} />
      <MonolithScene roster={<AgentRoster />} proof={<BoardWithAgentDock />}>
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
      <LandingSections signedIn={signedIn} />
      <footer className={styles.footer}>
        <span>Invitation only</span>
        <Link href="/updates" className={styles.footerLink}>
          Updates →
        </Link>
      </footer>
    </div>
  );
}
