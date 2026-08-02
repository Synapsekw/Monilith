import Link from "next/link";
import { nunito } from "@/lib/fonts";
import styles from "./monolith-hero.module.css";

/**
 * Public landing nav. A Server Component — pure links, no state; it sticks with
 * CSS alone, so nothing here reaches the client bundle.
 *
 * The wordmark repeats here at brand-lockup scale (the hero's is the display
 * cut). Same face, same tracking — only the size differs.
 *
 * Section links are in-page anchors, never `<Link>`/router navigations: the
 * landing is one route, and a router nav would re-run its queries (working
 * agreement #5, gotcha-09).
 */
export function LandingNav({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className={styles.nav}>
      <div className={styles.navInner}>
        <Link
          href="/landing"
          className={`${styles.navBrand} ${nunito.className}`}
        >
          MONOLITH
        </Link>

        <nav className={styles.navLinks} aria-label="Landing sections">
          <a href="#agents">Agents</a>
          <a href="#features">Product</a>
          <a href="#views">Views</a>
          {/* In-page anchor, not a <Link>: the teaser lives on this route, and a
              router navigation would re-run every query in the page (gotcha-09).
              The full comparison at /pricing is a real route, linked from the
              teaser's CTA and the footer. */}
          <a href="#pricing">Pricing</a>
          <Link href="/updates">Updates</Link>
        </nav>

        <div className={styles.navActions}>
          {signedIn ? (
            <Link href="/" className={styles.navCta}>
              Enter app
            </Link>
          ) : (
            <>
              <Link href="/login" className={styles.navLink}>
                Sign in
              </Link>
              <Link href="/signup" className={styles.navCta}>
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
