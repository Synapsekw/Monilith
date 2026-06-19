import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATE = resolve(process.cwd(), "supabase/templates/confirmation.html");

describe("confirmation email template", () => {
  const html = readFileSync(TEMPLATE, "utf8");

  it("uses the GoTrue confirmation URL variable", () => {
    expect(html).toContain("{{ .ConfirmationURL }}");
  });

  it("builds the logo URL from the site URL variable", () => {
    expect(html).toContain("{{ .SiteURL }}/email/monolith-logo@2x.png");
  });

  it("carries the MONOLITH brand and a confirm action", () => {
    expect(html).toMatch(/MONOLITH/);
    expect(html.toLowerCase()).toContain("confirm");
  });
});
