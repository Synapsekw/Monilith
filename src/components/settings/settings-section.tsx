import type { ReactNode } from "react";

/**
 * A titled group of SettingRows. The heading sits above a hairline; rows carry
 * their own separators. Sections stack with generous spacing so the page reads
 * as one column of groups rather than a grid of boxes — Keystone elevation is
 * surface steps and hairlines, never shadows or nested card chrome.
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-10 last:mb-0">
      <div className="border-border border-b pb-3">
        <h2 className="text-foreground font-heading text-base font-semibold tracking-tight">
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
