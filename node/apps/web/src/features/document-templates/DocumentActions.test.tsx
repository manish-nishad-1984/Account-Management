import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presetLayout, type PrintBundle } from "@accountmanagement/contracts";
import { DocumentActions, DocumentPdfError, SavedDocumentPdfButton, useDocumentPdf } from "./DocumentActions";
import { sampleDocument } from "./render/sample-document";
import { json } from "../../test/render";

/**
 * THE PDF AND PRINT BUTTONS ON A LIST ROW (client, 18 Sep 2026).
 *
 * The photograph and the paging need a real browser, so the part that makes the
 * file is replaced here; what is tested is everything around it — which document
 * is fetched, which layout it is drawn with, and what a person sees when it fails.
 */
const save = vi.hoisted(() => vi.fn());
vi.mock("./pdf", () => ({ saveDocumentPdf: save }));

const ORDER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const MODERN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

const bundle = (defaultTemplateId: string | null): PrintBundle => ({
  document: { ...sampleDocument("purchase-order"), id: ORDER },
  templates: [
    {
      id: MODERN,
      name: "Modern",
      companyId: null,
      isDefault: defaultTemplateId === MODERN,
      layout: presetLayout("modern", "purchase-order"),
    },
  ],
  defaultTemplateId,
});

function Row() {
  const pdf = useDocumentPdf();
  return (
    <>
      <DocumentPdfError pdf={pdf} />
      <DocumentActions pdf={pdf} documentType="purchase-order" id={ORDER} label="PO/26-27/0107" />
    </>
  );
}

function PrintPageStandIn() {
  const params = useParams();
  return <p>print page for {`${params.documentType} ${params.id}`}</p>;
}

function renderRow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/purchase-orders"]}>
        <Routes>
          <Route path="/purchase-orders" element={<Row />} />
          <Route path="/print/:documentType/:id" element={<PrintPageStandIn />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const downloadButton = () => screen.getByRole("button", { name: "Download PDF of PO/26-27/0107" });

describe("the PDF and Print buttons on a list row", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    save.mockReset();
    save.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves the document with the company's default layout", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async () => json(bundle(MODERN)));
    renderRow();

    await user.click(downloadButton());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [layout, document] = save.mock.calls[0]!;
    expect(layout).toEqual(presetLayout("modern", "purchase-order"));
    expect(document).toMatchObject({ id: ORDER, title: "PURCHASE ORDER" });
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]![0])).toContain(`/document-print/purchase-order/${ORDER}`);
  });

  it("falls back to the built-in Classic when no default is set", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async () => json(bundle(null)));
    renderRow();

    await user.click(downloadButton());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0]).toEqual(presetLayout("classic", "purchase-order"));
  });

  it("says so when the document may not be opened, and makes no file", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async () => json({ message: "Forbidden" }, 403));
    renderRow();

    await user.click(downloadButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to view this document.");
    expect(save).not.toHaveBeenCalled();
  });

  /** A browser that cannot draw the PDF still has a way to one. */
  it("points to Print when the browser cannot make the file", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async () => json(bundle(null)));
    save.mockRejectedValue(new Error("canvas"));
    renderRow();

    await user.click(downloadButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/Use Print, and choose Save as PDF/);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  describe("inside an open order", () => {
    const renderInForm = (dirty: boolean) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(
        <QueryClientProvider client={client}>
          <SavedDocumentPdfButton documentType="purchase-order" id={ORDER} dirty={dirty} />
        </QueryClientProvider>,
      );
    };

    it("saves the order as it is saved", async () => {
      const user = userEvent.setup();
      vi.mocked(globalThis.fetch).mockImplementation(async () => json(bundle(null)));
      renderInForm(false);

      await user.click(screen.getByRole("button", { name: "Download PDF" }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    });

    /** A PDF that silently left out what was just typed would go out as the order. */
    it("waits while the form has unsaved changes, and says why", () => {
      renderInForm(true);

      expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
      expect(screen.getByText("Save first to include your changes")).toBeInTheDocument();
    });
  });

  it("opens the print page for the same document", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole("button", { name: "Print PO/26-27/0107" }));

    expect(screen.getByText(`print page for purchase-order ${ORDER}`)).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
