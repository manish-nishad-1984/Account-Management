import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuppliersPage } from "./SuppliersPage";
import { json, renderWithAuth, routeFetch } from "../../test/render";

/**
 * The master-detail question, as tests.
 *
 * The legacy screens fill a right-hand pane when a row is clicked and leave the
 * list usable. The port opened with a modal that blocks it. Both layouts now
 * exist so the business can compare them on real data
 * (`19-Business-Decisions-Required.md`), and these tests pin the DIFFERENCE —
 * because "it looks docked" is not the point. Not blocking the list is.
 *
 * Suppliers is the subject only because it is the plainest master screen. The
 * mechanism is in `FormDialog`, `useMasterScreen` and `AppShell`, so whatever is
 * true here is true of every screen.
 */

const SUPPLIER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const RIGHTS = ["supplier.view", "supplier.add", "supplier.edit", "supplier.delete"];

const row = (id: string, name: string) => ({
  id,
  name,
  mobile: null,
  email: null,
  gstNo: null,
  area: "Navrangpura",
  pincode: null,
  isApproved: true,
  openingBalance: null,
  capabilities: { canEdit: true, canDelete: true, canApprove: false },
});

const LIST = {
  rows: [row(SUPPLIER, "RAJU M PATEL-CARTING"), row(OTHER, "RAGHUNADAN CARTING")],
  nextCursor: null,
  total: 2,
};

const detail = (id: string, name: string) => ({
  id,
  name,
  mobile: null,
  email: null,
  gstNo: null,
  area: "Navrangpura",
  pincode: null,
  isApproved: true,
  openingBalance: null,
});

const routes = () =>
  routeFetch([
    [/\/suppliers\/.+$/, json(detail(SUPPLIER, "RAJU M PATEL-CARTING"))],
    [/\/suppliers$/, LIST],
  ]);

/** The row element for a supplier, so a click lands on the row and not a cell. */
const rowFor = async (name: string) => {
  const cell = await screen.findByText(name);
  return cell.closest("tr") as HTMLElement;
};

describe("how a record opens", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("dialog layout — what the port shipped with", () => {
    it("opens the record in a modal dialog", async () => {
      routes();
      renderWithAuth(<SuppliersPage />, { permissions: RIGHTS });

      await userEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]!);

      const dialog = await screen.findByRole("dialog");
      // aria-modal is the promise that the rest of the page is inert. It has to
      // be true only when it IS true.
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    /**
     * A row click must do nothing here. Opening a blocking dialog from a stray
     * click on a list someone is reading is precisely the complaint the split
     * layout exists to answer — reproducing it under the modal would be worse
     * than either option.
     */
    it("ignores a click on the row itself", async () => {
      routes();
      renderWithAuth(<SuppliersPage />, { permissions: RIGHTS });

      await userEvent.click(await rowFor("RAJU M PATEL-CARTING"));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: /supplier/i })).not.toBeInTheDocument();
    });

    it("marks no row as current, because none is visible behind the dialog", async () => {
      routes();
      renderWithAuth(<SuppliersPage />, { permissions: RIGHTS });
      await userEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[0]!);

      await screen.findByRole("dialog");
      expect(document.querySelector("tr[aria-current]")).toBeNull();
    });
  });

  describe("side-by-side layout — what the legacy screens do", () => {
    it("fills a pane when a row is clicked", async () => {
      routes();
      renderWithAuth(<SuppliersPage />, { permissions: RIGHTS, layout: "split" });

      await userEvent.click(await rowFor("RAJU M PATEL-CARTING"));

      const pane = await screen.findByRole("region", { name: /supplier/i });
      expect(within(pane).getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    });

    /**
     * THE WHOLE POINT. A pane that claimed to be a modal would block the list
     * for a screen-reader user while looking docked to everyone else.
     *
     * It is a labelled `region`, not `complementary` — the navigation sidebar is
     * an `<aside>` and already owns that role, so two landmarks would have
     * reported the same thing. Driving the real browser is what surfaced it.
     */
    it("is not a modal dialog, and says so", async () => {
      routes();
      renderWithAuth(<SuppliersPage />, { permissions: RIGHTS, layout: "split" });
      await userEvent.click(await rowFor("RAJU M PATEL-CARTING"));

      await screen.findByRole("region", { name: /supplier/i });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.querySelector("[aria-modal]")).toBeNull();
    });

    it("leaves the list readable and clickable, so records can be walked through", async () => {
      routes();
      renderWithAuth(<SuppliersPage />, { permissions: RIGHTS, layout: "split" });

      await userEvent.click(await rowFor("RAJU M PATEL-CARTING"));
      await screen.findByRole("region", { name: /supplier/i });

      // The second row is still there and still opens — no backdrop swallowed it.
      const second = await rowFor("RAGHUNADAN CARTING");
      await userEvent.click(second);

      await waitFor(() => {
        const calls = vi
          .mocked(globalThis.fetch)
          .mock.calls.filter((c) => String(c[0]).includes(`/suppliers/${OTHER}`));
        expect(calls.length).toBeGreaterThan(0);
      });
    });

    it("marks the open row, so the list shows which record the pane holds", async () => {
      routes();
      renderWithAuth(<SuppliersPage />, { permissions: RIGHTS, layout: "split" });

      await userEvent.click(await rowFor("RAJU M PATEL-CARTING"));

      await waitFor(() => {
        const current = document.querySelectorAll("tr[aria-current]");
        expect(current).toHaveLength(1);
        expect(current[0]!.textContent).toContain("RAJU M PATEL-CARTING");
      });
    });

    /**
     * Rows carry Edit, Delete and Approve buttons. Without the guard in
     * `handleRowActivate`, clicking Delete would ALSO open the record beside the
     * list, and the confirmation would appear over a pane that had just filled
     * with the same record.
     */
    it("does not also open the record when a control in the row is clicked", async () => {
      routes();
      renderWithAuth(<SuppliersPage />, { permissions: RIGHTS, layout: "split" });

      await screen.findByText("RAJU M PATEL-CARTING");
      await userEvent.click((await screen.findAllByRole("button", { name: /delete/i }))[0]!);

      // The confirmation opened; the editing pane did not.
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: /supplier/i })).not.toBeInTheDocument();
    });

    it("opens from the keyboard, because a clickable row that is not focusable is not usable", async () => {
      routes();
      renderWithAuth(<SuppliersPage />, { permissions: RIGHTS, layout: "split" });

      const target = await rowFor("RAJU M PATEL-CARTING");
      expect(target).toHaveAttribute("tabindex", "0");

      target.focus();
      await userEvent.keyboard("{Enter}");

      expect(await screen.findByRole("region", { name: /supplier/i })).toBeInTheDocument();
    });
  });
});
