/**
 * Push ONLY the branded confirmation email (template + subject) to the hosted
 * Supabase project, and require email confirmation. Uses the Management API so
 * it touches exactly these three auth fields — unlike `supabase config push`,
 * which would also overwrite the project's Site URL and other settings from the
 * local-dev `config.toml` (that file has `site_url = http://127.0.0.1:3000` and
 * `enable_confirmations = false`, both wrong for production).
 *
 * The template HTML in `supabase/templates/confirmation.html` stays the single
 * source of truth; this script reads it at run time.
 *
 * Run: SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm exec tsx scripts/push-confirmation-email.ts
 * (token = a Supabase personal access token from https://supabase.com/dashboard/account/tokens)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "hjqcahbbbdaknbbnfnvl";

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is required (a Supabase personal access token, sbp_…).",
    );
  }

  const html = readFileSync(
    resolve(process.cwd(), "supabase/templates/confirmation.html"),
    "utf8",
  );

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mailer_subjects_confirmation: "Confirm your email for MONOLITH",
        mailer_templates_confirmation_content: html,
        // false = users must confirm their email (the branded email is sent).
        mailer_autoconfirm: false,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(
      `Management API ${res.status} ${res.statusText}: ${await res.text()}`,
    );
  }

  console.log(
    `Confirmation email template + subject pushed to project ${PROJECT_REF}; email confirmation required.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
