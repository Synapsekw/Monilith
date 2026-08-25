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
    const saveButton = screen.getByRole("button", {
      name: /^save$/i,
    }) as HTMLButtonElement;
    // The disabled attribute is the primary protection an owner meets, and
    // it's asserted first. But jsdom (like every real browser) never
    // dispatches a click on a disabled control, so a click here would pass
    // trivially without ever reaching `handleSave`'s OWN guard
    // (`if (editingDoc && !bodyLoaded)`) — proving nothing about that second
    // layer. Force-enabling the DOM node directly (simulating a bypass of the
    // disabled attribute — a stale render, a devtools edit, anything) is what
    // actually exercises it.
    expect(saveButton).toBeDisabled();
    saveButton.disabled = false;
    fireEvent.click(saveButton);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it("drops a stale body fetch if the owner has already moved to a different document", async () => {
    const DOC_B = {
      id: "d2",
      title: "Doc B",
      tokenEstimate: 10,
      sourceFormat: "pasted" as const,
      sourceFileName: null,
      updatedAt: "2026-08-24T11:00:00Z",
    };
    let resolveA!: (value: { ok: true; data: { body: string } }) => void;
    const deferredA = new Promise<{ ok: true; data: { body: string } }>(
      (resolve) => {
        resolveA = resolve;
      },
    );
    getDocumentBody.mockImplementation((id: string) =>
      id === "d1"
        ? deferredA
        : Promise.resolve({ ok: true, data: { body: "B's original body" } }),
    );

    render(<DocumentLibrary documents={[DOCS[0], DOC_B]} attachedBy={{}} />);

    // Open A — its fetch is deferred and never resolves during this test
    // until we explicitly settle it, below.
    fireEvent.click(screen.getByText("Standup format"));
    expect(getDocumentBody).toHaveBeenCalledWith("d1");

    // Leave before A's fetch settles.
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    // Open B — its own fetch resolves normally.
    fireEvent.click(screen.getByText("Doc B"));
    await waitFor(() =>
      expect(screen.getByLabelText(/content/i)).toHaveValue(
        "B's original body",
      ),
    );

    // The owner edits B.
    fireEvent.change(screen.getByLabelText(/content/i), {
      target: { value: "B's original body, with an edit" },
    });

    // NOW A's stale fetch resolves — after B is open and already edited.
    resolveA({ ok: true, data: { body: "A's body" } });
    // Flush the microtask queue AND a macrotask tick so the (stale)
    // continuation, if it were to run, has had its chance.
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // A's stale response must not have clobbered what the owner typed into B.
    expect(screen.getByLabelText(/content/i)).toHaveValue(
      "B's original body, with an edit",
    );

    // Saving now must submit B's id with B's edited body — never A's content
    // under B's id.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(updateDocument).toHaveBeenCalled());
    expect(updateDocument).toHaveBeenCalledWith({
      id: "d2",
      title: "Doc B",
      body: "B's original body, with an edit",
    });
    expect(updateDocument).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: "A's body" }),
    );
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
