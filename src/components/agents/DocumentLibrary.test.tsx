import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentLibrary } from "./DocumentLibrary";

const createDocument = vi.fn();
const updateDocument = vi.fn();
const deleteDocument = vi.fn();
const getDocumentBody = vi.fn();
vi.mock("@/lib/agents/document-actions", () => ({
  createDocument: (...a: unknown[]) => createDocument(...a),
  updateDocument: (...a: unknown[]) => updateDocument(...a),
  deleteDocument: (...a: unknown[]) => deleteDocument(...a),
  getDocumentBody: (...a: unknown[]) => getDocumentBody(...a),
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
  updateDocument.mockResolvedValue({ ok: true, data: undefined });
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

describe("DocumentLibrary · editing an existing document", () => {
  it("never fetches a body on first paint", () => {
    render(<DocumentLibrary documents={DOCS} attachedBy={{}} />);
    expect(getDocumentBody).not.toHaveBeenCalled();
  });

  it("fetches and pre-fills the body, and the title, when opening a document", async () => {
    getDocumentBody.mockResolvedValue({
      ok: true,
      data: { body: "full body text" },
    });
    render(<DocumentLibrary documents={DOCS} attachedBy={{}} />);
    fireEvent.click(screen.getByText("Standup format"));
    expect(getDocumentBody).toHaveBeenCalledWith("d1");
    // The title is known already (it's in the row) and needs no fetch.
    expect(screen.getByLabelText(/title/i)).toHaveValue("Standup format");
    await waitFor(() =>
      expect(screen.getByLabelText(/content/i)).toHaveValue("full body text"),
    );
  });

  it("reflects a live token count for the freshly loaded body", async () => {
    getDocumentBody.mockResolvedValue({
      ok: true,
      data: { body: "abcdefgh" }, // 8 chars -> 2 tokens
    });
    render(<DocumentLibrary documents={DOCS} attachedBy={{}} />);
    fireEvent.click(screen.getByText("Standup format"));
    await waitFor(() =>
      expect(screen.getByText(/2 tokens/i)).toBeInTheDocument(),
    );
  });

  it("surfaces a failed load inline and blocks saving over the document", async () => {
    getDocumentBody.mockResolvedValue({
      ok: false,
      error: "Couldn't load that document.",
    });
    render(<DocumentLibrary documents={DOCS} attachedBy={{}} />);
    fireEvent.click(screen.getByText("Standup format"));
    await waitFor(() =>
      expect(
        screen.getByText(/couldn't load that document/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it("saves the full amended body after editing one line", async () => {
    getDocumentBody.mockResolvedValue({
      ok: true,
      data: { body: "line one\nline two\nline three" },
    });
    render(<DocumentLibrary documents={DOCS} attachedBy={{}} />);
    fireEvent.click(screen.getByText("Standup format"));
    await waitFor(() =>
      expect(screen.getByLabelText(/content/i)).toHaveValue(
        "line one\nline two\nline three",
      ),
    );
    fireEvent.change(screen.getByLabelText(/content/i), {
      target: { value: "line one\nAMENDED\nline three" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(updateDocument).toHaveBeenCalledWith({
        id: "d1",
        title: "Standup format",
        body: "line one\nAMENDED\nline three",
      }),
    );
  });
});
