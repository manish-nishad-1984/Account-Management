import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayoutListFormDialog } from "./PayoutListFormDialog";
import { todayInput } from "../../lib/dates";
import { json, renderWithAuth } from "../../test/render";

const LIST_ID = "11111111-1111-4111-8111-111111111111";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const P2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const P3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const P4 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const GONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";

const OWED = {
  rows: [
    { partyId: P1, partyName: "Ambica Steel Traders", outstanding: "125000.00", invoices: [] },
    { partyId: P2, partyName: "Shree Cement", outstanding: "4000000.00", invoices: [] },
    { partyId: P3, partyName: "Dime Traders", outstanding: "0.10", invoices: [] },
    { partyId: P4, partyName: "Fifth Traders", outstanding: "0.20", invoices: [] },
  ],
  total: "4125000.30",
};

const DETAIL = {
  id: LIST_ID,
  listDate: "2026-10-01",
  title: "Weekly payout",
  budget: "300000.00",
  total: "265000.00",
  partyCount: 3,
  createdByName: "Office",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: null,
  updatedByName: null,
  note: "Call before paying",
  lines: [
    { id: "l1", partyId: P1, partyName: "Ambica Steel Traders", amount: "125000.00", outstandingAtSave: "125000.00", outstandingNow: "125000.00", invoices: [] },
    // Saved at 80,000 against 4,000,000 owed; since then the owed figure stands at 30,000 (paid since).
    { id: "l2", partyId: P2, partyName: "Shree Cement", amount: "80000.00", outstandingAtSave: "4000000.00", outstandingNow: "30000.00", invoices: [] },
    // Paid in full since: no longer in the owed list at all.
    { id: "l3", partyId: GONE, partyName: "Settled Supplies", amount: "60000.00", outstandingAtSave: "60000.00", outstandingNow: "0", invoices: [] },
  ],
};

let failure: Response | null;

function serve() {
  vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    if (method !== "GET" && failure) return Promise.resolve(failure.clone());
    if (/\/payout-lists\/outstanding$/.test(url.pathname)) return Promise.resolve(json(OWED));
    return Promise.resolve(json(DETAIL));
  });
}

const sent = (method: "POST" | "PATCH") => {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === method);
  return call ? (JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>) : null;
};

const openNew = () =>
  renderWithAuth(<PayoutListFormDialog open listId={null} onClose={() => {}} />, {
    permissions: ["payout.view", "payout.add"],
  });
const openEdit = (readOnly = false) =>
  renderWithAuth(<PayoutListFormDialog open listId={LIST_ID} readOnly={readOnly} onClose={() => {}} />, {
    permissions: ["payout.view", "payout.edit"],
  });

const amountBox = (party: string) => screen.getByLabelText(`Amount for ${party}`) as HTMLInputElement;
const total = () => screen.getByText("Total").parentElement!;
const save = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /save list/i }));

