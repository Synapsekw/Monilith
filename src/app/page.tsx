import { MonolithHero } from "@/components/landing/monolith-hero";

/**
 * Public landing. A pure static Server Component — it reads no cookies and does
 * no auth, so Next prerenders it (`○ Static`) and Vercel serves it from the edge
 * for instant first byte. Authenticated visitors never render this: `proxy.ts`
 * redirects a logged-in hit on `/` to the dynamic `/home` dispatcher, which
 * routes them on to their board.
 */
export default function Home() {
  return <MonolithHero />;
}
