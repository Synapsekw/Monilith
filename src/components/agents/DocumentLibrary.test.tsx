import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentLibrary } from "./DocumentLibrary";

const createDocument = vi.fn();
const deleteDocument = vi.fn();
vi.mock("@/lib/agents/document-actions", () => ({
  createDocument: (...a: unknown[]) => createDocument(...a),
  updateDocument: vi.fn(),
  deleteDocument: (...a: unknown[]) => deleteDocument(...a),
}));

const DOCS = [
  {
    id: "d1",
    title: "Standup format",
    tokenEstimate: 120,
    sourceFormat: "pasted" as const,
    sourceFileName: null,
    updatedAt: "2026-08-24T10:00:00Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  createDocument.mockResolvedValue({ ok: true, data: { id: "d2" } });
  deleteDocument.mockResolvedValue({ ok: true, data: undefined });
});

describe("DocumentLibrary", () => {
  it("lists documents with their token cost", () => {
    render(<DocumentLibrary documents={DOCS} attachedBy={{}} />);
    expect(screen.getByText("Standup format")).toBeInTheDocument();
    expect(screen.getByText(/120 tokens/i)).toBeInTheDocument();
  });

  it("shows an empty state when the library is empty", () => {
    render(<DocumentLibrary documents={[]} attachedBy={{}} />);
    expect(screen.getByText(/no reference documents/i)).toBeInTheDocument();
  });

  it("requires the review step before saving a pasted document", async () => {
    render(<DocumentLibrary documents={[]} attachedBy={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /add document/i }));
    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "Vocab" },
    });
    fireEvent.change(screen.getByLabelText(/content/i), {
      target: { value: "ARR = annual recurring revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Vocab",
          body: "ARR = annual recurring revenue",
          sourceFormat: "pasted",
        }),
      ),
    );
  });

  it("shows a live token estimate as the owner types", () => {
    render(<DocumentLibrary documents={[]} attachedBy={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /add document/i }));
    fireEvent.change(screen.getByLabelText(/content/i), {
      target: { value: "abcdefgh" }, // 8 chars -> 2 tokens
    });
    expect(screen.getByText(/2 tokens/i)).toBeInTheDocument();
  });

  it("names the affected agents before deleting", async () => {
    render(
      <DocumentLibrary
        documents={DOCS}
        attachedBy={{ d1: ["Morning brief", "Standup writer"] }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(screen.getByText(/Morning brief/)).toBeInTheDocument();
    expect(screen.getByText(/Standup writer/)).toBeInTheDocument();
    expect(deleteDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^delete document$/i }));
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith("d1"));
  });

  it("flags PDF as lossy on the upload control", () => {
    render(<DocumentLibrary documents={[]} attachedBy={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /add document/i }));
    expect(screen.getByText(/PDF.*lossy/i)).toBeInTheDocument();
  });

  it("surfaces an empty-extraction failure as an inline error", async () => {
    render(<DocumentLibrary documents={[]} attachedBy={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /add document/i }));
    const input = screen.getByLabelText(/upload/i);
    fireEvent.change(input, {
      target: { files: [new File(["   "], "scan.txt")] },
    });
    await waitFor(() =>
      expect(screen.getByText(/couldn't read any text/i)).toBeInTheDocument(),
    );
    expect(createDocument).not.toHaveBeenCalled();
  });
});
