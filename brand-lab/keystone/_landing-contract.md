# Keystone landing variations — shared contract (read fully)

You are building ONE full landing-page variation for MONOLITH. All four variations share the finalized
Keystone brand and differ only in structure / mood / theme. Build a single self-contained `.html` file
(inline `<style>`, fonts via the link below, vanilla JS only if needed). Served statically from the
`brand-lab/` root, so use ABSOLUTE asset paths.

## The product (write real copy)

MONOLITH is an invite-only, all-in-one **Work OS**: boards (table / kanban / calendar / timeline),
dashboards, portfolios, goals, time, workload, automations. One system replacing a stack of tools.
Audience: ops/delivery leads, founders. Primary CTA everywhere: **Request access**. Secondary: **Sign in**.

## Finalized brand assets (use EXACTLY)

Fonts link (include in <head>, with preconnects):
`<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`

**Wordmark** — Nunito ExtraBold with the letter I recut as the monolith slab. Use this markup wherever
the MONOLITH wordmark appears (hero, nav, footer):

```html
<span class="wm"
  >MONOL<svg class="slabI" viewBox="8.6 3.2 6.8 17.6" aria-hidden="true">
    <path d="M8.6 5 15.4 3.2V20.8H8.6Z" fill="currentColor" /></svg
  >TH</span
>
```

```css
.wm {
  font-family: "Nunito", sans-serif;
  font-weight: 800;
  letter-spacing: 0.03em;
  line-height: 1;
  white-space: nowrap;
  display: inline-flex;
  align-items: baseline;
}
.slabI {
  height: 0.72em;
  width: auto;
  margin: 0 0.05em;
  transform: translateY(0.008em);
}
.slabI path {
  fill: currentColor;
}
```

**Cleave mark** — the standalone symbol (use for a nav/footer mark or an accent). currentColor:

```html
<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
  <path d="M36 26 L64 18 L64 27 L36 35 Z" fill="currentColor" />
  <path d="M36 43 L64 35 L64 84 L36 84 Z" fill="currentColor" />
</svg>
```

**Type system:** everything is **Nunito** (400/600/700 body, 800 display). Small meta labels may use
**JetBrains Mono**. No other fonts.

Palettes (your brief picks one, lock it):

- Dark: page `#0e0e10`, elevated `#161619`, paper `#f4f4f6`, muted `#9a9aa2`, stone `#6b6b72`, hairline `rgba(255,255,255,.09)`.
- Light-cool: page `#f4f5f7`, surface `#ffffff`, ink `#16161a`, muted `#6c6c74`, hairline `#e3e3e7`.
- Light-warm: page `#f7f4ee`, surface `#fffdf9`, ink `#1a1916`, muted `#6c675e`, hairline `#e7e1d6`.

The brand is **monochrome** (no accent color) — emphasis comes from scale, weight, and the paper/ink
contrast. One corner-radius scale per page; one theme per page (no mid-page light/dark flip).

## The lab bar (paste verbatim at top of <body>; set class="on" on THIS page in the right group)

```html
<nav class="labbar">
  <b>MONOLITH</b><span>keystone</span>
  <a href="/index.html">Overview</a>
  <a href="/keystone/landings.html">Landings</a>
  <span class="sp"></span>
  <a href="/keystone/landings/statement.html">Statement</a>
  <a href="/keystone/landings/product.html">Product</a>
  <a href="/keystone/landings/editorial.html">Editorial</a>
  <a href="/keystone/landings/kinetic.html">Kinetic</a>
</nav>
```

```css
.labbar {
  position: sticky;
  top: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 44px;
  padding: 0 18px;
  background: rgba(10, 10, 12, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: #9a9aa2;
}
.labbar b {
  color: #f5f5f6;
  font-weight: 500;
}
.labbar a {
  color: #9a9aa2;
  text-decoration: none;
}
.labbar a:hover,
.labbar a.on {
  color: #f5f5f6;
}
.labbar .sp {
  flex: 1;
}
```

The lab bar is always dark chrome, even on light pages. Content flows below it (sticky).

## Hard rules (a violation = broken work)

1. The name is **MONOLITH** always; the wordmark is the eight letters via the slab-I markup above. Never rename.
2. **ZERO em-dashes (—) or en-dashes (–)** anywhere visible. Use hyphens, commas, colons, or two sentences. Scan before finishing.
3. No AI tells: no accent/gradient glow, no three-equal-feature-cards, no eyebrow above every section (max 1 per 3 sections), no "Scroll" cues, no version/BETA labels in the hero, no locale/time/weather strips, no decorative status dots, no `border-top`+`border-bottom` on every list row, no div-based fake screenshots.
4. No filler verbs (elevate, seamless, unleash, next-gen). Realistic testimonial names (name + role + company, never "John Doe"/"Acme").
5. **Hero fits the viewport:** headline <= 2 lines, subtext <= 20 words, primary CTA visible without scroll. `min-height: 100dvh`, never `100vh`.
6. Real product visuals: build ONE genuine small styled component (a real mini board/dashboard from clean markup) OR use `https://picsum.photos/seed/{descriptive}/{w}/{h}` for mood imagery. No empty-gray fake screenshots.
7. Buttons: one primary + at most one secondary per section, label <= 3 words, one line, readable contrast.
8. Motion (only where your brief calls for it): CSS transitions + IntersectionObserver reveals; wrap anything beyond hover in `@media (prefers-reduced-motion: no-preference)`.

Deliver the full page. Then re-scan every visible string for em/en-dashes (zero) and confirm the wordmark
reads MONOLITH. Report a one-paragraph summary and any risks.
