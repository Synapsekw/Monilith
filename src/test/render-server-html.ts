import type { ReactNode } from "react";

/**
 * Render a tree the way the server streams it: asynchronously, so a component
 * that suspends on a promise (React `use`) resolves and its real output lands
 * in the HTML. This is the only way to assert on what a visitor receives in the
 * FIRST streamed bytes, which is a different question from what
 * `@testing-library/react` shows after a client mount.
 *
 * The synchronous `renderToStaticMarkup` cannot render a suspending tree — it
 * throws — which is exactly what makes it the right tool for the OPPOSITE
 * assertion: proving a component does NOT suspend (see the static-shell guards
 * in `src/lib/datetime/device-timezone.test.tsx`).
 */
export async function renderServerHtml(node: ReactNode): Promise<string> {
  const { renderToReadableStream } = await import("react-dom/server");
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return await new Response(stream).text();
}