describe("PayoutListFormDialog", () => {
  beforeEach(() => {
    failure = null;
    vi.stubGlobal("fetch", vi.fn());
    serve();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("defaults the date to today and lists the parties we owe", async () => {
    openNew();
    expect(await screen.findByLabelText("Pay Ambica Steel Traders")).not.toBeChecked();
    expect(screen.getByLabelText(/list date/i)).toHaveValue(todayInput());
    expect(screen.getByText("1,25,000.00")).toBeInTheDocument();
    expect(screen.getByText("0 parties ticked")).toBeInTheDocument();
  });

  it("prefills the amount with the outstanding when a party is ticked, and unticking removes it", async () => {
    const user = userEvent.setup();
    openNew();

    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));
    expect(amountBox("Ambica Steel Traders")).toHaveValue("125000.00");
    expect(screen.getByText("1 party ticked")).toBeInTheDocument();
    expect(total()).toHaveTextContent("1,25,000.00");

    await user.click(screen.getByLabelText("Pay Ambica Steel Traders"));
    expect(screen.queryByLabelText("Amount for Ambica Steel Traders")).not.toBeInTheDocument();
    expect(total()).toHaveTextContent("0.00");
  });

  it("accepts a part payment and sends the contract body", async () => {
    const user = userEvent.setup();
    openNew();

    await user.type(screen.getByLabelText(/^title/i), "Friday payout");
    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));
    await user.clear(amountBox("Ambica Steel Traders"));
    await user.type(amountBox("Ambica Steel Traders"), "50,000");
    await save(user);

    await waitFor(() => expect(sent("POST")).not.toBeNull());
    expect(sent("POST")).toEqual({
      listDate: todayInput(),
      title: "Friday payout",
      budget: null,
      note: null,
      lines: [{ partyId: P1, amount: "50000", invoices: [] }],
    });
  });

  it("refuses a zero or blank amount on a ticked party and sends nothing", async () => {
    const user = userEvent.setup();
    openNew();

    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));
    await user.clear(amountBox("Ambica Steel Traders"));
    await user.type(amountBox("Ambica Steel Traders"), "0");
    await save(user);

    expect(await screen.findByText("The amount must be more than zero")).toBeInTheDocument();
    expect(screen.getByText(/1 ticked party needs a correction/)).toBeInTheDocument();

    await user.clear(amountBox("Ambica Steel Traders"));
    await save(user);
    expect(await screen.findByText("Amount is required")).toBeInTheDocument();
    expect(sent("POST")).toBeNull();
  });

  it("asks for at least one party", async () => {
    const user = userEvent.setup();
    openNew();
    await screen.findByLabelText("Pay Ambica Steel Traders");
    await save(user);

    expect(await screen.findByText("Add at least one party")).toBeInTheDocument();
    expect(sent("POST")).toBeNull();
  });

  it("warns, but does not block, when the amount is more than is owed", async () => {
    const user = userEvent.setup();
    openNew();

    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));
    await user.clear(amountBox("Ambica Steel Traders"));
    await user.type(amountBox("Ambica Steel Traders"), "200000");
    expect(screen.getByText("More than the 1,25,000.00 owed.")).toBeInTheDocument();

    await save(user);
    await waitFor(() => expect(sent("POST")).not.toBeNull());
    expect(sent("POST")).toMatchObject({ lines: [{ partyId: P1, amount: "200000" }] });
  });

  it("clears the warning once the amount is brought back to what is owed", async () => {
    const user = userEvent.setup();
    openNew();

    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));
    await user.clear(amountBox("Ambica Steel Traders"));
    await user.type(amountBox("Ambica Steel Traders"), "1250000");
    expect(screen.getByText(/More than the/)).toBeInTheDocument();
    await user.type(amountBox("Ambica Steel Traders"), "{Backspace}");
    expect(screen.queryByText(/More than the/)).not.toBeInTheDocument();
  });

  it("shows what is left of the budget, and by how much it is exceeded", async () => {
    const user = userEvent.setup();
    openNew();

    await user.type(screen.getByLabelText(/^budget/i), "500000");
    expect(screen.getByText("5,00,000.00 left of the budget")).toBeInTheDocument();

    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));
    expect(screen.getByText("3,75,000.00 left of the budget")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Pay Shree Cement"));
    expect(screen.getByText("Over the budget by 36,25,000.00")).toBeInTheDocument();

    // A warning, not a block.
    await save(user);
    await waitFor(() => expect(sent("POST")).not.toBeNull());
    expect(sent("POST")).toMatchObject({ budget: "500000" });
  });

  /** 0.1 + 0.2 is 0.30000000000000004 as a double. */
  it("adds the running total as exact decimals, not floats", async () => {
    const user = userEvent.setup();
    openNew();

    await user.click(await screen.findByLabelText("Pay Dime Traders"));
    await user.click(screen.getByLabelText("Pay Fifth Traders"));
    expect(total()).toHaveTextContent("0.30");
    expect(total()).not.toHaveTextContent("0.30000");

    await user.click(screen.getByLabelText("Pay Shree Cement"));
    expect(total()).toHaveTextContent("40,00,000.30");
    expect(screen.getByText("3 parties ticked")).toBeInTheDocument();
  });

  it("keeps a ticked party in the total while the search hides it", async () => {
    const user = userEvent.setup();
    openNew();

    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));
    await user.type(screen.getByLabelText("Search parties"), "shree");

    expect(screen.queryByLabelText("Pay Ambica Steel Traders")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pay Shree Cement")).toBeInTheDocument();
    expect(screen.getByText("1 party ticked")).toBeInTheDocument();
    expect(total()).toHaveTextContent("1,25,000.00");
  });

  it("shows an error on a line even if the search had hidden it", async () => {
    const user = userEvent.setup();
    openNew();

    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));
    await user.clear(amountBox("Ambica Steel Traders"));
    await user.type(amountBox("Ambica Steel Traders"), "0");
    await user.type(screen.getByLabelText("Search parties"), "shree");
    await save(user);

    expect(await screen.findByText("The amount must be more than zero")).toBeInTheDocument();
    expect(screen.getByLabelText("Search parties")).toHaveValue("");
  });

  it("puts a server refusal of a line on that party's row", async () => {
    failure = json({ message: "Validation failed", issues: [{ path: "lines.0.amount", message: "Amount is not valid" }] }, 400);
    const user = userEvent.setup();
    openNew();

    await user.click(await screen.findByLabelText("Pay Ambica Steel Traders"));
    await save(user);

    const row = (await screen.findByText("Amount is not valid")).closest("tr")!;
    expect(within(row).getByText("Ambica Steel Traders")).toBeInTheDocument();
  });

  describe("editing a saved list", () => {
    it("ticks the saved lines with their saved amounts and the saved header", async () => {
      openEdit();

      await waitFor(() => expect(amountBox("Ambica Steel Traders")).toHaveValue("125000.00"));
      expect(amountBox("Shree Cement")).toHaveValue("80000.00");
      expect(screen.getByLabelText("Pay Dime Traders")).not.toBeChecked();
      expect(screen.getByLabelText(/list date/i)).toHaveValue("2026-10-01");
      expect(screen.getByLabelText(/^title/i)).toHaveValue("Weekly payout");
      expect(screen.getByLabelText(/^budget/i)).toHaveValue("300000.00");
      expect(screen.getByLabelText(/^note/i)).toHaveValue("Call before paying");
      expect(screen.getByText("3 parties ticked")).toBeInTheDocument();
      expect(total()).toHaveTextContent("2,65,000.00");
    });

    /**
     * The owed list says 40,00,000.00 for Shree Cement while the detail's
     * `outstandingNow` says 30,000: here the line is under what is owed, so only
     * a line ABOVE it is flagged, and it is flagged from the live owed figure.
     */
    it("flags a saved line that is now more than the party owes", async () => {
      const user = userEvent.setup();
      openEdit();
      await waitFor(() => expect(amountBox("Ambica Steel Traders")).toHaveValue("125000.00"));

      const shree = screen.getByText("Shree Cement").closest("tr")!;
      expect(within(shree).queryByText(/paid since/)).not.toBeInTheDocument();

      await user.clear(amountBox("Shree Cement"));
      await user.type(amountBox("Shree Cement"), "5000000");
      expect(within(shree).getByText("This party has been paid since - only 40,00,000.00 is owed now.")).toBeInTheDocument();
    });

    it("still shows a saved party that no longer appears in the owed list, and flags it", async () => {
      openEdit();

      const settled = (await screen.findByText("Settled Supplies")).closest("tr")!;
      expect(within(settled).getByLabelText("Pay Settled Supplies")).toBeChecked();
      expect(within(settled).getByText(/no longer owes anything/)).toBeInTheDocument();
      expect(within(settled).getByLabelText("Amount for Settled Supplies")).toHaveValue("60000.00");
    });

    it("saves every line it opened with when nothing is changed - none is dropped", async () => {
      const user = userEvent.setup();
      openEdit();
      await waitFor(() => expect(amountBox("Ambica Steel Traders")).toHaveValue("125000.00"));

      await save(user);

      await waitFor(() => expect(sent("PATCH")).not.toBeNull());
      expect(sent("PATCH")).toEqual({
        listDate: "2026-10-01",
        title: "Weekly payout",
        budget: "300000.00",
        note: "Call before paying",
        lines: [
          { partyId: P1, amount: "125000.00", invoices: [] },
          { partyId: P2, amount: "80000.00", invoices: [] },
          { partyId: GONE, amount: "60000.00", invoices: [] },
        ],
      });
      const patch = vi
        .mocked(globalThis.fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")!;
      expect(String(patch[0])).toMatch(new RegExp(`/payout-lists/${LIST_ID}$`));
    });

    it("sends the saved list on WhatsApp from inside the form, with no number", async () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const user = userEvent.setup();
      openEdit();
      await waitFor(() => expect(amountBox("Ambica Steel Traders")).toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: "WhatsApp" }));

      await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
      const [url, target, features] = open.mock.calls[0]!;
      expect(String(url).startsWith("https://wa.me/?text=")).toBe(true);
      expect(decodeURIComponent(String(url).slice("https://wa.me/?text=".length))).toBe(
        [
          "Payout list - 01 Oct 2026",
          "Weekly payout",
          "1. Ambica Steel Traders - Rs 1,25,000.00",
          "2. Shree Cement - Rs 80,000.00",
          "3. Settled Supplies - Rs 60,000.00",
          "Total: Rs 2,65,000.00",
        ].join("\n"),
      );
      expect(target).toBe("_blank");
      expect(features).toBe("noopener");
    });

    it("opens read-only for someone who may not edit: disabled fields, no Save, still sendable", async () => {
      openEdit(true);

      await waitFor(() => expect(screen.getByLabelText("Pay Ambica Steel Traders")).toBeChecked());
      expect(screen.getByLabelText("Pay Ambica Steel Traders")).toBeDisabled();
      expect(screen.getByLabelText(/^title/i)).toBeDisabled();
      expect(screen.queryByRole("button", { name: /save list/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "WhatsApp" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
    });
  });
});
