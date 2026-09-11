"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { LandingWordmark } from "./landing-wordmark";
import styles from "./editorial-landing.module.css";

export const NAV_LINKS = [
  ["Product", "#product"],
  ["For agents", "#agents"],
  ["Why Monolith", "#why"],
  ["Pricing", "#pricing"],
] as const;

/**
 * Sticky landing header. The only client component in the header — the
 * mobile menu toggle is the one piece of state. Section links are in-page
 * anchors, never `<Link>`/router navigations: the landing is one route and a
 * router nav would re-run every query in the page (working agreement #5).
 *
 * Logged out: Sign in + the trial CTA. Signed in (the /landing splash for an
 * authenticated viewer): a single "Enter app" path back into the workspace.
 */
export function LandingNav({ signedIn = false }: { signedIn?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <header className={styles.header}>
      <div className={styles.navWrap}>
        <a href="#top" aria-label="Monolith home">
          <LandingWordmark />
        </a>
        <nav
          className={
            open ? `${styles.mainNav} ${styles.mainNavOpen}` : styles.mainNav
          }
          aria-label="Main navigation"
        >
          {NAV_LINKS.map(([label, href]) => (
            <a href={href} key={href} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
        </nav>
        <div className={styles.navActions}>
          {signedIn ? (
            <Link href="/" className={styles.cta}>
              Enter app
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
          ) : (
            <>
              <Link href="/login" className={styles.signIn}>
                Sign in
              </Link>
              <Link href="/signup" className={styles.cta}>
                Start your trial
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
            </>
          )}
          <button
            type="button"
            className={styles.mobileMenu}
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>
    </header>
  );
}
