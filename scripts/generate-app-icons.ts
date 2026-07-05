import { resolve } from "node:path";
import { chromium } from "@playwright/test";

// Regenerates the PWA raster icons from the cleaved-monolith mark, matching the
// SVG favicon (src/app/icon.svg) and the apple touch icon (src/app/apple-icon.tsx).
// "any" icons are rounded tiles with transparent corners; the maskable icon is a
// full-bleed near-black square with the mark inside the safe zone.
const PUB = resolve(process.cwd(), "public");
const TILE = "#0D0D0F";
const MARK = "#F5F5F6";
const CLEAVE = `<path d="M36 26 L64 18 L64 27 L36 35 Z"/><path d="M36 43 L64 35 L64 84 L36 84 Z"/>`;

function iconSvg(size: number, maskable: boolean): string {
  const bg = maskable
    ? `<rect width="100" height="100" fill="${TILE}"/>`
    : `<rect width="100" height="100" rx="22" fill="${TILE}"/>`;
  const scale = maskable ? 0.62 : 0.82;
  return `<svg id="ic" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${bg}<g fill="${MARK}" transform="translate(50 51) scale(${scale}) translate(-50 -51)">${CLEAVE}</g></svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const t of targets) {
    const svg = iconSvg(t.size, t.maskable);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
      { waitUntil: "load" },
    );
    const el = await page.$("#ic");
    if (!el) throw new Error("icon element not found");
    await el.screenshot({ path: resolve(PUB, t.file), omitBackground: true });
    console.log("wrote", t.file);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
