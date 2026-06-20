/**
 * Push ALL branded MONOLITH auth email templates (subject + HTML) to the hosted
 * Supabase project via the Management API. Uses the Management API — not
 * `supabase config push` — so it touches ONLY the mailer fields below and never
 * overwrites the project's Site URL or other settings from the local-dev
 * `config.toml` (which has `site_url = http://127.0.0.1:3000` and
 * `enable_confirmations = false`, both wrong for production).
 *
 * The template HTML files in `supabase/templates/*.html` stay the single source
 * of truth; this script reads them at run time. To brand a new auth email,
 * add its file + subject to TEMPLATES below (field names mirror GoTrue's
 * `mailer_templates_<flow>_content` / `mailer_subjects_<flow>`).
 *
 * Supersedes `push-confirmation-email.ts` (which pushed confirmation only).
 *
 * Run: SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm exec tsx scripts/push-auth-emails.ts
 * (token = a Supabase personal access token from https://supabase.com/dashboard/account/tokens)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "hjqcahbbbdaknbbnfnvl";

/** flow = GoTrue mailer flow; file = template under supabase/templates/. */
const TEMPLATES = [
  {
    flow: "confirmation",
    file: "confirmation.html",
    subject: "Confirm your email for MONOLITH",
  },
  {
    flow: "recovery",
    file: "recovery.html",
    subject: "Reset your MONOLITH password",
  },
  {
    flow: "invite",
    file: "invite.html",
    subject: "You've been invited to MONOLITH",
  },
] as const;

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is required (a Supabase personal access token, sbp_…).",
    );
  }

  const body: Record<string, string | boolean> = {
    // false = users must confirm their email (the branded confirmation is sent).
    mailer_autoconfirm: false,
  };

  for (const { flow, file, subject } of TEMPLATES) {
    const html = readFileSync(
      resolve(process.cwd(), "supabase/templates", file),
      "utf8",
    );
    body[`mailer_subjects_${flow}`] = subject;
    body[`mailer_templates_${flow}_content`] = html;
  }

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    throw new Error(
      `Management API ${res.status} ${res.statusText}: ${await res.text()}`,
    );
  }

  console.log(
    `Pushed ${TEMPLATES.length} branded auth email templates ` +
      `(${TEMPLATES.map((t) => t.flow).join(", ")}) to project ${PROJECT_REF}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
