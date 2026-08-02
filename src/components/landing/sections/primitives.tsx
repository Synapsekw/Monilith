import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import type { StatusColor } from "@/components/ui/status-pill";
import { statusToneClasses } from "@/components/ui/status-pill";
import { LandingReveal } from "../landing-reveal";

/**
 * Layout and text primitives shared by the landing sections. Split out of
 * `landing-sections.tsx` when that file hit the 800-line `max-lines` tripwire —
 * the visuals live in `./visuals`, the page composition stays in the root.
 */

export function Container({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 sm:px-8">{children}</div>
  );
}

export function SectionHead({
  kicker,
  title,
  sub,
  center = false,
  className,
}: {
  kicker: string;
  title: string;
  sub?: string;
  center?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-[640px]",
        center && "mx-auto text-center",
        className,
      )}
    >
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-4 mb-4 text-3xl leading-[1.06] font-extrabold tracking-tight sm:text-4xl md:text-5xl">
        {title}
      </h2>
      {sub ? (
        <p className="text-muted-foreground text-base leading-relaxed sm:text-lg">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

export function SoftBadge({
  children,
  color,
}: {
  children: ReactNode;
  color: StatusColor | "primary";
}) {
  return (
    <span
      className={cn(
        "text-3xs flex-none rounded-sm px-2 py-1 font-mono font-medium tracking-[0.1em] uppercase",
        statusToneClasses(color, "soft"),
      )}
    >
      {children}
    </span>
  );
}

export function SoftPill({
  children,
  color,
}: {
  children: ReactNode;
  color: StatusColor;
}) {
  return (
    <span
      className={cn(
        "text-2xs inline-flex items-center rounded-sm px-2.5 py-0.5 font-semibold",
        statusToneClasses(color, "soft"),
      )}
    >
      {children}
    </span>
  );
}

export type Point = { title: string; sub: string };

export function FeatureRow({
  flip = false,
  kicker,
  title,
  body,
  points,
  visual,
  aside,
}: {
  flip?: boolean;
  kicker: string;
  title: string;
  body: string;
  points: Point[];
  visual: ReactNode;
  /** Optional trailing slot under the bullet list (e.g. a rollout marker). */
  aside?: ReactNode;
}) {
  return (
    <div className="grid items-center gap-8 md:grid-cols-[1fr_1.15fr] md:gap-14">
      <LandingReveal className={cn(flip && "md:order-2")}>
        <Kicker>{kicker}</Kicker>
        <h3 className="mt-3.5 mb-3.5 text-2xl leading-tight font-extrabold sm:text-3xl">
          {title}
        </h3>
        <p className="text-muted-foreground mb-6 text-lg leading-relaxed">
          {body}
        </p>
        <ul className="flex flex-col gap-3">
          {points.map((p) => (
            <li key={p.title} className="flex items-start gap-3">
              <span
                className="bg-primary mt-2 size-1.5 flex-none rounded-full"
                aria-hidden="true"
              />
              <span className="text-base">
                <b className="font-bold">{p.title}</b>
                <span className="text-muted-foreground block text-sm">
                  {p.sub}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {aside ? <div className="mt-7">{aside}</div> : null}
      </LandingReveal>
      <LandingReveal delayMs={100} className={cn(flip && "md:order-1")}>
        {visual}
      </LandingReveal>
    </div>
  );
}

export function FlowNode({
  badge,
  children,
}: {
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-surface-muted border-border flex items-center gap-3.5 rounded-lg border px-4 py-3.5">
      {badge}
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function FlowConnector() {
  return <div className="bg-border ml-9 h-3.5 w-px" aria-hidden="true" />;
}

export function CmdStep({
  badge,
  children,
}: {
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-primary/[0.05] border-primary/[0.18] flex items-center gap-3 rounded-lg border px-3.5 py-3 text-sm">
      {badge}
      <span>{children}</span>
    </div>
  );
}

export function Kpi({
  label,
  value,
  delta,
  up = false,
}: {
  label: string;
  value: string;
  delta: string;
  up?: boolean;
}) {
  return (
    <div className="bg-surface-muted border-border rounded-lg border p-4">
      <div className="text-kicker text-3xs font-mono tracking-[0.1em] uppercase">
        {label}
      </div>
      <div className="mt-2 mb-1 text-3xl font-extrabold tracking-tight">
        {value}
      </div>
      <div
        className={cn(
          "text-xs font-bold",
          up ? "text-status-green" : "text-status-red",
        )}
      >
        {delta}
      </div>
    </div>
  );
}

/**
 * A single bento cell: a mono kicker, short title, one-line body, and a framed
 * product visual that clips to the tile. Span classes (col/row) come in via
 * `className` so the grid can vary each tile's footprint. Lifts on hover.
 */
export function BentoTile({
  kicker,
  title,
  body,
  className,
  delayMs = 0,
  children,
}: {
  kicker: string;
  title: string;
  body: string;
  className?: string;
  delayMs?: number;
  children: ReactNode;
}) {
  return (
    <LandingReveal delayMs={delayMs} className={cn("min-w-0", className)}>
      <div className="bg-surface border-border ease-keystone hover:border-border-hover flex h-full flex-col rounded-lg border p-5 transition-[transform,border-color] duration-300 hover:-translate-y-1">
        <Kicker>{kicker}</Kicker>
        <h3 className="mt-2.5 mb-1.5 text-lg leading-tight font-bold tracking-tight">
          {title}
        </h3>
        <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
        <div className="mt-5 min-h-0 flex-1 overflow-hidden rounded-lg">
          {children}
        </div>
      </div>
    </LandingReveal>
  );
}
