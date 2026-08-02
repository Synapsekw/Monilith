import { CREDITS_PER_SEAT } from "@/lib/billing/tiers";

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is an AI credit?",
    a:
      "One credit is one cent of model spend. Pulse includes " +
      `${CREDITS_PER_SEAT} credits per seat per month, pooled across your whole ` +
      "organization — so a heavy user and a light user balance each other out " +
      "instead of each hitting their own wall.",
  },
  {
    q: "What happens if we run out of credits?",
    a:
      "AI features pause until the pool resets at the start of the next month. " +
      "Nothing else stops — boards, automations, dashboards and every other " +
      "part of Monolith keep working exactly as before. Running out of AI " +
      "credits never blocks someone from updating a task.",
  },
  {
    q: "Is there a seat minimum?",
    a:
      "No. You pay for exactly the seats in use, and adding or removing a seat " +
      "prorates automatically. There are no seat buckets and no minimum team " +
      "size.",
  },
  {
    q: "How does the free trial work?",
    a:
      "Every new organization gets 14 days of Pulse. We ask for a card up front " +
      "so the subscription converts without interrupting your team, and you can " +
      "switch to Core or cancel at any point during the trial.",
  },
  {
    q: "What happens to our data if we cancel?",
    a:
      "Your workspace becomes read-only for 30 days with export enabled, then " +
      "is suspended. We never delete your data because a subscription lapsed.",
  },
  {
    q: "Can we switch between monthly and annual?",
    a:
      "Yes, from Settings at any time. Annual works out to two months free — " +
      "that is the whole difference between the two rates; there is no separate " +
      "discount to claim.",
  },
];

/**
 * Pricing FAQ. A Server Component built on native `<details>`, so it needs no
 * JavaScript and never enters the client bundle. The summary is the disclosure
 * control, which gives keyboard and screen-reader behaviour for free.
 */
export function PricingFaq() {
  return (
    <section className="mx-auto mt-24 max-w-[720px]">
      <h2 className="mb-8 text-center text-2xl font-extrabold tracking-tight">
        Questions
      </h2>
      <div className="border-border divide-border/60 divide-y rounded-lg border">
        {FAQ.map((item) => (
          <details key={item.q} className="group px-5 py-4">
            <summary className="focus-visible:ring-ring flex cursor-pointer items-center justify-between gap-4 text-base font-semibold focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11">
              {item.q}
              <span
                className="text-muted-foreground ease-keystone flex-none transition-transform duration-300 group-open:rotate-45"
                aria-hidden="true"
              >
                +
              </span>
            </summary>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
