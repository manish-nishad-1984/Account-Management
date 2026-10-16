import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrintBundle } from "@accountmanagement/contracts";
import { DocumentActions, useDocumentPdf } from "./DocumentActions";
import { DocumentPreviewDialog, SavedDocumentPreviewButton } from "./DocumentPreviewDialog";
import { sampleDocument } from "./render/sample-document";
import { json } from "../../test/render";

/**
 * PREVIEW IN PLACE OF DOWNLOAD (client, 16 Oct 2026), on the purchase order list
 * and inside an open order. Download PDF and Print are in the preview.
 */
const save = vi.hoisted(() => vi.fn());
vi.mock("./pdf", () => ({ saveDocumentPdf: save }));

const ORDER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const BUNDLE: PrintBundle = { document: { ...sampleDocument("purchase-order"), id: ORDER }, templates: [], defaultTemplateId: null };

const wrap = (node: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );

function Row() {
  const pdf = useDocumentPdf();
  return <DocumentActions pdf={pdf} documentType="purchase-order" id={ORDER} label="PO/26-27/0107" onPreview={() => undefined} />;
}

describe("previewing a purchase order", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => json(BUNDLE)));
    save.mockReset();
    save.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows Preview on a list row instead of Download PDF, and keeps Print", () => {
    wrap(<Row />);
    expect(screen.getByRole("button", { name: "Preview PO/26-27/0107" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download pdf/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print PO/26-27/0107" })).toBeInTheDocument();
  });

  it("shows the document in a popup, with Download PDF inside it", async () => {
    const user = userEvent.setup();
    wrap(<DocumentPreviewDialog open onClose={vi.fn()} documentType="purchase-order" id={ORDER} />);

    const preview = await screen.findByRole("region", { name: "Document preview" });
    expect(within(preview).getAllByText(/purchase order/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /download pdf/i }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /^print$/i })).toBeInTheDocument();
  });

  it("in an open order, opens the preview, and waits while the form has unsaved changes", async () => {
    const user = userEvent.setup();
    const { rerender } = wrap(<SavedDocumentPreviewButton documentType="purchase-order" id={ORDER} dirty={false} />);

    await user.click(screen.getByRole("button", { name: /^preview$/i }));
    expect(await screen.findByRole("region", { name: "Document preview" })).toBeInTheDocument();
    // No Print here: it would leave the form and lose what is unsaved in it.
    expect(screen.queryByRole("button", { name: /^print$/i })).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SavedDocumentPreviewButton documentType="purchase-order" id={ORDER} dirty />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: /^preview$/i })).toBeDisabled();
    expect(screen.getByText(/save first/i)).toBeInTheDocument();
  });
});
