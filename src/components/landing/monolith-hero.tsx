import Link from "next/link";
import { Archivo } from "next/font/google";
import styles from "./monolith-hero.module.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["800"],
  display: "swap",
});

/**
 * Public landing hero. Pure Server Component: CSS-only animation + hover
 * affordance, the whole surface is a single navigation to /login. No client JS.
 */
export function MonolithHero() {
  return (
    <Link href="/login" className={styles.hero}>
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
