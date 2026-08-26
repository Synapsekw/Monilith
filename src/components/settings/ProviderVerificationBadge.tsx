import { CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import { StatusPill, type StatusColor } from "@/components/ui/status-pill";
import { timeAgo } from "@/lib/boards/automation-runs";
import type { ProviderVerification } from "@/lib/ai/providers/provider-rows";

/**
 * How the daily model-id sweep is doing for ONE provider.
 *
 * The sweep re-checks each provider's model ids once a day; a provider whose
 * probe is failing keeps its catalog rows unverified, and `catalog-db.ts`
 * filters unverified ids out of every picker. Until this badge the only
 * symptom of that was an empty model list with no stated cause — the failure
 * was in a server log nobody reads. This is the cause, on the page where the
 * key that would fix it lives.
 *
 * ## Why two timestamps become one sentence
 *
 * `lastVerifiedAt` (last SUCCESS) and `lastAttemptAt` (last RUN) are separate
 * columns precisely so this component can say "Check failed · last verified 7
 * days ago". One stamp cannot express that: the attempt alone says "checked
 * today" about a provider that has been 401ing all week, and the success alone
 * omits that anything is wrong.
 */
export type VerificationDescription = {
  tone: StatusColor;
  /** The state, in words. Never conveyed by colour alone. */
  label: string;
  /** Freshness, or null when there is nothing to be fresh about. */
  detail: string | null;
  /** The provider's own reason, when there is one. */
  reason: string | null;
};

/**
 * The pure half — every branch of the badge, testable without a DOM.
 *
 * `nowMs` is injected rather than read from the clock so the description is
 * deterministic. That matters twice over: tests can pin "7 days ago", and the
 * page passes ONE server-side instant down, so the server-rendered string and
 * the hydrated one cannot disagree across a rollover (the same hazard the
 * neighbouring `formatUpdated` pins its timezone against).
 */
export function describeVerification(
  v: ProviderVerification,
  nowMs: number,
): VerificationDescription {
  const verifiedAgo = v.lastVerifiedAt
    ? timeAgo(v.lastVerifiedAt, nowMs)
    : null;

  switch (v.status) {
    case "ok":
      return {
        tone: "green",
        label: "Verified",
        detail: verifiedAgo,
        reason: null,
      };
    case "failed":
      return {
        tone: "red",
        label: "Check failed",
        // The staleness, not the failure time — "we last knew this provider's
        // model ids were right N ago" is the number that decides whether this
        // is a blip or a week of rot.
        detail: verifiedAgo ? `last verified ${verifiedAgo}` : "never verified",
        reason: v.error,
      };
    case "skipped":
      // Gray, not orange or red: a skip is an expected, non-broken state — it
      // is where a provider nobody has a personal key for lands on every run,
      // including one held only as an org BYO key (see the borrowing contract
      // in src/lib/ai/credentials.ts).
      return {
        tone: "gray",
        label: "Not checked",
        detail: verifiedAgo ? `last verified ${verifiedAgo}` : null,
        reason: v.error,
      };
    default:
      return {
        tone: "gray",
        label: "Never checked",
        detail: null,
        reason: null,
      };
  }
}

const ICONS: Record<string, typeof CheckCircle2> = {
  Verified: CheckCircle2,
  "Check failed": TriangleAlert,
  "Not checked": CircleDashed,
  "Never checked": CircleDashed,
};

/**
 * Renders nothing when the provider has no record at all — a provider missing
 * from the health map must not sprout an empty pill.
 *
 * Accessibility: the state is carried by the WORD in the pill plus an icon,
 * never by the fill colour alone (`<StatusPill variant="soft">` is the
 * sanctioned tone, AA-checked in both themes). `role="status"` makes the whole
 * group one announcement, and the provider's own reason rides along in an
 * `sr-only` span so assistive tech gets the detail that would otherwise crowd
 * a dense settings row; sighted users get it as a `title`.
 */
export function ProviderVerificationBadge({
  verification,
  nowMs,
}: {
  verification: ProviderVerification | undefined;
  /**
   * Required, with no clock-reading default on purpose. A default of
   * `Date.now()` would be an impure call during render (react-hooks/purity),
   * and it would recompute per render — which is exactly how a server-rendered
   * "2 days ago" and a hydrated one end up disagreeing. The instant comes from
   * the server, once, and is carried down.
   */
  nowMs: number;
}) {
  if (!verification) return null;
  const { tone, label, detail, reason } = describeVerification(
    verification,
    nowMs,
  );
  const Icon = ICONS[label] ?? CircleDashed;

  return (
    <span
      role="status"
      title={reason ?? undefined}
      className="inline-flex shrink-0 items-center gap-1.5"
    >
      <StatusPill
        color={tone}
        variant="soft"
        className="inline-flex items-center gap-1"
      >
        <Icon className="size-3" aria-hidden="true" />
        {label}
      </StatusPill>
      {detail && (
        <span className="text-muted-foreground text-xs">{detail}</span>
      )}
      {reason && <span className="sr-only">{reason}</span>}
    </span>
  );
}

/**
 * The same freshness, for the org-managed half of Settings → AI.
 *
 * `AiKeyList` — and every badge on it — is swapped out for a "managed by your
 * organization" note whenever the org runs `managed` or `org_byo`. That is
 * exactly the mode in which a provider held ONLY as an org BYO key sits being
 * `skipped` by the daily sweep run after run (see the borrowing contract in
 * `src/lib/ai/credentials.ts`), so hiding the state there would blind the page
 * in the one case it was built to explain.
 *
 * A plain server component: no hooks, no state, so the RSC page renders it
 * directly rather than shipping another client bundle to say four words.
 */
export function ProviderVerificationList({
  providers,
  verification,
  nowMs,
}: {
  providers: { id: string; label: string }[];
  verification: Record<string, ProviderVerification>;
  nowMs: number;
}) {
  if (providers.length === 0) return null;
  return (
    <ul className="space-y-2">
      {providers.map((p) => (
        <li
          key={p.id}
          className="border-border hover:border-border-hover flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5 transition-colors"
        >
          <span className="text-foreground truncate text-sm font-medium">
            {p.label}
          </span>
          <ProviderVerificationBadge
            verification={verification[p.id]}
            nowMs={nowMs}
          />
        </li>
      ))}
    </ul>
  );
}
