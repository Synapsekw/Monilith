import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MagneticButton } from "./magnetic-button";
import { MonolithScene } from "./monolith-scene";
import styles from "./monolith-hero.module.css";

/**
 * Public landing hero. Server Component: derives the nav + CTA labels/targets
 * from auth state and renders the interactive client `MonolithScene`. The top
 * nav holds quick auth links; the hero holds primary magnetic CTAs.
 *
 * `signedIn` drives the copy: logged-out visitors get Log in / Sign up; a
 * signed-in viewer (the `/landing` splash) gets a single "Enter app" path back
 * into the product (`/`, which routes on to their board) via the "Enter app" CTA;
 * logged-out visitors get the Log in / Sign up entry points.
 */
export function MonolithHero({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <span className={styles.brand}>
          <span className={styles.brandMark} aria-hidden>
            P
          </span>
          Pulse
        </span>
        <nav className={styles.navActions}>
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/">Enter app</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Sign up</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <MonolithScene>
        {signedIn ? (
          <MagneticButton href="/">Enter app</MagneticButton>
        ) : (
          <>
            <MagneticButton href="/signup">Get started</MagneticButton>
            <MagneticButton href="/login" variant="outline">
              Sign in
            </MagneticButton>
          </>
        )}
      </MonolithScene>
    </div>
  );
}
