import { nunito } from "@/lib/fonts";
import styles from "./editorial-landing.module.css";

/**
 * The official uppercase MONOLITH wordmark at landing scale — the same
 * geometry as the app's nav `Brand` (Nunito 800, tracking .025em, the slab
 * glyph recut as the letter I at 0.72em), just sized by the landing's own
 * CSS. Renders as a plain span; wrap it in the link the context needs.
 */
export function LandingWordmark({ className }: { className?: string }) {
  return (
    <span className={`${styles.brand} ${nunito.className} ${className ?? ""}`}>
      <span className={styles.wordmark} aria-hidden="true">
        MONOL
        <svg
          className={styles.mark}
          viewBox="8.6 3.2 6.8 17.6"
          aria-hidden="true"
        >
          <path d="M8.6 5 15.4 3.2V20.8H8.6Z" fill="currentColor" />
        </svg>
        TH
      </span>
      <span className="sr-only">MONOLITH</span>
    </span>
  );
}
