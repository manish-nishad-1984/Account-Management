import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeletedRecordsDialog, HistoryButton } from "./HistoryDialog";
import { json, renderWithAuth } from "../../test/render";

/** The audit trail on screen (client, 20 Oct 2026). */
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const event = (action: string, extra: Record<string, unknown> = {}) => ({
  id: `${action}-1`,
  entity: "purchase-invoice",
  entityId: ID,
  action,
  label: "Bill BB/154 · SHAH ENTERPRISE",
  facts: [["Bill no", "BB/154"], ["Total", "4661.00"]],
  changes: null,
  actorName: "chintan",
  at: "2026-10-20T06:30:00.000Z",
  ...extra,
});

describe("HistoryDialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          json({
            rows: String(input).includes("action=deleted")
              ? [event("deleted")]
              : [
                  event("updated", { changes: [{ field: "Line 1", from: "Cement · 10 Bag", to: "Cement · 12 Bag" }, { field: "Total", from: "4661.00", to: "5593.00" }] }),
                  event("created"),
                ],
          }),
        ),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows who did what and when, and each changed field before and after", async () => {
    const user = userEvent.setup();
    renderWithAuth(<HistoryButton entity="purchase-invoice" entityId={ID} title="Bill BB/154" />, { permissions: ["purchase-invoice.view"] });
    await user.click(screen.getByRole("button", { name: /history/i }));

    expect(await screen.findByText("Changed")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getAllByText("chintan")).toHaveLength(2);
    const row = screen.getByText("Line 1").closest("tr")!;
    expect(within(row).getByText("Cement · 10 Bag")).toBeInTheDocument();
    expect(within(row).getByText("Cement · 12 Bag")).toBeInTheDocument();
    const asked = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));
    expect(asked.some((url) => url.includes("/audit?") && url.includes(`entityId=${ID}`) && url.includes("entity=purchase-invoice"))).toBe(true);
  });

  it("lists deleted invoices as they read when deleted", async () => {
    renderWithAuth(<DeletedRecordsDialog entity="purchase-invoice" open title="Deleted purchase invoices" onClose={() => {}} />, {
      permissions: ["purchase-invoice.view"],
    });
    expect(await screen.findByText("Bill BB/154 · SHAH ENTERPRISE")).toBeInTheDocument();
    expect(screen.getByText("As it was when deleted")).toBeInTheDocument();
    expect(screen.getByText("4661.00")).toBeInTheDocument();
  });
});
