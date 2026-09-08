import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";

/**
 * A titled group of SettingRows. The heading sits above a hairline; rows carry
 * their own separators. Sections stack with generous spacing so the page reads
 * as one column of groups rather than a grid of boxes — Keystone elevation is
 * surface steps and hairlines, never shadows or nested card chrome.
 *
 * Renders its title as `<h2>` — settings pages have no `<h1>` shell of their
 * own, so each section heading is the first heading level under the page.
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
      <PageHeader
        as="h2"
        className="border-border border-b pb-3"
        title={title}
        description={description}
      />
      {children}
    </section>
  );
}
