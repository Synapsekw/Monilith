"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  documentInputSchema,
  documentUpdateSchema,
  setAgentDocumentsSchema,
} from "@/lib/validations/agent-documents";
import {
  insertDocument,
  updateDocumentRow,
  deleteDocumentRow,
  replaceAgentDocuments,
} from "./documents-db";

// NOTE (gotcha-92): this module is "use server". It may export ONLY async
// functions. No `export type { … }` and no `export { type … }` — those are
// export CLAUSES and break at runtime even though `pnpm build` exits 0.

const AGENTS_ROUTE = "/settings/agents";
const NO_ORG = "No organization.";

export async function createDocument(input: {
  title: string;
  body: string;
  sourceFormat: string;
  sourceFileName: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = documentInputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid document.");

  try {
    const user = await requireUser();
    // resolveActiveOrg(), NOT getActiveOrgId() — this module's sibling
    // src/lib/agents/actions.ts and src/lib/ai/settings-actions.ts both
    // resolve the org this way for mutations, and it lets us fail with a
    // clear "No organization." rather than silently inserting org_id: "".
    const org = await resolveActiveOrg();
    if (!org) return fail(NO_ORG);
    const supabase = await createClient();
    const { id } = await insertDocument(supabase, {
      orgId: org.id,
      ownerId: user.id,
      ...parsed.data,
    });
    revalidatePath(AGENTS_ROUTE);
    return { ok: true, data: { id } };
  } catch {
    return fail("Couldn't save that document.");
  }
}

export async function updateDocument(input: {
  id: string;
  title: string;
  body: string;
}): Promise<ActionResult> {
  const parsed = documentUpdateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid document.");

  try {
    const supabase = await createClient();
    // RLS scopes the update to the caller; no owner check is needed here and
    // adding one in TypeScript would imply the policy is optional.
    await updateDocumentRow(supabase, parsed.data.id, {
      title: parsed.data.title,
      body: parsed.data.body,
    });
    revalidatePath(AGENTS_ROUTE);
    return { ok: true, data: undefined };
  } catch {
    return fail("Couldn't save that document.");
  }
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    await deleteDocumentRow(supabase, id);
    revalidatePath(AGENTS_ROUTE);
    return { ok: true, data: undefined };
  } catch {
    return fail("Couldn't delete that document.");
  }
}

export async function setAgentDocuments(input: {
  userAgentId: string;
  documentIds: string[];
}): Promise<ActionResult> {
  const parsed = setAgentDocumentsSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid selection.");

  try {
    const supabase = await createClient();
    await replaceAgentDocuments(
      supabase,
      parsed.data.userAgentId,
      parsed.data.documentIds,
    );
    revalidatePath(AGENTS_ROUTE);
    return { ok: true, data: undefined };
  } catch {
    return fail("Couldn't update the attached documents.");
  }
}
