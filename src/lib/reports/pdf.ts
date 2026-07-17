import "server-only";
import chromium from "@sparticuz/chromium";
import { chromium as playwright, type LaunchOptions } from "playwright-core";
import { isServerlessRuntime } from "@/lib/env.server";

export type PdfOptions = { landscape: boolean };

/**
 * Render a self-contained HTML document to PDF bytes via headless Chromium.
 * Uses setContent (not navigation) so no auth/cookies need to reach the browser.
 * Serverless (Vercel/Lambda): uses the @sparticuz/chromium bundled binary.
 * Local/dev/CI: falls back to the installed Google Chrome (channel: "chrome").
 */
export async function renderHtmlToPdf(
  html: string,
  opts: PdfOptions,
): Promise<Buffer> {
  let launchOpts: LaunchOptions;
  if (isServerlessRuntime()) {
    launchOpts = {
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    };
  } else {
    launchOpts = { channel: "chrome", headless: true };
  }
  const browser = await playwright.launch(launchOpts);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      landscape: opts.landscape,
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
