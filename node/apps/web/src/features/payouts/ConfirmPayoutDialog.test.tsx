import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayoutListDetail } from "@accountmanagement/contracts";
import { ConfirmPayoutDialog } from "./ConfirmPayoutDialog";
import { json, renderWithAuth } from "../../test/render";

const LIST_ID = "11111111-1111-4111-8111-111111111111";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const P2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const B1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const B2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const bill = (documentId: string, displayNo: string, amount: string) => ({
  source: "invoice" as const,
  documentId,
  displayNo,
  documentDate: "2026-09-01",
  siteName: "Akwada",
  amount,
  paidAmount: null,
  pendingAtSave: amount,
});

const LIST: PayoutListDetail = {
  id: LIST_ID,
  status: "draft",
  confirmedAt: null,
  confirmedByName: null,
  listDate: "2026-10-07",
  title: "Week 41",
  budget: null,
  total: "175000.00",
  partyCount: 2,
  createdByName: "Office",
  createdAt: "2026-10-07T10:00:00.000Z",
  updatedAt: null,
  updatedByName: null,
  note: null,
  lines: [
    {
      id: "l1",
      partyId: P1,
      partyName: "Ambica Steel Traders",
      amount: "125000.00",
      outstandingAtSave: "125000.00",
      outstandingNow: "125000.00",
      extraPaid: null,
      invoices: [bill(B1, "A-101", "75000.00"), bill(B2, "A-102", "50000.00")],
    },
    {
      id: "l2",
      partyId: P2,
      partyName: "Shree Cement",
      amount: "50000.00",
      outstandingAtSave: "50000.00",
      outstandingNow: "50000.00",
      extraPaid: null,
      invoices: [bill("cccccccc-cccc-4ccc-8ccc-ccccccccccc1", "S-9", "50000.00")],
    },
  ],
};

let reply: Response;

const posted = () => {
  const call = vi.mocked(globalThis.fetch).mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
  return call
    ? { url: String(call[0]), body: JSON.parse(String((call[1] as RequestInit).body)) as Record<string, any> }
    : null;
};

const open = (list: PayoutListDetail = LIST, onClose = () => {}) =>
  renderWithAuth(<ConfirmPayoutDialog open list={list} onClose={onClose} />, {
    permissions: ["payout.view", "payout.approve"],
  });

describe("ConfirmPayoutDialog", () => {
  beforeEach(() => {
    reply = json({ ...LIST, status: "confirmed" });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(reply.clone())));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fills every bill with what was planned, and confirms exactly that", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    open(LIST, onClose);

    expect(screen.getByLabelText("Paid for bill A-101")).toHaveValue("75,000.00");
    expect(screen.getByLabelText("Paid for bill A-102")).toHaveValue("50,000.00");
    expect(screen.getByText("Same as planned")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/cheque \/ reference/i), "UTR998");
    await user.click(screen.getByRole("button", { name: /^confirm payout$/i }));

    await waitFor(() => expect(posted()).not.toBeNull());
    expect(posted()!.url).toContain(`/payout-lists/${LIST_ID}/confirm`);
    expect(posted()!.body).toMatchObject({
      method: "NEFT",
      referenceNo: "UTR998",
      lines: [
        { partyId: P1, bills: [{ source: "invoice", documentId: B1, paid: "75000.00" }, { source: "invoice", documentId: B2, paid: "50000.00" }], extra: null },
        { partyId: P2 },
      ],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("takes a smaller amount for a bill, and says how far it is from the plan", async () => {
    const user = userEvent.setup();
    open();

    const box = screen.getByLabelText("Paid for bill A-102");
    await user.clear(box);
    await user.type(box, "40000");

    expect(screen.getByText(/10,000\.00 less than planned/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^confirm payout$/i }));
    await waitFor(() => expect(posted()).not.toBeNull());
    expect(posted()!.body.lines[0].bills[1].paid).toBe("40000");
  });

  it("sends an amount paid above the bills as the party's extra", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText("Extra paid to Shree Cement"), "2500");

    expect(screen.getByText(/2,500\.00 more than planned/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^confirm payout$/i }));
    await waitFor(() => expect(posted()).not.toBeNull());
    expect(posted()!.body.lines[1].extra).toBe("2500");
  });

  it("will not confirm while a party has no bills ticked, and says what to do", () => {
    open({ ...LIST, lines: [...LIST.lines, { ...LIST.lines[1]!, id: "l3", partyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", partyName: "Dime Traders", invoices: [] }] });

    expect(screen.getByText(/dime traders has no bills ticked/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^confirm payout$/i })).toBeDisabled();
  });

  it("puts the server's reason on the bill it is about, and stays open", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    reply = json(
      { message: "Only 1000.00 is pending on A-101", issues: [{ path: "lines.0.bills.0.paid", message: "Only 1000.00 is pending on A-101" }] },
      400,
    );
    open(LIST, onClose);

    await user.click(screen.getByRole("button", { name: /^confirm payout$/i }));

    expect((await screen.findAllByText("Only 1000.00 is pending on A-101")).length).toBeGreaterThan(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});
