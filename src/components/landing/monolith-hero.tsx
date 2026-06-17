import Link from "next/link";
import styles from "./monolith-hero.module.css";
import { archivo } from "@/lib/fonts";

/**
 * Public landing hero. Pure Server Component: CSS-only animation + hover
 * affordance, the whole surface is a single navigation. No client JS.
 *
 * `href` is where clicking the hero goes — defaults to `/login` (the public `/`
 * landing for logged-out visitors). The `/landing` route passes the in-app
 * destination for already-signed-in viewers.
 */
export function MonolithHero({ href = "/login" }: { href?: string }) {
  return (
    <Link href={href} className={styles.hero}>
      <span className={styles.vignette} aria-hidden />
      <span className={styles.glow} aria-hidden />
      <span className={styles.slab} aria-hidden />
      <span className={`${styles.wordmark} ${archivo.className}`}>
        MONOLITH
      </span>
      <span className={styles.enter} aria-hidden>
        Click to enter
      </span>
    </Link>
  );
}
