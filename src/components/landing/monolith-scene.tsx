"use client";

import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import type { MotionProps } from "framer-motion";
import { nunito } from "@/lib/fonts";
import { Kicker } from "@/components/ui/kicker";
import styles from "./monolith-hero.module.css";

// The WebGL backdrop pulls in the `ogl` renderer chunk. It's a decorative,
// aria-hidden layer, so we defer it off the landing critical path via
// `next/dynamic({ ssr: false })`: the hero text/CTA paint immediately and the
// WebGL chunk streams in afterward (no `loading` fallback needed).
const LightRays = dynamic(
  () => import("./light-rays").then((m) => m.LightRays),
  { ssr: false },
);

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
      <LightRays className={styles.rays} raysColor="#8ea2eb" />
      <span className={styles.source} aria-hidden />
      <span className={styles.vignette} aria-hidden />
      <motion.span className={styles.badge} variants={item}>
        <span className={styles.badgeDot} aria-hidden />
        <Kicker>In active development</Kicker>
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
