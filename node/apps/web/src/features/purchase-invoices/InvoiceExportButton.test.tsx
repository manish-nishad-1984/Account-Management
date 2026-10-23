import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceExportButton } from "./InvoiceExportButton";
import { json, renderWithAuth } from "../../test/render";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../lib/download", () => ({ saveBlob: save }));

/** "Export to Excel" with or without items (client, 19 Oct 2026). */
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const invoice = (id: string, displayNo: string, totalAmount: string) => ({
  id, displayNo, supplierInvoiceNo: displayNo, invoiceNo: `DHP/26-27/${displayNo}`, invoiceType: "Purchase",
  siteId: null, siteName: "SURAT", supplierId: "s", supplierName: "GIRIRAJ", companyId: "c", companyName: "DH PATEL",
  siteLocationId: null, siteLocationName: "GATE", documentDate: "2026-10-01", subtotal: totalAmount, totalGstAmount: "0.00",
  totalDiscount: "0.00", tds: "0.00", roundOff: "0.00", totalAmount, lineCount: 0, paymentStatus: null, isPaidOut: false,
  isApproved: true, createdAt: "2026-10-01T00:00:00.000Z", settlement: "unpaid", pendingAmount: totalAmount,
  capabilities: { canEdit: true, canDelete: true, canApprove: true },
});
const line = (purchaseInvoiceId: string, lineNumber: number, itemLabel: string, lineTotal: string) => ({
  purchaseInvoiceId, id: `${purchaseInvoiceId}-${lineNumber}`, itemId: null, itemLabel, itemDescription: null, unitId: 1,
  unitName: "Nos", quantity: "2.00", unitPrice: "50.00", discountPerUnit: "0.00", discountPercent: "0.00", gstPercent: "18",
  gstAmount: "18.00", netAmount: "100.00", lineTotal, lineNumber,
});

const exported = () => {
  const call = vi.mocked(globalThis.fetch).mock.calls.find(([input]) => String(input).includes("/grid-exports/xlsx"));
  return call ? (JSON.parse(String((call[1] as RequestInit).body)) as { columns: { header: string }[]; rows: string[][] }) : null;
};

describe("InvoiceExportButton", () => {
  beforeEach(() => {
    save.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/grid-exports/xlsx")) return Promise.resolve(new Response(new Blob(["x"])));
        if (url.includes("/purchase-invoices/lines"))
          return Promise.resolve(json({ lines: [line(A, 2, "Sand", "118.00"), line(A, 1, "Cement", "236.00")] }));
        return Promise.resolve(json({ rows: [invoice(A, "INV-1", "354.00"), invoice(B, "INV-2", "500.00")], nextCursor: null, total: 2 }));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const open = () =>
    renderWithAuth(
      <InvoiceExportButton
        params={{}}
        filters={{ companyId: "c" }}
        invoiceColumns={[{ header: "Invoice", value: (row) => row.displayNo }]}
      />,
      { permissions: ["purchase-invoice.view"] },
    );

  it("with items: one row per line, invoice totals on its first line only, an invoice with no line on one row", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: /export to excel/i }));
    await user.click(screen.getByRole("menuitem", { name: /with items/i }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const linesCall = vi.mocked(globalThis.fetch).mock.calls.find(([input]) => String(input).includes("/purchase-invoices/lines"));
    expect(JSON.parse(String((linesCall![1] as RequestInit).body))).toEqual({ ids: [A, B] });

    const sheet = exported()!;
    const col = (name: string) => sheet.columns.findIndex((column) => column.header === name);
    expect(sheet.rows.map((row) => [row[col("Invoice")], row[col("Item")], row[col("Line total")], row[col("Invoice total")]])).toEqual([
      ["INV-1", "Cement", "236.00", "354.00"],
      ["INV-1", "Sand", "118.00", ""],
      ["INV-2", "", "", "500.00"],
    ]);
    expect(sheet.rows[0]![col("Site location")]).toBe("GATE");
    expect(String(save.mock.calls[0]![1])).toMatch(/^Purchase-Invoices-with-Items-/);
  });

  it("invoices only: the list's own columns, one row per invoice, and no lines asked for", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: /export to excel/i }));
    await user.click(screen.getByRole("menuitem", { name: /invoices only/i }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(exported()!.rows).toEqual([["INV-1"], ["INV-2"]]);
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([input]) => String(input).includes("/lines"))).toBe(false);
  });
});

/** Client, 23 Oct 2026: the Excel lists bills oldest first, by the bill's own date. */
describe("oldestFirst", () => {
  it("orders by bill date, then by entry, with an undated bill last", async () => {
    const { oldestFirst } = await import("./InvoiceExportButton");
    const bill = (id: string, documentDate: string | null, createdAt: string) => ({ id, documentDate, createdAt }) as never;
    const sorted = oldestFirst([
      bill("new", "2026-10-20T00:00:00.000Z", "2026-10-20T10:00:00.000Z"),
      bill("none", null, "2026-01-01T00:00:00.000Z"),
      bill("old-b", "2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z"),
      bill("old-a", "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
    ]);
    expect(sorted.map((row: { id: string }) => row.id)).toEqual(["old-a", "old-b", "new", "none"]);
  });
});
