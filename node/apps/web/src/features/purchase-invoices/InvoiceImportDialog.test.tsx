import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseInvoiceImportPreview } from "@accountmanagement/contracts";
import { InvoiceImportDialog } from "./InvoiceImportDialog";
import { json, renderWithAuth } from "../../test/render";

const PREVIEW: PurchaseInvoiceImportPreview = {
  rowCount: 3,
  invoiceCount: 2,
  lineCount: 3,
  invoices: [
    {
      row: 2, invoiceNo: "GENT/57", date: "2026-10-05", supplier: "GIRIRAJ ENTERPRISE", company: "DH PATEL", site: "SURAT",
      type: "Purchase", lineCount: 2, subtotal: "49700.00", totalGst: "7620.00", tds: "200.00", adjustment: "-3.00",
      roundOff: "0.00", total: "57117.00", sheetTotal: "57117.00",
    },
    {
      row: 4, invoiceNo: "BI/163", date: "2026-09-21", supplier: "BHAGAWATI INDUSTRIES", company: "DH PATEL", site: "SURAT",
      type: "Purchase", lineCount: 1, subtotal: "32500.00", totalGst: "3900.00", tds: "0.00", adjustment: "0.00",
      roundOff: "0.00", total: "36400.00", sheetTotal: null,
    },
  ],
  totals: { subtotal: "82200.00", totalGst: "11520.00", tds: "200.00", adjustment: "-3.00", roundOff: "0.00", total: "93517.00" },
  errors: [],
};

const file = () => new File(["x"], "october.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const calls = () => vi.mocked(globalThis.fetch).mock.calls.map(([input, init]) => ({ url: String(input), method: (init as RequestInit | undefined)?.method }));

describe("InvoiceImportDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const open = () => renderWithAuth(<InvoiceImportDialog open onClose={vi.fn()} />, { permissions: ["purchase-invoice.add"] });

  it("shows the summary first and imports only after the totals are ticked as checked", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) =>
      Promise.resolve(
        /import\/preview/.test(String(input)) ? json(PREVIEW) : json({ created: 2, total: "93517.00" }),
      ),
    );
    const user = userEvent.setup();
    open();

    await user.upload(screen.getByLabelText("Spreadsheet"), file());
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /check file/i }));

    const summary = await screen.findByLabelText("Import summary");
    expect(within(summary).getByText("93,517.00")).toBeInTheDocument();
    expect(within(summary).getByText("2")).toBeInTheDocument();
    expect(calls().some((c) => c.method === "POST" && /\/import$/.test(c.url))).toBe(false); // nothing saved yet

    const importButton = screen.getByRole("button", { name: /import 2 invoices/i });
    expect(importButton).toBeDisabled();
    await user.click(screen.getByLabelText(/I have checked these figures: 2 invoices totalling/i));
    expect(importButton).toBeEnabled();
    await user.click(importButton);

    expect(await screen.findByText(/Imported 2 invoices totalling/i)).toBeInTheDocument();
    const saved = calls().find((c) => /\/import\?/.test(c.url))!;
    expect(saved.url).toContain("count=2");
    expect(saved.url).toContain("total=93517.00");
  });

  it("lists every problem with its row and offers no import", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() =>
      Promise.resolve(
        json({
          ...PREVIEW,
          invoiceCount: 0,
          invoices: [],
          errors: [
            { row: 3, column: "Item", message: 'Item "Gold bars" was not found.' },
            { row: 5, column: "Invoice total", message: "The sheet says 1181.00 but the lines come to 1180.00" },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    open();
    await user.upload(screen.getByLabelText("Spreadsheet"), file());
    await user.click(screen.getByRole("button", { name: /check file/i }));

    expect(await screen.findByText(/Fix 2 problems/i)).toBeInTheDocument();
    expect(screen.getByText(/Gold bars/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();
    await waitFor(() => expect(screen.queryByLabelText(/I have checked/i)).not.toBeInTheDocument());
  });
});
