import Link from "next/link";
import { MonolithScene } from "./monolith-scene";
import { LandingNav } from "./landing-nav";
import { LandingSections } from "./landing-sections";
import { AgentRoster, BoardWithAgentDock } from "./landing-agent-mocks";
import styles from "./monolith-hero.module.css";

/**
 * Public landing hero. Server Component: renders the interactive client
 * `MonolithScene` and passes it the roster and product shot as slots, so their
 * markup stays out of the client bundle.
 *
 * There is no CTA row under the subcopy. The nav carries the only entry points
 * — Get started / Sign in when logged out, Enter app when signed in — and it
 * now stays on screen, so repeating them in the hero was the same links a few
 * hundred pixels lower.
 */
export function MonolithHero({ signedIn = false }: { signedIn?: boolean }) {
  return (
    // Dark-locked: the hero is always dark regardless of the visitor's theme
    // (like /updates), so Keystone token-driven children (primary/border/kicker)
    // resolve to their dark values even on the static, theme-agnostic `/` route.
    <div className={`dark ${styles.page}`}>
      {/* One continuous wash behind the entire page — see the module CSS. */}
      <div className={styles.wash} aria-hidden="true" />
      <div className={styles.grain} aria-hidden="true" />

      <LandingNav signedIn={signedIn} />
      <MonolithScene roster={<AgentRoster />} proof={<BoardWithAgentDock />} />
      <LandingSections signedIn={signedIn} />

      <footer className={styles.footer}>
        <span>Free to start</span>
        <Link href="/updates" className={styles.footerLink}>
          Updates →
        </Link>
      </footer>
    </div>
  );
}
