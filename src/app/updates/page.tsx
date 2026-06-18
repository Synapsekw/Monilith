import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { nunito } from "@/lib/fonts";
import { ChangelogTimeline } from "@/components/changelog/changelog-timeline";
import { CHANGELOG } from "@/lib/changelog/entries";

export const metadata: Metadata = {
  title: "Updates · Monolith",
  description:
    "What's new in Monolith — the latest features and fixes. Monolith is in active development.",
};

// Public, unauthenticated, fully static. Wrapped in `dark` so Pulse tokens
// resolve to the always-dark hero aesthetic regardless of the visitor's theme.
export default function UpdatesPage() {
  return (
    <div className="dark bg-background text-foreground min-h-dvh">
      <div className="mx-auto max-w-2xl px-6 py-20">
        <Link
          href="/landing"
          className="text-muted-foreground hover:text-foreground mb-12 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        <header className="mb-12">
          <h1
            className={`${nunito.className} text-3xl font-bold tracking-tight`}
          >
            What&apos;s new
          </h1>
          <p className="text-muted-foreground mt-3 text-sm text-pretty">
            Monolith is in active development. Here&apos;s what we&apos;ve
            shipped, newest first.
          </p>
        </header>

        <ChangelogTimeline entries={CHANGELOG} />
      </div>
    </div>
  );
}
