import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayoutExportLine, PayoutListRow } from "@accountmanagement/contracts";
import { PayoutExportButton, toDetailRows, WITH_DETAILS_COLUMNS } from "./PayoutExportButton";
import { EXPORT_COLUMNS } from "./PayoutListsPage";
import { json, renderWithAuth } from "../../test/render";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../lib/download", () => ({ saveBlob: save }));

/** Payout lists in Excel with every party and bill (client, 22 Oct 2026). */
const list = (over: Partial<PayoutListRow>): PayoutListRow => ({
  id: "l1", status: "confirmed", confirmedAt: "2026-10-06T00:00:00.000Z", listDate: "2026-10-05", title: "Weekly payout", budget: null,
  companyId: null, companyName: "DH PATEL", total: "1500.00", partyCount: 2, createdByName: "Manish", createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: null, updatedByName: null, capabilities: { canEdit: true, canDelete: true }, ...over,
} as PayoutListRow);
const bill = (displayNo: string, amount: string) => ({
  source: "invoice" as const, documentId: displayNo, displayNo, documentDate: "2026-09-01", siteName: "Akwada", amount, paidAmount: amount, pendingAtSave: amount,
});
const LINES: PayoutExportLine[] = [
  { payoutListId: "l1", partyId: "p1", partyName: "AL BURHAN PIPES", amount: "1000.00", extraPaid: null, invoices: [bill("A-1", "600.00"), bill("A-2", "400.00")] },
  { payoutListId: "l1", partyId: "p2", partyName: "SHAH ENTERPRISE", amount: "500.00", extraPaid: null, invoices: [] },
];
const LISTS = [list({}), list({ id: "l2", title: "Empty", total: "0.00", partyCount: 0 })];

const cells = (rows: ReturnType<typeof toDetailRows>) => rows.map((row) => WITH_DETAILS_COLUMNS.map((column) => String(column.value(row) ?? "")));
const col = (header: string) => WITH_DETAILS_COLUMNS.findIndex((column) => column.header === header);

describe("payout lists, with details", () => {
  it("writes one row per bill, a party with no bill and a list with no party once each, and each total once", () => {
    const rows = cells(toDetailRows(LISTS, LINES));
    expect(rows.map((row) => [row[col("Title")], row[col("Party")], row[col("Bill no.")]])).toEqual([
      ["Weekly payout", "AL BURHAN PIPES", "A-1"],
      ["Weekly payout", "AL BURHAN PIPES", "A-2"],
      ["Weekly payout", "SHAH ENTERPRISE", ""],
      ["Empty", "", ""],
    ]);
    expect(rows.map((row) => row[col("Party amount")])).toEqual(["1000.00", "", "500.00", ""]);
    expect(rows.map((row) => row[col("List total")])).toEqual(["1500.00", "", "", "0.00"]);
  });

  describe("the button", () => {
    beforeEach(() => {
      save.mockClear();
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/grid-exports/xlsx")) return Promise.resolve(new Response(new Blob(["x"])));
          if (url.includes("/payout-lists/lines")) return Promise.resolve(json({ lines: LINES, salaries: [] }));
          return Promise.resolve(json({ rows: LISTS, nextCursor: null, total: 2 }));
        }),
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    it("exports every party and bill of the lists in view", async () => {
      const user = userEvent.setup();
      renderWithAuth(<PayoutExportButton params={{}} filters={{ companyId: "c1" }} listColumns={EXPORT_COLUMNS} />, { permissions: ["payout.view"] });
      await user.click(screen.getByRole("button", { name: /export to excel/i }));
      await user.click(screen.getByRole("menuitem", { name: /with details/i }));
      await waitFor(() => expect(save).toHaveBeenCalled());

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const asked = calls.find(([input]) => String(input).includes("/payout-lists/lines"))!;
      expect(JSON.parse(String((asked[1] as RequestInit).body))).toEqual({ ids: ["l1", "l2"] });
      expect(calls.some(([input]) => String(input).includes("companyId=c1"))).toBe(true);
      const sheet = calls.find(([input]) => String(input).includes("/grid-exports/xlsx"))!;
      const body = JSON.parse(String((sheet[1] as RequestInit).body)) as { sheetName: string; rows: string[][] };
      expect(body.sheetName).toBe("Payout list details");
      expect(body.rows).toHaveLength(4);
      expect(String(save.mock.calls[0]![1])).toMatch(/^Payout-lists-with-details-/);
    });

    it("still exports the lists alone, one row each", async () => {
      const user = userEvent.setup();
      renderWithAuth(<PayoutExportButton params={{}} filters={{}} listColumns={EXPORT_COLUMNS} />, { permissions: ["payout.view"] });
      await user.click(screen.getByRole("button", { name: /export to excel/i }));
      await user.click(screen.getByRole("menuitem", { name: /lists only/i }));
      await waitFor(() => expect(save).toHaveBeenCalled());
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([input]) => String(input).includes("/payout-lists/lines"))).toBe(false);
    });
  });
});
