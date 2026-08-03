import { Fragment } from "react";
import { Check, Minus } from "lucide-react";
import { CREDITS_PER_SEAT } from "@/lib/billing/tiers";

type Cell = boolean | string;
type Row = { label: string; core: Cell; pulse: Cell; enterprise: Cell };

const GROUPS: { group: string; rows: Row[] }[] = [
  {
    group: "Work OS",
    rows: [
      {
        label: "Boards, items, workspaces",
        core: "Unlimited",
        pulse: "Unlimited",
        enterprise: "Unlimited",
      },
      {
        label: "Table, kanban, calendar, timeline",
        core: true,
        pulse: true,
        enterprise: true,
      },
      { label: "Automations", core: true, pulse: true, enterprise: true },
      {
        label: "Dashboards and reports",
        core: true,
        pulse: true,
        enterprise: true,
      },
      {
        label: "Portfolios, goals, workload",
        core: true,
        pulse: true,
        enterprise: true,
      },
      { label: "Time tracking", core: true, pulse: true, enterprise: true },
      {
        label: "Import, export, board sharing",
        core: true,
        pulse: true,
        enterprise: true,
      },
    ],
  },
  {
    group: "AI",
    rows: [
      { label: "Ask Pulse", core: false, pulse: true, enterprise: true },
      {
        label: "Personal agents and daily briefings",
        core: false,
        pulse: true,
        enterprise: true,
      },
      {
        label: "Board and dashboard generation",
        core: false,
        pulse: true,
        enterprise: true,
      },
      { label: "Semantic search", core: false, pulse: true, enterprise: true },
      {
        label: "Monthly AI credits",
        core: "None",
        pulse: `${CREDITS_PER_SEAT} per seat, pooled`,
        enterprise: "Custom",
      },
    ],
  },
  {
    group: "Account",
    rows: [
      {
        label: "Seat minimum",
        core: "None",
        pulse: "None",
        enterprise: "None",
      },
      { label: "SSO", core: false, pulse: false, enterprise: true },
      {
        label: "Bring your own model keys",
        core: false,
        pulse: false,
        enterprise: "By arrangement",
      },
    ],
  },
];

/**
 * Marks pair the glyph with an accessible name — a check renders with sr-only
 * "Included" and a dash with "Not included" — so the table reads correctly to a
 * screen reader and to anyone who cannot distinguish the two shapes. Never
 * colour or glyph alone.
 */
function Mark({ value }: { value: Cell }) {
  if (typeof value === "string")
    return <span className="text-sm">{value}</span>;
  return value ? (
    <>
      <Check className="text-primary mx-auto size-4" aria-hidden="true" />
      <span className="sr-only">Included</span>
    </>
  ) : (
    <>
      <Minus
        className="text-muted-foreground mx-auto size-4"
        aria-hidden="true"
      />
      <span className="sr-only">Not included</span>
    </>
  );
}

/**
 * Feature comparison. A Server Component — the rows do not vary by cadence, so
 * it stays entirely out of the client subtree.
 *
 * The table scrolls inside its own container rather than widening the page:
 * three columns plus labels is wider than a phone, and the page body must never
 * scroll horizontally.
 */
export function PricingComparison() {
  return (
    <section className="mt-24">
      <h2 className="mb-8 text-center text-2xl font-extrabold tracking-tight">
        Compare plans
      </h2>
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <caption className="sr-only">
            Feature comparison across the Core, Pulse, and Enterprise plans
          </caption>
          <thead>
            <tr className="border-border border-b">
              <th scope="col" className="px-4 py-3 text-left font-semibold">
                Feature
              </th>
              <th scope="col" className="px-4 py-3 text-center font-semibold">
                Core
              </th>
              <th scope="col" className="px-4 py-3 text-center font-semibold">
                Pulse
              </th>
              <th scope="col" className="px-4 py-3 text-center font-semibold">
                Enterprise
              </th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <Fragment key={g.group}>
                <tr className="bg-surface-muted">
                  <th
                    scope="colgroup"
                    colSpan={4}
                    className="text-kicker text-3xs px-4 py-2 text-left font-mono tracking-[0.12em] uppercase"
                  >
                    {g.group}
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.label} className="border-border/60 border-t">
                    <th
                      scope="row"
                      className="px-4 py-2.5 text-left font-normal"
                    >
                      {r.label}
                    </th>
                    <td className="px-4 py-2.5 text-center">
                      <Mark value={r.core} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Mark value={r.pulse} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Mark value={r.enterprise} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
