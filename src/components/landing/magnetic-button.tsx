"use client";

import Link from "next/link";
import { useRef } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import { Button } from "@/components/ui/button";

type MagneticButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: "default" | "outline";
  size?: "default" | "lg";
};

const STRENGTH = 8; // px the button drifts toward the cursor

/**
 * A real navigation link styled as a Button that gently pulls toward the cursor
 * with an indigo glow on hover. Pure progressive enhancement: under reduced
 * motion the magnetic transform is skipped and it behaves as a static link.
 */
export function MagneticButton({
  href,
  children,
  variant = "default",
  size = "lg",
}: MagneticButtonProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.4 });

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const relX = e.clientX - (rect.left + rect.width / 2);
    const relY = e.clientY - (rect.top + rect.height / 2);
    x.set((relX / (rect.width / 2)) * STRENGTH);
    y.set((relY / (rect.height / 2)) * STRENGTH);
  }

  function reset() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={reset}
      style={reduce ? undefined : { x: sx, y: sy }}
      className="inline-flex"
    >
      <Button
        asChild
        variant={variant}
        size={size}
        className="transition-shadow duration-200 hover:shadow-[0_0_30px_-6px_var(--brand)]"
      >
        <Link href={href}>{children}</Link>
      </Button>
    </motion.div>
  );
}
