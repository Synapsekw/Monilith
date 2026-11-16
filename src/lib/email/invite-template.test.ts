import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INVITE_CONFIRM_PATH } from "@/lib/auth/invite-paths";

const TEMPLATE = resolve(process.cwd(), "supabase/templates/invite.html");

describe("invite email template", () => {
  const html = readFileSync(TEMPLATE, "utf8");
  // `&amp;` in an attribute or text node is a literal `&` once the mail client
  // parses it.
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) =>
    m[1].replaceAll("&amp;", "&"),
  );

  it("links to the app's server-side confirm route with the token hash", () => {
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toBe(
        `{{ .SiteURL }}${INVITE_CONFIRM_PATH}?token_hash={{ .TokenHash }}&type=invite`,
      );
    }
  });

  it("no longer uses the default confirmation URL (fragment session, lost on the server)", () => {
    expect(html).not.toContain("{{ .ConfirmationURL }}");
  });

  it("shows the same link as text for people who paste it", () => {
    expect(html.replaceAll("&amp;", "&")).toContain(
      `>{{ .SiteURL }}${INVITE_CONFIRM_PATH}?token_hash={{ .TokenHash }}&type=invite</a`,
    );
  });

  it("builds the logo URL from the site URL variable and keeps the brand", () => {
    expect(html).toContain("{{ .SiteURL }}/email/monolith-logo@2x.png");
    expect(html).toMatch(/MONOLITH/);
    expect(html).not.toMatch(/Pulse/);
  });
});
