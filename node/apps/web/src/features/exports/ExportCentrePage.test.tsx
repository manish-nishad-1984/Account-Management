import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportCentrePage } from "./ExportCentrePage";
import { presetDates, presetOf, describeRange } from "./date-presets";
import { EXPORT_DATASETS, filtersFor } from "./datasets";
import { EXPORTABLE_RIGHTS } from "../../navigation/nav";
import { json, renderWithAuth } from "../../test/render";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../lib/download", () => ({ saveBlob: save }));

/** The Excel export centre (client, 20 Oct 2026). */
const item = {
  id: "i1", name: "OPC Cement 53", unitId: 1, unitName: "Bag", pricePerUnit: "410.00", gstPercent: "28", gstAmount: "114.80",
  hsnCode: "2523", isApproved: true, capabilities: { canEdit: true, canDelete: true, canApprove: true },
};

const calls = () => vi.mocked(globalThis.fetch).mock.calls.map(([input, init]) => ({ url: String(input), init: init as RequestInit | undefined }));
const workbook = () => {
  const call = calls().find((c) => c.url.includes("/grid-exports/workbook"));
  return call ? (JSON.parse(String(call.init?.body)) as { fileName: string; sheets: { sheetName: string; rows: string[][] }[] }) : null;
};

describe("ExportCentrePage date tags (client, 26 Oct 2026)", () => {
  const TAG = { id: "t1", name: "Q2 audit", fromDate: "2026-07-01", toDate: "2026-09-30" };
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/date-tags") && init?.method === "POST") return Promise.resolve(json({ ...TAG, id: "t2", ...JSON.parse(String(init.body)) }));
        if (url.endsWith("/date-tags")) return Promise.resolve(json({ tags: [TAG] }));
        return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sets the dates from a saved tag, and saves the dates on screen under a name", async () => {
    const user = userEvent.setup();
    renderWithAuth(<ExportCentrePage />, { permissions: ["item.view"] });

    await user.click(await screen.findByRole("button", { name: "Q2 audit" }));
    expect(screen.getByLabelText("From")).toHaveValue("2026-07-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-09-30");
    expect(screen.getByRole("button", { name: "Q2 audit" })).toHaveAttribute("aria-pressed", "true");

    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "2026-10-31");
    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByLabelText("Tag name"), "July to October");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const sent = calls().find((c) => c.url.endsWith("/date-tags") && c.init?.method === "POST");
      expect(JSON.parse(String(sent!.init!.body))).toEqual({ name: "July to October", fromDate: "2026-07-01", toDate: "2026-10-31" });
    });
  });
});

describe("ExportCentrePage", () => {
  beforeEach(() => {
    save.mockClear();
    window.localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/grid-exports/workbook")) return Promise.resolve(new Response(new Blob(["x"])));
        if (url.includes("/items?")) return Promise.resolve(json({ rows: [item], nextCursor: null, total: 1 }));
        return Promise.resolve(json({ rows: [], nextCursor: null, total: 0 }));
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers only what the person may see on its own screen", () => {
    renderWithAuth(<ExportCentrePage />, { permissions: ["item.view", "reports-payments.view"] });
    expect(screen.getByRole("checkbox", { name: /^items/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^payments/i })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /purchase invoices/i })).not.toBeInTheDocument();
  });

  it("puts every ticked sheet in one file, dated sheets by the range and masters whole", async () => {
    const user = userEvent.setup();
    renderWithAuth(<ExportCentrePage />, { permissions: ["item.view", "reports-payments.view"] });
    const { fromDate, toDate } = presetDates("fy", new Date());

    await user.click(screen.getByRole("checkbox", { name: /^items/i }));
    await user.click(screen.getByRole("checkbox", { name: /^payments/i }));
    expect(screen.getByText(/by payment date/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /export to excel/i }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const body = workbook()!;
    expect(body.sheets.map((sheet) => sheet.sheetName)).toEqual(["Summary", "Items", "Payments"]);
    expect(body.sheets[1]!.rows[0]![0]).toBe("OPC Cement 53");
    expect(body.fileName).toBe(`Account-Book-${fromDate}-to-${toDate}`);

    const payments = calls().find((c) => c.url.includes("/payments?"))!.url;
    expect(payments).toContain(`fromDate=${fromDate}`);
    expect(payments).toContain(`toDate=${toDate}`);
    expect(payments).toContain("dateBasis=document");
    expect(calls().find((c) => c.url.includes("/items?"))!.url).not.toContain("fromDate");
    expect(await screen.findByText(/downloaded/i)).toHaveTextContent("2 sheets"); // and the Summary
  });

  it("counts by the entry date when asked, and remembers the ticks", async () => {
    const user = userEvent.setup();
    const first = renderWithAuth(<ExportCentrePage />, { permissions: ["reports-payments.view"] });
    await user.click(screen.getByRole("checkbox", { name: /^payments/i }));
    await user.click(screen.getByRole("radio", { name: /entry date/i }));
    expect(screen.getByText(/by entry date/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /all dates/i }));
    await user.click(screen.getByRole("button", { name: /export to excel/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(calls().find((c) => c.url.includes("/payments?"))!.url).not.toContain("fromDate");

    first.unmount();
    renderWithAuth(<ExportCentrePage />, { permissions: ["reports-payments.view"] });
    expect(screen.getByRole("checkbox", { name: /^payments/i })).toBeChecked();
  });
});

describe("date presets", () => {
  const today = new Date(2026, 9, 20);
  it("runs a financial year from April to March", () => {
    expect(presetDates("fy", today)).toEqual({ fromDate: "2026-04-01", toDate: "2027-03-31" });
    expect(presetDates("lastFy", today)).toEqual({ fromDate: "2025-04-01", toDate: "2026-03-31" });
    expect(presetDates("fy", new Date(2027, 0, 5))).toEqual({ fromDate: "2026-04-01", toDate: "2027-03-31" });
  });
  it("knows a month's last day, and January's last month", () => {
    expect(presetDates("month", today)).toEqual({ fromDate: "2026-10-01", toDate: "2026-10-31" });
    expect(presetDates("lastMonth", today)).toEqual({ fromDate: "2026-09-01", toDate: "2026-09-30" });
    expect(presetDates("lastMonth", new Date(2027, 0, 5))).toEqual({ fromDate: "2026-12-01", toDate: "2026-12-31" });
  });
  it("names the chosen preset and the range", () => {
    expect(presetOf("2026-04-01", "2027-03-31", today)).toBe("fy");
    expect(presetOf("2026-04-02", "2027-03-31", today)).toBeNull();
    expect(describeRange("2026-04-01", "2027-03-31")).toBe("01-04-2026 to 31-03-2027");
    expect(describeRange("", "")).toBe("All dates");
  });
});

describe("filtersFor", () => {
  const choices = { fromDate: "2026-04-01", toDate: "", dateBasis: "entry" as const, companyId: "c1", siteId: "s1" };
  it("gives each list only the filters it understands", () => {
    expect(filtersFor({ dateLabel: "Bill date", bySite: true, byCompany: true }, choices)).toEqual({
      fromDate: "2026-04-01", dateBasis: "entry", siteId: "s1", companyId: "c1",
    });
    expect(filtersFor({ dateLabel: "List date", byCompany: true }, choices)).toEqual({ fromDate: "2026-04-01", dateBasis: "entry", companyId: "c1" });
    expect(filtersFor({}, choices)).toEqual({});
  });
});

describe("the menu row", () => {
  it("shows for every right a sheet here needs", () => {
    for (const dataset of EXPORT_DATASETS) expect(EXPORTABLE_RIGHTS).toContain(dataset.permission);
  });
});
