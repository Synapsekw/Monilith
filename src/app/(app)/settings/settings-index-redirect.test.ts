import { describe, expect, it } from "vitest";
import nextConfig from "../../../../next.config";

/**
 * `/settings` must be redirected to `/settings/profile` by the ROUTING layer,
 * not by a `redirect()` inside a rendered page.
 *
 * Why this is a test and not a comment: the page-level version of this redirect
 * shipped to production and silently broke the Settings menu item. `/settings`
 * renders inside the `(app)` streaming shell, so `redirect()` was thrown from a
 * streaming context — Next.js degrades that to a client-side meta-refresh in the
 * flushed HTML and to a serialized redirect digest in the RSC payload. A hard
 * page load recovered after a 1s meta refresh; a client-side navigation (what
 * clicking "Settings" in the user menu actually does) rendered the settings
 * layout with an empty content column and never navigated. A `redirects()` entry
 * runs before rendering, so both paths get a real 307.
 * See vault/decisions/2026-09-04-gotcha-99-a-redirect-thrown-inside-the-streaming-shell-never-navigates.md.
 */
describe("settings index redirect", () => {
  it("redirects /settings to /settings/profile at the routing layer", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toContainEqual(
      expect.objectContaining({
        source: "/settings",
        destination: "/settings/profile",
        permanent: false,
      }),
    );
  });
});
