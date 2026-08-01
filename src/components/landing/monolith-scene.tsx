"use client";

import dynamic from "next/dynamic";
// PERF: framer-motion stays eager here — it drives the above-the-fold hero
// reveal (wordmark/headline/CTA start at opacity:0 and animate in), so a lazy
// boundary would leave the LCP text invisible until the chunk resolves. Kept
// off the shipped barrel via optimizePackageImports("framer-motion") instead.
import { motion, useReducedMotion } from "framer-motion";
import type { MotionProps } from "framer-motion";
import { nunito } from "@/lib/fonts";
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
    transition: { staggerChildren: 0.1, delayChildren: 0.1 },
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
 * the top behind a soft source bloom; the wordmark, headline, subcopy, CTA slot
 * and agent roster rise in on load.
 *
 * Two slots, both filled by the server `MonolithHero` so their markup stays out
 * of the client bundle: `children` is the CTA row, `roster` the named-agent
 * cards. The reveal is disabled under prefers-reduced-motion; the backdrop
 * freezes to a single static frame (handled inside `LightRays`).
 */
export function MonolithScene({
  children,
  roster,
  proof,
}: {
  children: React.ReactNode;
  roster?: React.ReactNode;
  /**
   * The product shot that crosses the fold. Without it the hero ends on the
   * roster and leaves a dead band above the first section — the same flat fold
   * that made the original wordmark-only hero read as a splash screen.
   */
  proof?: React.ReactNode;
}) {
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
      <motion.span
        className={`${styles.wordmark} ${nunito.className}`}
        variants={item}
      >
        MONOLITH
      </motion.span>
      <motion.h1 className={styles.headline} variants={item}>
        Every person gets a team.
        <br />
        Now everyone gets agents too.
      </motion.h1>
      <motion.p className={styles.subcopy} variants={item}>
        Give an agent a name, a job and a schedule. It works your boards,
        replies in your threads and emails you what&apos;s pending.
      </motion.p>
      <motion.div className={styles.ctas} variants={item}>
        {children}
      </motion.div>
      {roster ? (
        <motion.div className={styles.roster} variants={item}>
          {roster}
        </motion.div>
      ) : null}
      {proof ? (
        <motion.div className={styles.proof} variants={item}>
          {proof}
        </motion.div>
      ) : null}
    </motion.div>
  );
}
