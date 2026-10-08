import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayoutListFormDialog } from "./PayoutListFormDialog";
import { json, renderWithAuth } from "../../test/render";

/**
 * THE BILLS UNDER A PARTY (client request, 6 Oct 2026): a party row opens to the
 * bills still to be paid; the owner ticks the party for all of them, or ticks
 * single bills, and the party's amount is the sum of what is ticked.
 */

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const bill = (documentId: string, displayNo: string, pending: string, date: string) => ({
  source: "invoice" as const,
  documentId,
  displayNo,
  documentDate: date,
  siteName: "SURAT",
  amount: pending,
  pending,
});

const OWED = {
  rows: [
    {
      partyId: P1,
      partyName: "Ambica Steel Traders",
      outstanding: "100000.00",
      invoices: [bill("d1", "BE-1", "60000.00", "2026-08-01"), bill("d2", "BE-2", "40000.00", "2026-09-01")],
    },
  ],
  total: "100000.00",
};

const sent = () => {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
  return call ? (JSON.parse(String((call[1] as RequestInit).body)) as { lines: unknown[] }) : null;
};

describe("PayoutListFormDialog - bills", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(json(/outstanding$/.test(String(input)) ? OWED : { id: "x", listDate: "2026-10-06", title: null, budget: null, total: "0.00", partyCount: 0, status: "draft", confirmedAt: null, confirmedByName: null, createdByName: null, createdAt: "2026-10-06T00:00:00.000Z", updatedAt: null, updatedByName: null, note: null, lines: [] })),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const open = () =>
    renderWithAuth(<PayoutListFormDialog open listId={null} onClose={() => {}} />, {
      permissions: ["payout.view", "payout.add"],
    });

  it("shows the bills under a party only when it is opened", async () => {
    const user = userEvent.setup();
    open();
    expect(await screen.findByText("2 bills")).toBeInTheDocument();
    expect(screen.queryByText("BE-1")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show the bills of ambica/i }));
    expect(screen.getByText("BE-1")).toBeInTheDocument();
    expect(screen.getByText("BE-2")).toBeInTheDocument();
  });

  it("ticks every bill for the party, in full, and the party's amount is their sum", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));

    expect(screen.getByText("2 of 2 bills")).toBeInTheDocument();
    expect(screen.getByLabelText("Pay bill BE-1 of Ambica Steel Traders")).toBeChecked();
    expect(screen.getByLabelText("Amount for bill BE-2")).toHaveValue("40,000.00");
    expect(screen.getByText("Total").parentElement).toHaveTextContent("1,00,000.00");
  });

  it("lets single bills be ticked, and a bill part-paid", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /show the bills of ambica/i }));
    await user.click(screen.getByLabelText("Pay bill BE-2 of Ambica Steel Traders"));

    expect(screen.getByText("1 of 2 bills")).toBeInTheDocument();
    expect(screen.getByLabelText("Pay Ambica Steel Traders")).toBePartiallyChecked?.();
    const box = screen.getByLabelText("Amount for bill BE-2");
    await user.clear(box);
    await user.type(box, "15000");
    expect(screen.getByText("Total").parentElement).toHaveTextContent("15,000.00");

    await user.click(screen.getByRole("button", { name: /save list/i }));
    await waitFor(() => expect(sent()).not.toBeNull());
    expect(sent()!.lines).toEqual([
      {
        partyId: P1,
        amount: "15000.00",
        invoices: [
          {
            source: "invoice",
            documentId: "d2",
            displayNo: "BE-2",
            documentDate: "2026-09-01",
            siteName: "SURAT",
            amount: "15000",
            pending: "40000.00",
          },
        ],
      },
    ]);
  });

  it("unticks the party and all its bills with one click", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));
    await user.click(screen.getByLabelText("Pay Ambica Steel Traders"));
    expect(screen.getByText("0 parties ticked")).toBeInTheDocument();
    expect(screen.getByText("2 bills")).toBeInTheDocument();
  });
});
