"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Fades its children up on scroll via IntersectionObserver — fires once, then
 * unobserves. Honors `prefers-reduced-motion`: reduced-motion users get no
 * transform and no opacity gate (the content is simply shown). Used to wrap
 * each landing section for a staged cinematic reveal.
 */
export function LandingReveal({
  children,
  className,
  delayMs = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  /** Optional stagger for adjacent reveals (e.g. copy vs. visual in a row). */
  delayMs?: number;
  as?: "div" | "section";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Environments without IntersectionObserver (jsdom in tests, very old
    // browsers) reveal on the next tick rather than leaving content stuck
    // hidden. Deferred so it is not a synchronous setState inside the effect.
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setShown(true), 0);
      return () => clearTimeout(t);
    }

    // Reduced motion is handled purely in CSS (`motion-reduce:*` below), so the
    // content is always visible for those users without a synchronous setState.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      data-in={shown ? "" : undefined}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
      className={cn(
        "ease-keystone transition-[opacity,transform] duration-700 will-change-[opacity,transform]",
        // Motion path: hidden until revealed. motion-reduce always shows it.
        shown
          ? "in translate-y-0 opacity-100"
          : "translate-y-8 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
