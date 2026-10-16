import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presetLayout, type PrintBundle } from "@accountmanagement/contracts";
import { PrintDocumentPage } from "./PrintDocumentPage";
import { sampleDocument } from "./render/sample-document";
import { json } from "../../test/render";

const INVOICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const COMPACT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const MINIMAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const bundle = (defaultTemplateId: string | null): PrintBundle => ({
  document: { ...sampleDocument("sales-invoice"), id: INVOICE, number: "DHP/26-27/0107" },
  templates: [
    { id: COMPACT, name: "Compact", companyId: null, isDefault: defaultTemplateId === COMPACT, layout: presetLayout("compact", "sales-invoice") },
    { id: MINIMAL, name: "Minimal", companyId: null, isDefault: false, layout: presetLayout("minimal", "sales-invoice") },
  ],
  defaultTemplateId,
});

function open(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/print/:documentType/:id" element={<PrintDocumentPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const layoutSelect = () => screen.getByLabelText("Layout") as HTMLSelectElement;

describe("PrintDocumentPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prints the invoice with its default template", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => json(bundle(COMPACT)));
    open(`/print/sales-invoice/${INVOICE}`);

    expect(await screen.findByText("TAX INVOICE · DHP/26-27/0107")).toBeInTheDocument();
    expect(layoutSelect().value).toBe(COMPACT);
    expect(within(layoutSelect()).getByRole("option", { name: "Compact (default)" })).toBeInTheDocument();
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]![0])).toBe(`/api/v1/document-print/sales-invoice/${INVOICE}`);
  });

  it("prints with the built-in Classic when no default is set", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => json(bundle(null)));
    open(`/print/sales-invoice/${INVOICE}`);

    await screen.findByText("TAX INVOICE · DHP/26-27/0107");
    expect(layoutSelect().value).toBe("built-in");
    expect(screen.getByText("Central Tax")).toBeInTheDocument();
  });

  it("uses the template named in the address", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => json(bundle(COMPACT)));
    open(`/print/sales-invoice/${INVOICE}?template=${MINIMAL}`);

    await screen.findByText("TAX INVOICE · DHP/26-27/0107");
    expect(layoutSelect().value).toBe(MINIMAL);
  });

  it("switches layout, and opens the browser's print dialog", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    vi.mocked(globalThis.fetch).mockImplementation(async () => json(bundle(COMPACT)));
    open(`/print/sales-invoice/${INVOICE}`);

    await screen.findByText("TAX INVOICE · DHP/26-27/0107");
    await user.selectOptions(layoutSelect(), "Minimal");
    await waitFor(() => expect(layoutSelect().value).toBe(MINIMAL));

    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledTimes(1);
    // Looking and printing only: one read, nothing written.
    expect(vi.mocked(globalThis.fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  // Client, 17 Oct 2026: a bill printed on a letterhead leaves the top of every page empty.
  it("leaves the space asked for at the top and foot of every page, and remembers it", async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async () => json(bundle(null)));
    const { unmount } = open(`/print/sales-invoice/${INVOICE}`);
    await screen.findByText("TAX INVOICE · DHP/26-27/0107");

    const margin = presetLayout("classic", "sales-invoice").page.marginMm; // 10
    const pageRule = () =>
      /@page \{[^}]*\}/.exec(Array.from(document.querySelectorAll("style")).map((s) => s.textContent).join(" "))![0];
    expect(pageRule()).toContain(`margin: ${margin}mm ${margin}mm ${margin}mm;`);

    await user.clear(screen.getByLabelText("Space at the top, in millimetres"));
    await user.type(screen.getByLabelText("Space at the top, in millimetres"), "45");
    await user.clear(screen.getByLabelText("Space at the bottom, in millimetres"));
    await user.type(screen.getByLabelText("Space at the bottom, in millimetres"), "20");
    expect(pageRule()).toContain(`margin: ${margin + 45}mm ${margin}mm ${margin + 20}mm;`);
    expect(screen.getByLabelText("Letterhead space at the top")).toBeInTheDocument();

    // Another visit to the page starts with the same space.
    unmount();
    open(`/print/sales-invoice/${INVOICE}`);
    await screen.findByText("TAX INVOICE · DHP/26-27/0107");
    expect(screen.getByLabelText("Space at the top, in millimetres")).toHaveValue(45);
    window.localStorage.clear();
  });

  it("says so when the invoice cannot be opened", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => json({ message: "Forbidden" }, 403));
    open(`/print/sales-invoice/${INVOICE}`);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("refuses an address that is not a document type", () => {
    open(`/print/cheques/${INVOICE}`);
    expect(screen.getByText("There is nothing to print at this address.")).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
