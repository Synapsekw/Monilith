import type { GradientSpec } from "@/components/dashboards/widgets/chart-colors";
import { SPECTRUM_STOPS } from "@/components/dashboards/widgets/chart-theme";

export const glowId = (widgetId: string) =>
  `glow-${widgetId.replace(/[^a-zA-Z0-9]+/g, "-")}`;

function SolidVertical({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.95} />
      <stop offset="100%" stopColor={color} stopOpacity={0.15} />
    </linearGradient>
  );
}

function SolidArea({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.5} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

function HeroVertical({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor={SPECTRUM_STOPS[1]} stopOpacity={0.95} />
      <stop offset="100%" stopColor={SPECTRUM_STOPS[0]} stopOpacity={0.2} />
    </linearGradient>
  );
}

function HeroArea({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor={SPECTRUM_STOPS[1]} stopOpacity={0.5} />
      <stop offset="100%" stopColor={SPECTRUM_STOPS[0]} stopOpacity={0} />
    </linearGradient>
  );
}

function HeroStroke({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stopColor={SPECTRUM_STOPS[0]} />
      <stop offset="50%" stopColor={SPECTRUM_STOPS[1]} />
      <stop offset="100%" stopColor={SPECTRUM_STOPS[2]} />
    </linearGradient>
  );
}

export function ChartDefs({
  widgetId,
  specs,
}: {
  widgetId: string;
  specs: GradientSpec[];
}) {
  return (
    <defs>
      {specs.map((s) => {
        if (s.kind === "bar")
          return <SolidVertical key={s.id} id={s.id} color={s.color} />;
        if (s.kind === "area")
          return <SolidArea key={s.id} id={s.id} color={s.color} />;
        if (s.kind === "hero-bar") return <HeroVertical key={s.id} id={s.id} />;
        if (s.kind === "hero-area") return <HeroArea key={s.id} id={s.id} />;
        return <HeroStroke key={s.id} id={s.id} />;
      })}
      <filter
        id={glowId(widgetId)}
        x="-50%"
        y="-50%"
        width="200%"
        height="200%"
      >
        <feGaussianBlur stdDeviation="2.5" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}
