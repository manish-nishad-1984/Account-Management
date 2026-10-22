import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_PRESETS, presetLayout, type PrintBundle, type TemplateLayout } from "@accountmanagement/contracts";
import { withoutAmounts } from "./render/without-amounts";
import { DocumentPreviewDialog } from "./DocumentPreviewDialog";
import { PrintDocumentPage } from "./PrintDocumentPage";
import { sampleDocument } from "./render/sample-document";
import { json } from "../../test/render";

/** A purchase order with its amounts, or without them (client, 22 Oct 2026). */
const ORDER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const BUNDLE: PrintBundle = { document: { ...sampleDocument("purchase-order"), id: ORDER }, templates: [], defaultTemplateId: null };

const blocksOf = (layout: TemplateLayout) => layout.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));

const wrap = (node: React.ReactNode, path = "/") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/print/:documentType/:id" element={<PrintDocumentPage />} />
          <Route path="*" element={node} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("withoutAmounts", () => {
  it("keeps what is ordered and how much, and drops every rate, amount and total, in every preset", () => {
    for (const preset of TEMPLATE_PRESETS) {
      const blocks = blocksOf(withoutAmounts(presetLayout(preset, "purchase-order")));
      expect(blocks.some((block) => ["totals", "tax-summary", "amount-in-words"].includes(block.type))).toBe(false);
      const table = blocks.find((block) => block.type === "items-table");
      expect(table && table.type === "items-table" && table.columns.every((c) => ["index", "item", "hsn", "quantity", "unit"].includes(c))).toBe(true);
      expect(table && table.type === "items-table" && table.columns).toContain("quantity");
      // The letterhead, the parties and the terms are untouched.
      expect(blocks.some((block) => block.type === "company")).toBe(true);
    }
  });
});

describe("previewing and printing a purchase order without amounts", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => json(BUNDLE)));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("switches the preview between with and without amounts, and prints the one chosen", async () => {
    const user = userEvent.setup();
    wrap(<DocumentPreviewDialog open onClose={vi.fn()} documentType="purchase-order" id={ORDER} />);

    const preview = await screen.findByRole("region", { name: "Document preview" });
    expect(within(preview).getAllByText("48,640.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "With amounts" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Without amounts" }));
    const bare = screen.getByRole("region", { name: "Document preview" });
    expect(within(bare).queryByText("48,640.00")).not.toBeInTheDocument();
    expect(within(bare).queryByText("380.00")).not.toBeInTheDocument();
    // Still says what is ordered.
    expect(within(bare).getByText(BUNDLE.document.lines[0]!.name)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^print$/i }));
    expect(await screen.findByRole("button", { name: "Without amounts" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("48,640.00")).not.toBeInTheDocument();
  });

  it("prints with amounts unless the address says otherwise, and the choice can be changed there", async () => {
    const user = userEvent.setup();
    wrap(null, `/print/purchase-order/${ORDER}`);
    expect((await screen.findAllByText("48,640.00")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Without amounts" }));
    expect(screen.queryByText("48,640.00")).not.toBeInTheDocument();
  });

  it("offers no such choice on an invoice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...BUNDLE, document: { ...sampleDocument("sales-invoice"), id: ORDER } })));
    wrap(<DocumentPreviewDialog open onClose={vi.fn()} documentType="sales-invoice" id={ORDER} />);
    await screen.findByRole("region", { name: "Document preview" });
    expect(screen.queryByRole("button", { name: "Without amounts" })).not.toBeInTheDocument();
  });
});
