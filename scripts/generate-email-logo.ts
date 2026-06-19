import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const OUT = resolve(process.cwd(), "public/email/monolith-logo@2x.png");

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Nunito:wght@800&display=swap"
      rel="stylesheet"
    />
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
      #lockup {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px;
        color: #18181b;
      }
      #lockup svg {
        width: 28px;
        height: 28px;
        display: block;
      }
      #lockup span {
        font-family: "Nunito", sans-serif;
        font-weight: 800;
        font-size: 26px;
        letter-spacing: 0.06em;
        line-height: 1;
      }
    </style>
  </head>
  <body>
    <div id="lockup">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8.6 5 15.4 3.2V20.8H8.6Z" fill="currentColor" />
      </svg>
      <span>MONOLITH</span>
    </div>
  </body>
</html>`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$("#lockup");
  if (!el) throw new Error("lockup element not found");
  await mkdir(dirname(OUT), { recursive: true });
  await el.screenshot({ path: OUT, omitBackground: true });
  await browser.close();

  console.log("wrote", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
