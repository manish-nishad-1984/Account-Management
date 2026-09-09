import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportButtons } from "./ExportButtons";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * The Export To Excel / Export To Pdf pair, and the ledger's third button.
 *
 * What these check is the plumbing the legacy screen has no equivalent of: that
 * the panel's filters travel with the file, that paging does NOT, and that a
 * refused export says why instead of doing nothing.
 */

const file = (type: string) =>
  new Response(new Blob(["PK"]), { status: 200, headers: { "Content-Type": type } });

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const routes = (over: [RegExp, unknown][] = []) =>
  routeFetch([
    ...over,
    [/\/reports\/.*\.xlsx/, file(XLSX)],
    [/\/reports\/.*\.pdf/, file("application/pdf")],
  ]);

/** The export URL the component actually requested. */
const requested = (match: string): string | undefined =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.map((call) => String(call[0]))
    .find((url) => url.includes(match));

describe("ExportButtons", () => {
  let click: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:test"),
        revokeObjectURL: vi.fn(),
      }),
    );
    // jsdom does not navigate, so the anchor's click is stubbed to observe it.
    click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("offers two buttons, and a third only where the ledger asks for it", async () => {
    routes();
    renderWithAuth(<ExportButtons kind="balances" query={{ direction: "out" }} />);

    expect(screen.getByRole("button", { name: /Export to Excel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export to PDF/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Excel by party/ })).not.toBeInTheDocument();
  });

  it("offers the party-grouped Excel on the ledger", () => {
    routes();
    renderWithAuth(<ExportButtons kind="ledger" withByParty query={{ direction: "out" }} />);

    expect(screen.getByRole("button", { name: /Excel by party/ })).toBeInTheDocument();
  });

  it("downloads the spreadsheet and hands it to the browser", async () => {
    const user = userEvent.setup();
    routes();
    renderWithAuth(<ExportButtons kind="ledger" query={{ direction: "out" }} />);

    await user.click(screen.getByRole("button", { name: /Export to Excel/ }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(requested("/reports/ledger/export.xlsx")).toBeDefined();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("asks for the PDF route when PDF is pressed", async () => {
    const user = userEvent.setup();
    routes();
    renderWithAuth(<ExportButtons kind="sales" query={{}} />);

    await user.click(screen.getByRole("button", { name: /Export to PDF/ }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(requested("/reports/sales/export.pdf")).toBeDefined();
  });

  /**
   * The filters are the whole point of the button. The legacy Item Master
   * download passes its search parameters as default-valued C# strings, which
   * interpolate as the literal `null`, so its file is the unfiltered list
   * whatever the box says — §5o. Exporting what is on screen is what people
   * mean by Export.
   */
  it("sends the panel's filters with the file", async () => {
    const user = userEvent.setup();
    routes();
    renderWithAuth(
      <ExportButtons
        kind="ledger"
        query={{ direction: "out", partyId: "party-1", fromDate: "2026-04-01" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Export to Excel/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());

    const url = requested("/reports/ledger/export.xlsx")!;
    expect(url).toContain("partyId=party-1");
    expect(url).toContain("fromDate=2026-04-01");
  });

  /**
   * An export is the whole filtered set. Sending the grid's paging would
   * produce a file whose Total describes something other than its own rows.
   */
  it("never sends paging with an export", async () => {
    const user = userEvent.setup();
    routes();
    renderWithAuth(
      <ExportButtons kind="ledger" query={{ direction: "out", limit: 50, offset: 100 }} />,
    );

    await user.click(screen.getByRole("button", { name: /Export to Excel/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());

    const url = requested("/reports/ledger/export.xlsx")!;
    expect(url).not.toContain("limit=");
    expect(url).not.toContain("offset=");
  });

  /**
   * The download is a fetch, so the browser shows nothing while it runs. A
   * person who sees nothing clicks again, and each click runs the whole report.
   */
  it("disables the whole group while one export is running", async () => {
    const user = userEvent.setup();

    // Not `routeFetch`, which resolves immediately — there would be no pending
    // state to observe. This holds the response open until the test releases it.
    let release: () => void = () => {};
    vi.mocked(globalThis.fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(file(XLSX));
        }),
    );

    renderWithAuth(<ExportButtons kind="ledger" withByParty query={{ direction: "out" }} />);
    await user.click(screen.getByRole("button", { name: /Export to Excel/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Export to PDF/ })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: /Excel by party/ })).toBeDisabled();

    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Export to PDF/ })).not.toBeDisabled(),
    );
  });

  /**
   * Above the row cap the server refuses with a sentence naming the count and
   * what to narrow. A button that silently does nothing is the failure mode
   * worth avoiding.
   */
  it("shows the server's reason when an export is refused", async () => {
    const user = userEvent.setup();
    routes([
      [
        /\/reports\/.*\.xlsx/,
        new Response(
          JSON.stringify({
            statusCode: 400,
            message: "This report has 25,000 rows, and an export holds 20,000. Narrow it.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ],
    ]);

    renderWithAuth(<ExportButtons kind="ledger" query={{ direction: "out" }} />);
    await user.click(screen.getByRole("button", { name: /Export to Excel/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/25,000 rows/);
    expect(click).not.toHaveBeenCalled();
  });
});
