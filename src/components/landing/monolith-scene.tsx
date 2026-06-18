"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { MotionProps } from "framer-motion";
import { nunito } from "@/lib/fonts";
import { LightRays } from "./light-rays";
import styles from "./monolith-hero.module.css";

// framer-motion v12 does not export `Variants` directly; define it locally.
type Variants = MotionProps["variants"];

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
};

/**
 * Interactive landing centerpiece. Mouse-reactive WebGL light rays stream from
 * the top behind a soft source bloom; the wordmark, subcopy and CTA slot rise in
 * on load. `children` is the CTA row, rendered by the server `MonolithHero`. The
 * reveal is disabled under prefers-reduced-motion; the backdrop freezes to a
 * single static frame (handled inside `LightRays`).
 */
export function MonolithScene({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={styles.scene}
      variants={container}
      initial={reduce ? false : "hidden"}
      animate="show"
    >
      <LightRays className={styles.rays} />
      <span className={styles.source} aria-hidden />
      <span className={styles.vignette} aria-hidden />
      <motion.span className={styles.badge} variants={item}>
        <span className={styles.badgeDot} aria-hidden />
        In active development
      </motion.span>
      <motion.span
        className={`${styles.wordmark} ${nunito.className}`}
        variants={item}
      >
        MONOLITH
      </motion.span>
      <motion.p className={styles.subcopy} variants={item}>
        The only work surface you need.
      </motion.p>
      <motion.div className={styles.ctas} variants={item}>
        {children}
      </motion.div>
    </motion.div>
  );
}
