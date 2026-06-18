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
import { cn } from "@/lib/utils";

type MagneticButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: "default" | "outline";
  size?: "default" | "lg";
  className?: string;
};

const STRENGTH = 8; // px the button drifts toward the cursor

/**
 * A real navigation link styled as a Button that gently pulls toward the cursor
 * on hover. Pure progressive enhancement: under reduced motion the magnetic
 * transform is skipped and it behaves as a static link. `className` is merged
 * last (tailwind-merge), so callers can override fill/radius/glow.
 */
export function MagneticButton({
  href,
  children,
  variant = "default",
  size = "lg",
  className,
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
        className={cn("transition-shadow duration-200", className)}
      >
        <Link href={href}>{children}</Link>
      </Button>
    </motion.div>
  );
}
