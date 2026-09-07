import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InwardChallanFormDialog } from "./InwardChallanFormDialog";
import { json, renderWithAuth, routeFetch } from "../../test/render";

const SITE = "22222222-2222-2222-2222-222222222222";
const ITEM = "33333333-3333-3333-3333-333333333333";
const CREATED = "11111111-1111-1111-1111-111111111111";

const UNITS = {
  rows: [
    {
      id: 1,
      name: "Nos",
      itemCount: 1,
      capabilities: { canEdit: true, canDelete: false, canApprove: false },
    },
  ],
  nextCursor: null,
  total: 1,
};
const ITEMS = {
  rows: [
    {
      id: ITEM,
      name: "FLY ASH BRICKS",
      unitId: 1,
      unitName: "Nos",
      pricePerUnit: "8.00",
      isWithGst: false,
      gstPercent: null,
      gstAmount: null,
      hsnCode: null,
      isApproved: true,
      capabilities: { canEdit: true, canDelete: true, canApprove: false },
    },
  ],
  nextCursor: null,
  total: 1,
};
const SUPPLIERS = { rows: [], nextCursor: null, total: 0 };

const detail = (documents: unknown[] = []) => ({
  id: CREATED,
  siteId: SITE,
  itemId: ITEM,
  supplierId: null,
  unitId: 1,
  quantity: "4000.00",
  invoiceNo: null,
  documentDate: null,
  vehicleNumber: null,
  receiverName: null,
  isApproved: false,
  createdAt: "2026-09-07T10:00:00.000Z",
  documents,
});

const file = (name: string) => new File([new Uint8Array(1024)], name, { type: "application/pdf" });

const callsTo = (fragment: string, method = "POST") =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.filter((c) => String(c[0]).includes(fragment) && c[1]?.method === method);

/**
 * Fills the three required fields and submits.
 *
 * Waits for the OPTIONS, not for the selects. Both selects render immediately
 * with a placeholder and fill in when their query resolves, so selecting too
 * early fails with "value not found in options" — which reads like a broken
 * fixture and is really a race.
 */
async function fillAndSave() {
  await screen.findByRole("option", { name: "FLY ASH BRICKS" });
  await screen.findByRole("option", { name: "Nos" });

  await userEvent.selectOptions(screen.getByLabelText(/Item/), ITEM);
  await userEvent.type(screen.getByLabelText(/Quantity/), "4000");
  await userEvent.selectOptions(screen.getByLabelText(/Unit/), "1");
  await userEvent.click(screen.getByRole("button", { name: "Record challan" }));
}

describe("InwardChallanFormDialog — attachments on a new challan", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const routes = (challanResponse: unknown = json(detail())) =>
    routeFetch([
      [/\/inward-challans\/.+\/documents$/, json(detail([]))],
      [/\/inward-challans$/, challanResponse],
      [/\/units$/, UNITS],
      [/\/items$/, ITEMS],
      [/\/suppliers$/, SUPPLIERS],
    ]);

  const render = (onClose = vi.fn()) =>
    renderWithAuth(<InwardChallanFormDialog open challanId={null} onClose={onClose} />, {
      scope: { siteId: SITE, siteName: "SURAT-AURO UNIVERSITY" },
    });

  /**
   * A challan must exist before anything can hang off it, so the files chosen
   * on a NEW challan are held until the save returns an id.
   */
  it("saves the challan first, then uploads what was queued", async () => {
    routes();
    render();

    await userEvent.upload(screen.getByLabelText("Choose files to attach"), file("scan.pdf"));
    expect(screen.getByText("scan.pdf")).toBeInTheDocument();

    // Queuing a file must not post it on its own.
    expect(callsTo("/documents")).toHaveLength(0);

    await fillAndSave();

    await waitFor(() => expect(callsTo("/documents")).toHaveLength(1));
    expect(String(callsTo("/documents")[0]![0])).toBe(
      `/api/v1/inward-challans/${CREATED}/documents`,
    );

    // And the challan was saved BEFORE the files, using the id it returned.
    const order = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter((c) => c[1]?.method === "POST")
      .map((c) => String(c[0]));
    expect(order[0]).toBe("/api/v1/inward-challans");
    expect(order[1]).toContain("/documents");
  });

  it("posts no upload at all when nothing was queued", async () => {
    routes();
    const onClose = vi.fn();
    render(onClose);

    await fillAndSave();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(callsTo("/documents")).toHaveLength(0);
  });

  /**
   * The two steps fail independently, and the second failing does not undo the
   * first. Closing here would leave the user unable to tell whether the challan
   * saved — so the dialog stays open, says exactly what happened, and keeps the
   * files so they can be retried without re-keying the challan.
   */
  it("says the challan saved when only the upload fails, and stays open", async () => {
    routeFetch([
      [/\/inward-challans\/.+\/documents$/, json({ message: "Storage is full." }, 500)],
      [/\/inward-challans$/, json(detail())],
      [/\/units$/, UNITS],
      [/\/items$/, ITEMS],
      [/\/suppliers$/, SUPPLIERS],
    ]);
    const onClose = vi.fn();
    render(onClose);

    await userEvent.upload(screen.getByLabelText("Choose files to attach"), file("scan.pdf"));
    await fillAndSave();

    expect(await screen.findByText(/The challan was saved, but the files were not attached/))
      .toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("scan.pdf")).toBeInTheDocument();
  });

  it("refuses a queued file that is too large before the challan is even saved", async () => {
    routes();
    render();

    const huge = new File([new Uint8Array(11 * 1024 * 1024)], "huge.pdf", {
      type: "application/pdf",
    });
    await userEvent.upload(screen.getByLabelText("Choose files to attach"), huge);

    // The dialog carries its own standing notice with role="alert", so match on
    // the message rather than on "the alert".
    expect(await screen.findByText(/The limit is 10\.0 MB/)).toBeInTheDocument();
    expect(screen.queryByText("huge.pdf")).not.toBeInTheDocument();
  });

  it("drops a queued file when it is removed", async () => {
    routes();
    render();

    await userEvent.upload(screen.getByLabelText("Choose files to attach"), file("scan.pdf"));
    await userEvent.click(screen.getByRole("button", { name: "Remove scan.pdf" }));

    expect(screen.queryByText("scan.pdf")).not.toBeInTheDocument();

    await fillAndSave();
    await waitFor(() => expect(callsTo("/inward-challans")).toHaveLength(1));
    expect(callsTo("/documents")).toHaveLength(0);
  });
});
