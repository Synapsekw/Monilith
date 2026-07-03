import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { UploadStep } from "@/components/boards/import/UploadStep";
import { MAX_BYTES } from "@/lib/boards/spreadsheet/types";

// Mock FileReader so readAsDataURL synchronously yields a base64 result
class MockFileReader {
  result: string | null = null;
  onloadend: (() => void) | null = null;
  readAsDataURL(_file: Blob) {
    this.result = "data:application/octet-stream;base64,eA==";
    if (this.onloadend) this.onloadend();
  }
}

beforeEach(() => {
  vi.stubGlobal("FileReader", MockFileReader);
});

function getDropzone() {
  return screen.getByTestId("upload-dropzone");
}

describe("UploadStep", () => {
  it("calls onFile with stripped base64 + name when a valid .xlsx is dropped", () => {
    const onFile = vi.fn();
    render(<UploadStep busy={false} error={null} onFile={onFile} />);

    const file = new File(["hello"], "data.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    fireEvent.drop(getDropzone(), { dataTransfer: { files: [file] } });

    expect(onFile).toHaveBeenCalledWith({ name: "data.xlsx", base64: "eA==" });
  });

  it("calls onFile with stripped base64 + name when a valid file is chosen via input", () => {
    const onFile = vi.fn();
    render(<UploadStep busy={false} error={null} onFile={onFile} />);

    const fileInput = screen.getByLabelText("Choose file") as HTMLInputElement;
    const file = new File(["hello"], "data.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(onFile).toHaveBeenCalledWith({ name: "data.csv", base64: "eA==" });
  });

  it("shows an inline error and never calls onFile for an unsupported extension", () => {
    const onFile = vi.fn();
    render(<UploadStep busy={false} error={null} onFile={onFile} />);

    const fileInput = screen.getByLabelText("Choose file") as HTMLInputElement;
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onFile).not.toHaveBeenCalled();
  });

  it("shows an inline error and never calls onFile for an oversized file", () => {
    const onFile = vi.fn();
    render(<UploadStep busy={false} error={null} onFile={onFile} />);

    const fileInput = screen.getByLabelText("Choose file") as HTMLInputElement;
    const file = new File(["hello"], "big.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    Object.defineProperty(file, "size", { value: MAX_BYTES + 1 });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onFile).not.toHaveBeenCalled();
  });

  it("renders the 'Analyzing file…' spinner when busy", () => {
    render(<UploadStep busy={true} error={null} onFile={vi.fn()} />);

    expect(screen.getByText("Analyzing file…")).toBeInTheDocument();
  });

  it("renders props.error as an alert", () => {
    render(
      <UploadStep busy={false} error="Server rejected file" onFile={vi.fn()} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Server rejected file");
  });
});
