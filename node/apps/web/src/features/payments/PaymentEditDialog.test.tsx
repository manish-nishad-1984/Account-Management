import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentEditDialog } from "./PaymentEditDialog";
import { json, renderWithAuth } from "../../test/render";

/**
 * EDITING A PAYMENT (client, 19 Oct 2026: "can't edit any payment records").
 * The Edit icon had no form behind it.
 */
const ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const SITE = "11111111-1111-4111-8111-111111111111";
const DETAIL = {
  id: ID,
  direction: "out",
  kind: "payment",
  partyId: "p1",
  companyId: "c1",
  siteId: SITE,
  siteLocationId: null,
  paymentDate: "2026-10-05",
  amount: "128700.00",
  description: "PayOut",
  method: "NEFT",
  referenceNo: "UTR123",
  createdAt: "2026-10-05T00:00:00.000Z",
};
const ROW = { id: ID, kind: "payment" as const, direction: "out" as const, partyName: "GIRIRAJ ENTERPRISE", companyName: "DH PATEL", siteId: SITE, siteName: "SURAT-AURO UNIVERSITY" };

const patched = () => {
  const call = vi.mocked(globalThis.fetch).mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
  return call ? { url: String(call[0]), body: JSON.parse(String((call[1] as RequestInit).body)) } : null;
};

describe("PaymentEditDialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(json(init?.method === "PATCH" ? { ...DETAIL, amount: "128000.00" } : DETAIL)),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const open = (onClose = vi.fn()) =>
    renderWithAuth(<PaymentEditDialog row={ROW} onClose={onClose} />, {
      permissions: ["reports-payments.view", "reports-payments.edit"],
      scope: { siteId: SITE, siteName: "SURAT-AURO UNIVERSITY", sites: [{ id: SITE, name: "SURAT-AURO UNIVERSITY" }], canSelectAll: true },
    });

  it("loads the payment, and saves the changed amount and date to it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    open(onClose);

    const amount = await screen.findByLabelText(/^amount/i);
    await waitFor(() => expect(amount).toHaveValue("128700.00"));
    expect(screen.getByText("GIRIRAJ ENTERPRISE · DH PATEL")).toBeInTheDocument();
    expect(screen.getByLabelText("Method")).toHaveValue("NEFT");

    await user.clear(amount);
    await user.type(amount, "1,28,000");
    await user.clear(screen.getByLabelText("Date"));
    await user.type(screen.getByLabelText("Date"), "2026-10-06");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(patched()).not.toBeNull());
    expect(patched()!.url).toContain(`/payments/${ID}`);
    expect(patched()!.body).toMatchObject({ amount: "128000", paymentDate: "2026-10-06", siteId: SITE, method: "NEFT", referenceNo: "UTR123" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("refuses an amount that is not a positive figure, and sends nothing", async () => {
    const user = userEvent.setup();
    open();
    const amount = await screen.findByLabelText(/^amount/i);
    await waitFor(() => expect(amount).toHaveValue("128700.00"));

    await user.clear(amount);
    await user.type(amount, "-5");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Amount must be more than zero")).toBeInTheDocument();
    expect(patched()).toBeNull();
  });
});
