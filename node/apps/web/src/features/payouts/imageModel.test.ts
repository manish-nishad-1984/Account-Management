import { describe, expect, it } from "vitest";
import { buildImageRows } from "./imageModel";
import { buildPayoutMessage } from "./message";

const bill = (displayNo: string, amount: string) => ({
  source: "invoice" as const,
  documentId: displayNo,
  displayNo,
  documentDate: "2026-09-12",
  siteName: "SURAT",
  amount,
  pendingAtSave: amount,
});
const line = (partyName: string, amount: string, invoices = [] as ReturnType<typeof bill>[]) => ({
  id: partyName,
  partyId: partyName,
  partyName,
  amount,
  outstandingAtSave: amount,
  outstandingNow: amount,
  invoices,
});
const list = {
  listDate: "2026-10-05",
  title: "Friday payout",
  lines: [line("AL BURHAN", "75000.00", [bill("BE-1", "50000.00"), bill("BE-2", "25000.00")]), line("SHAH", "700.00")],
};

describe("the payout list picture", () => {
  it("says the party and its amount, the bills under it, and the total last", () => {
    const rows = buildImageRows(list);
    expect(rows.map((row) => row.kind)).toEqual(["title", "subtitle", "party", "bill", "bill", "party", "total"]);
    expect(rows[2]).toMatchObject({ left: "AL BURHAN", right: "Rs 75,000.00" });
    expect(rows[3]).toMatchObject({ left: "BE-1  ·  12 Sep 2026 · SURAT", right: "Rs 50,000.00" });
    expect(rows[rows.length - 1]).toMatchObject({ kind: "total", left: "Total (2 parties)", right: "Rs 75,700.00" });
  });

  it("is the same list the text message carries, bills included", () => {
    const text = buildPayoutMessage(list).split("\n");
    expect(text).toEqual([
      "Payout list - 05 Oct 2026",
      "Friday payout",
      "1. AL BURHAN - Rs 75,000.00",
      "    BE-1 (12 Sep 2026) - Rs 50,000.00",
      "    BE-2 (12 Sep 2026) - Rs 25,000.00",
      "2. SHAH - Rs 700.00",
      "Total: Rs 75,700.00",
    ]);
  });
});
