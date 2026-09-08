import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemsPage } from "./ItemsPage";
import { json, renderWithAuth, routeFetch } from "../../test/render";

/**
 * The "Download File" / "Upload File" pair on the Item Master.
 *
 * Kept apart from `ItemsPage.test.tsx` because these controls are permission
 * gated and that file renders inside the real `AuthProvider`, where the user is
 * null and every gated control is hidden.
 */

const EMPTY_LIST = { rows: [], nextCursor: null, total: 0 };
const UNITS = { rows: [], nextCursor: null, total: 0 };

const xlsx = () =>
  new Response(new Blob(["PK"]), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });

const listRoutes = (exportResponse: unknown = xlsx()) =>
  routeFetch([
    [/\/items\/export$/, exportResponse],
    [/\/units/, UNITS],
    [/\/items$/, EMPTY_LIST],
  ]);

/** The URL the export request actually went to, so the search can be asserted. */
const exportUrl = (): string | undefined =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.map((call) => String(call[0]))
    .find((url) => url.includes("/items/export"));

describe("the Item Master spreadsheet buttons", () => {
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

  describe("permissions", () => {
    it("shows Download to anyone who can view items", async () => {
      listRoutes();
      renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });

      expect(await screen.findByRole("button", { name: /Download File/ })).toBeInTheDocument();
    });

    /**
     * The legacy `DownloadItemListDemoExcelFile` carries no
     * `[FormPermissionAttribute]` at all, so anyone who can reach the site can
     * pull the whole price list — finding C-6. The port guards it.
     */
    it("hides Download from someone who cannot view items", async () => {
      listRoutes();
      renderWithAuth(<ItemsPage />, { permissions: [] });

      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: /Download File/ })).not.toBeInTheDocument();
    });

    it("shows Upload only to someone who may add items", async () => {
      listRoutes();
      renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });

      await screen.findByRole("button", { name: /Download File/ });
      expect(screen.queryByRole("button", { name: /Upload File/ })).not.toBeInTheDocument();
    });

    it("shows Upload when item.add is granted", async () => {
      listRoutes();
      renderWithAuth(<ItemsPage />, { permissions: ["item.view", "item.add"] });

      expect(await screen.findByRole("button", { name: /Upload File/ })).toBeInTheDocument();
    });
  });

  describe("downloading", () => {
    it("fetches the sheet and hands it to the browser", async () => {
      const user = userEvent.setup();
      listRoutes();
      renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });

      await user.click(await screen.findByRole("button", { name: /Download File/ }));

      await waitFor(() => expect(click).toHaveBeenCalled());
      expect(URL.createObjectURL).toHaveBeenCalled();
    });

    /** Or every download leaks its blob for the life of the page. */
    it("revokes the object URL", async () => {
      const user = userEvent.setup();
      listRoutes();
      renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });

      await user.click(await screen.findByRole("button", { name: /Download File/ }));
      await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test"));
    });

    it("exports the whole list when the search box is empty", async () => {
      const user = userEvent.setup();
      listRoutes();
      renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });

      await user.click(await screen.findByRole("button", { name: /Download File/ }));
      await waitFor(() => expect(exportUrl()).toBeDefined());
      expect(exportUrl()).not.toContain("search=");
    });

    /**
     * The legacy download passes `searchText` to its API as a default-valued C#
     * string, which interpolates into the URL as the literal `null` — so its
     * file is the unfiltered list whatever the box says.
     */
    it("carries the current search, so the file matches what is on screen", async () => {
      const user = userEvent.setup();
      listRoutes();
      renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });

      await user.type(await screen.findByPlaceholderText(/Search item name/), "cement");
      await user.click(screen.getByRole("button", { name: /Download File/ }));

      await waitFor(() => expect(exportUrl()).toContain("search=cement"));
    });

    it("says so when the download fails, instead of doing nothing", async () => {
      const user = userEvent.setup();
      listRoutes(json({ message: "More than 20,000 items match." }, 400));
      renderWithAuth(<ItemsPage />, { permissions: ["item.view"] });

      await user.click(await screen.findByRole("button", { name: /Download File/ }));

      expect(await screen.findByText("More than 20,000 items match.")).toBeInTheDocument();
      expect(click).not.toHaveBeenCalled();
    });
  });

  it("opens the upload dialog", async () => {
    const user = userEvent.setup();
    listRoutes();
    renderWithAuth(<ItemsPage />, { permissions: ["item.view", "item.add"] });

    await user.click(await screen.findByRole("button", { name: /Upload File/ }));
    expect(await screen.findByLabelText("Spreadsheet")).toBeInTheDocument();
  });
});
