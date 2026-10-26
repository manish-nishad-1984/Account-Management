import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IncomeImportDialog } from "./IncomeImportDialog";
import { json, renderWithAuth } from "../../test/render";

/** Many income entries from one spreadsheet, from the balance sheet (client, 26 Oct 2026). */
const file = () => new File(["x"], "october.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const PREVIEW = {
  rowCount: 2,
  incomeCount: 2,
  total: "3500.00",
  incomes: [
    { row: 2, date: "2026-10-05", client: "ULTRATECH", company: "DH PATEL", site: "Akwada", amount: "1000", total: "1000.00", method: "NEFT", referenceNo: "UTR1" },
    { row: 3, date: "2026-10-12", client: "JHM HOTELS", company: "DH PATEL INFRA", site: "Surat", amount: "2500", total: "2500.00", method: null, referenceNo: null },
  ],
  errors: [],
};
const urls = () => vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));

describe("IncomeImportDialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/client-incomes/import/preview")) return Promise.resolve(json(PREVIEW));
        if (url.includes("/client-incomes/import")) return Promise.resolve(json({ created: 2, total: "3500.00" }));
        return Promise.resolve(json({}));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("checks the file, shows every entry, and imports only once the count and total are ticked", async () => {
    const user = userEvent.setup();
    renderWithAuth(<IncomeImportDialog open onClose={() => {}} />, { permissions: ["income.add"] });

    await user.upload(screen.getByLabelText("Spreadsheet"), file());
    await user.click(screen.getByRole("button", { name: /check file/i }));
    expect(await screen.findByText("JHM HOTELS")).toBeInTheDocument();
    expect(urls().some((url) => url.includes("/client-incomes/import/preview"))).toBe(true);

    const importButton = screen.getByRole("button", { name: /import 2 entries/i });
    expect(importButton).toBeDisabled();
    await user.click(screen.getByLabelText(/I have checked these figures: 2 entries totalling 3,500.00/));
    await user.click(importButton);

    expect(await screen.findByText(/Imported 2 income entries totalling 3,500.00/)).toBeInTheDocument();
    await waitFor(() => expect(urls().some((url) => url.includes("/client-incomes/import?count=2&total=3500.00"))).toBe(true));
  });
});
