import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentImportDialog } from "./PaymentImportDialog";
import { json, renderWithAuth } from "../../test/render";

/** Many payments from one spreadsheet (client, 23 Oct 2026). */
const file = () => new File(["x"], "october.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const PREVIEW = {
  rowCount: 2,
  paymentCount: 2,
  total: "3500.00",
  payments: [
    { row: 2, date: "2026-10-05", party: "SHAH ENTERPRISE", company: "DH PATEL", site: "Akwada", amount: "1000", method: "NEFT", referenceNo: "UTR1" },
    { row: 3, date: "2026-10-12", party: "AL BURHAN", company: "DH PATEL INFRA", site: "Surat", amount: "2500", method: null, referenceNo: null },
  ],
  errors: [],
};
const urls = () => vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));

describe("PaymentImportDialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/payments/import/preview")) return Promise.resolve(json(PREVIEW));
        if (url.includes("/payments/import")) return Promise.resolve(json({ created: 2, total: "3500.00" }));
        return Promise.resolve(json({}));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("checks the file, shows every payment, and imports only once the count and total are ticked", async () => {
    const user = userEvent.setup();
    renderWithAuth(<PaymentImportDialog open direction="out" onClose={() => {}} />, { permissions: ["reports-payments.add"] });

    await user.upload(screen.getByLabelText("Spreadsheet"), file());
    await user.click(screen.getByRole("button", { name: /check file/i }));
    expect(await screen.findByText("AL BURHAN")).toBeInTheDocument();
    expect(urls().some((url) => url.includes("/payments/import/preview?direction=out"))).toBe(true);

    const importButton = screen.getByRole("button", { name: /import 2 payments/i });
    expect(importButton).toBeDisabled();
    await user.click(screen.getByLabelText(/I have checked these figures: 2 payments totalling 3,500.00/));
    await user.click(importButton);

    expect(await screen.findByText(/Imported 2 payments totalling 3,500.00/)).toBeInTheDocument();
    await waitFor(() => expect(urls().some((url) => url.includes("/payments/import?direction=out&count=2&total=3500.00"))).toBe(true));
  });
});
