import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemSheetImportResult } from "@accountmanagement/contracts";
import { ItemImportDialog } from "./ItemImportDialog";
import { json, renderWithAuth, routeFetch } from "../../test/render";

const file = (name = "items.xlsx") =>
  new File(["not really a spreadsheet, the server decides"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

const rejection = (errors: ItemSheetImportResult["errors"]) =>
  json(
    {
      message: `Nothing was imported. ${errors.length} problems to fix.`,
      rowCount: errors.length,
      created: 0,
      revived: 0,
      errors,
    },
    400,
  );

const choose = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.upload(screen.getByLabelText("Spreadsheet"), file());
};

describe("ItemImportDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the columns the sheet needs, marking the required ones", () => {
    renderWithAuth(<ItemImportDialog open onClose={vi.fn()} />, { permissions: ["item.add"] });

    for (const header of ["Item Name", "Unit Type", "Price Per Unit", "GST %", "HSN Code"]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it("cannot upload before a file is chosen", () => {
    renderWithAuth(<ItemImportDialog open onClose={vi.fn()} />, { permissions: ["item.add"] });
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("reports what was imported", async () => {
    const user = userEvent.setup();
    routeFetch([[/\/items\/import$/, { rowCount: 12, created: 12, revived: 0, errors: [] }]]);

    renderWithAuth(<ItemImportDialog open onClose={vi.fn()} />, { permissions: ["item.add"] });
    await choose(user);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText(/Imported 12 items from 12 rows/)).toBeInTheDocument();
  });

  it("names revived items separately, because they were previously deleted", async () => {
    const user = userEvent.setup();
    routeFetch([[/\/items\/import$/, { rowCount: 5, created: 3, revived: 2, errors: [] }]]);

    renderWithAuth(<ItemImportDialog open onClose={vi.fn()} />, { permissions: ["item.add"] });
    await choose(user);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(
      await screen.findByText(/3 items and 2 previously deleted items from 5 rows/),
    ).toBeInTheDocument();
  });

  /**
   * The whole reason the endpoint answers 400 with a structured body. The
   * legacy import returns one sentence about the first bad row, so cleaning a
   * catalogue is one upload per problem.
   */
  describe("a refused import", () => {
    const ERRORS = [
      { row: 2, column: "Unit Type", message: 'There is no unit called "Sacks". Use one of: Bag' },
      { row: 7, column: "Price Per Unit", message: "Price per unit is required" },
      { row: 9, column: "Item Name", message: '"Cement" is also on row 3.' },
    ];

    const upload = async () => {
      const user = userEvent.setup();
      routeFetch([[/\/items\/import$/, rejection(ERRORS)]]);
      renderWithAuth(<ItemImportDialog open onClose={vi.fn()} />, { permissions: ["item.add"] });
      await choose(user);
      await user.click(screen.getByRole("button", { name: "Upload" }));
      return user;
    };

    it("lists every bad row with its number and column", async () => {
      await upload();

      const table = await screen.findByRole("table");
      expect(table).toBeInTheDocument();

      for (const error of ERRORS) {
        expect(screen.getByText(error.message)).toBeInTheDocument();
        expect(screen.getByText(String(error.row))).toBeInTheDocument();
      }
    });

    it("says plainly that nothing was written", async () => {
      await upload();
      expect(await screen.findByText(/Nothing was imported/)).toBeInTheDocument();
    });

    it("does not show a success message", async () => {
      await upload();
      await screen.findByRole("table");
      expect(screen.queryByText(/^Imported/)).not.toBeInTheDocument();
    });

    it("keeps the Upload button, so a corrected file can be sent without reopening", async () => {
      await upload();
      await screen.findByRole("table");
      expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    });
  });

  /**
   * A failure that is NOT a per-row rejection — a `.xls`, an oversized file, a
   * 403 — has no error list, and must still say something rather than showing
   * an empty table.
   */
  it("shows the plain message when the failure is not about rows", async () => {
    const user = userEvent.setup();
    routeFetch([
      [
        /\/items\/import$/,
        json({ message: '"old.xls" is an older Excel file (.xls). Use "Save As".' }, 400),
      ],
    ]);

    renderWithAuth(<ItemImportDialog open onClose={vi.fn()} />, { permissions: ["item.add"] });
    await choose(user);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText(/older Excel file/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("clears the previous result when the dialog is closed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    routeFetch([[/\/items\/import$/, rejection([{ row: 2, column: "Unit Type", message: "Bad" }])]]);

    renderWithAuth(<ItemImportDialog open onClose={onClose} />, { permissions: ["item.add"] });
    await choose(user);
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
