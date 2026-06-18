"use client";

import { useRef } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import type { MotionProps } from "framer-motion";
import { archivo } from "@/lib/fonts";
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
 * Interactive landing centerpiece. Glow + slab drift toward the cursor (parallax
 * at two depths); wordmark, subcopy and the CTA slot rise in on load. `children`
 * is the CTA row, rendered by the server `MonolithHero`. All motion is disabled
 * under prefers-reduced-motion.
 */
export function MonolithScene({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const spring = { stiffness: 120, damping: 20, mass: 0.6 };
  // Two depths: slab moves more than the glow behind it.
  const glowX = useSpring(px, spring);
  const glowY = useSpring(py, spring);
  const slabX = useSpring(useMotionValue(0), spring);
  const slabY = useSpring(useMotionValue(0), spring);

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const nx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const ny = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    px.set(nx * 14);
    py.set(ny * 10);
    slabX.set(nx * 26);
    slabY.set(ny * 16);
  }

  function reset() {
    px.set(0);
    py.set(0);
    slabX.set(0);
    slabY.set(0);
  }

  return (
    <motion.div
      ref={ref}
      className={styles.scene}
      onPointerMove={handleMove}
      onPointerLeave={reset}
      variants={container}
      initial={reduce ? false : "hidden"}
      animate="show"
    >
      <span className={styles.vignette} aria-hidden />
      <motion.span
        className={styles.glow}
        aria-hidden
        style={reduce ? undefined : { x: glowX, y: glowY }}
      />
      <motion.span
        className={styles.slab}
        aria-hidden
        style={reduce ? undefined : { x: slabX, y: slabY }}
      />
      <motion.span
        className={`${styles.wordmark} ${archivo.className}`}
        variants={item}
      >
        MONOLITH
      </motion.span>
      <motion.p className={styles.subcopy} variants={item}>
        One coherent surface for all your work.
      </motion.p>
      <motion.div className={styles.ctas} variants={item}>
        {children}
      </motion.div>
    </motion.div>
  );
}
