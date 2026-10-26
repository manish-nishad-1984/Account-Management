import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GstReport } from "@accountmanagement/contracts";
import { GstReportPage } from "./GstReportPage";
import { presetDates } from "../exports/date-presets";
import { json, renderWithAuth } from "../../test/render";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../lib/download", () => ({ saveBlob: save }));

/** Input GST for the month's return (client, 22 Oct 2026). */
const SHAH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const STEEL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const bill = (over: Partial<GstReport["bills"][number]>): GstReport["bills"][number] => ({
  invoiceId: "i1", billNo: "B-1", ourNo: "DHP/26-27/1", date: "2026-09-10", invoiceType: "Purchase",
  supplierId: SHAH, supplierName: "SHAH ENTERPRISE", supplierGstin: "24AAAPS1234A1Z5", companyName: "DH PATEL", companyGstin: "24AABFD8160H1ZN",
  gstPercent: "18.00", interState: false, taxable: "1000.00", cgst: "90.00", sgst: "90.00", igst: "0.00", totalGst: "180.00", ...over,
});
const REPORT: GstReport = {
  bills: [
    bill({}),
    bill({ invoiceId: "i2", billNo: "MS-9", supplierId: STEEL, supplierName: "MUMBAI STEELS", supplierGstin: "27AAACM9999B1Z2", interState: true, taxable: "2000.00", cgst: "0.00", sgst: "0.00", igst: "360.00", totalGst: "360.00" }),
  ],
  suppliers: [
    { supplierId: STEEL, supplierName: "MUMBAI STEELS", supplierGstin: "27AAACM9999B1Z2", billCount: 1, taxable: "2000.00", cgst: "0.00", sgst: "0.00", igst: "360.00", totalGst: "360.00" },
    { supplierId: SHAH, supplierName: "SHAH ENTERPRISE", supplierGstin: "24AAAPS1234A1Z5", billCount: 1, taxable: "1000.00", cgst: "90.00", sgst: "90.00", igst: "0.00", totalGst: "180.00" },
  ],
  rates: [{ gstPercent: "18.00", taxable: "3000.00", cgst: "90.00", sgst: "90.00", igst: "360.00", totalGst: "540.00" }],
  totals: { billCount: 2, taxable: "3000.00", cgst: "90.00", sgst: "90.00", igst: "360.00", totalGst: "540.00" },
  warnings: [{ problem: "supplier-gstin-invalid", name: "LOCAL HARDWARE", gstin: "24ABC", billCount: 3 }],
  paid: [
    {
      paymentId: "p1", date: "2026-10-03", supplierId: SHAH, supplierName: "SHAH ENTERPRISE", supplierGstin: "24AAAPS1234A1Z5",
      companyName: "DH PATEL", siteName: "Akwada", referenceNo: "UTR1", amount: "1280.00", billNos: ["B-1"], unsettled: "100.00",
      taxable: "1000.00", cgst: "90.00", sgst: "90.00", igst: "0.00", totalGst: "180.00",
    },
  ],
  paidTotals: { paymentCount: 1, amount: "1280.00", unsettled: "100.00", taxable: "1000.00", cgst: "90.00", sgst: "90.00", igst: "0.00", totalGst: "180.00" },
};

const urls = () => vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));

describe("GstReportPage", () => {
  beforeEach(() => {
    save.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/grid-exports/workbook")) return Promise.resolve(new Response(new Blob(["x"])));
        if (url.includes("/reports/gst")) return Promise.resolve(json(REPORT));
        return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens on last month, by supplier, with CGST, SGST, IGST and the total", async () => {
    renderWithAuth(<GstReportPage />, { permissions: ["purchase-invoice.view"] });
    const table = await screen.findByRole("table", { name: "Supplier-wise GST" });
    const { fromDate, toDate } = presetDates("lastMonth", new Date());
    expect(urls().some((url) => url.includes(`fromDate=${fromDate}`) && url.includes(`toDate=${toDate}`))).toBe(true);
    expect(screen.getByRole("button", { name: "Last month" })).toHaveAttribute("aria-pressed", "true");

    const steel = within(table).getByText("MUMBAI STEELS").closest("tr")!;
    expect(within(steel).getByText("27AAACM9999B1Z2")).toBeInTheDocument();
    expect(within(steel).getAllByText("360.00")).toHaveLength(2); // IGST and total
    expect(within(table).getByText("Total").closest("tr")).toHaveTextContent("540.00");
  });

  it("says which GSTINs will not match 2B", async () => {
    renderWithAuth(<GstReportPage />, { permissions: ["purchase-invoice.view"] });
    expect(await screen.findByText(/will not match GSTR-2B/i)).toBeInTheDocument();
    expect(screen.getByText("LOCAL HARDWARE")).toBeInTheDocument();
  });

  it("opens a supplier to its bills, and back to every supplier", async () => {
    const user = userEvent.setup();
    renderWithAuth(<GstReportPage />, { permissions: ["purchase-invoice.view"] });
    await user.click(await screen.findByText("SHAH ENTERPRISE"));

    const bills = screen.getByRole("table", { name: "Bill-wise GST" });
    expect(within(bills).getByText("B-1")).toBeInTheDocument();
    expect(within(bills).queryByText("MS-9")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Show every supplier"));
    expect(within(screen.getByRole("table", { name: "Bill-wise GST" })).getByText("MS-9")).toBeInTheDocument();
  });

  /** The GST in the payments made on the dates (client, 26 Oct 2026). */
  it("shows each payment with the bills it paid and the GST in it", async () => {
    const user = userEvent.setup();
    renderWithAuth(<GstReportPage />, { permissions: ["purchase-invoice.view"] });
    await user.click(await screen.findByRole("tab", { name: "Paid-wise" }));
    const table = screen.getByRole("table", { name: "Paid-wise GST" });
    const row = within(table).getByText("SHAH ENTERPRISE").closest("tr")!;
    expect(row).toHaveTextContent("03 Oct 2026");
    expect(row).toHaveTextContent("B-1 · advance 100.00");
    expect(row).toHaveTextContent("1,280.00");
    expect(within(table).getByText(/Total \(1 payments/).closest("tr")).toHaveTextContent("180.00");
  });

  it("exports one Excel with the summary, the four views and the GSTINs to fix", async () => {
    const user = userEvent.setup();
    renderWithAuth(<GstReportPage />, { permissions: ["purchase-invoice.view"] });
    await screen.findByRole("table", { name: "Supplier-wise GST" });
    await user.click(screen.getByRole("button", { name: /export to excel/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());

    const call = vi.mocked(globalThis.fetch).mock.calls.find(([input]) => String(input).includes("/grid-exports/workbook"))!;
    const body = JSON.parse(String((call[1] as RequestInit).body)) as { sheets: { sheetName: string; rows: string[][] }[] };
    expect(body.sheets.map((sheet) => sheet.sheetName)).toEqual(["Summary", "Supplier-wise", "Bill-wise", "Rate-wise", "Paid-wise", "GSTIN to fix"]);
    expect(body.sheets[4]!.rows[0]).toEqual(expect.arrayContaining(["03-10-2026", "SHAH ENTERPRISE", "B-1", "1280.00", "100.00", "180.00"]));
    const billSheet = body.sheets[2]!;
    expect(billSheet.rows[1]).toEqual(expect.arrayContaining(["10-09-2026", "MS-9", "27AAACM9999B1Z2", "360.00"]));
  });
});
