import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GridColumnDefault } from "@accountmanagement/contracts";
import { CustomizeColumns } from "./CustomizeColumns";

const COLUMNS: GridColumnDefault[] = [
  { id: "name", label: "Supplier", visible: true, locked: true },
  { id: "mobile", label: "Mobile", visible: true },
  { id: "gstNo", label: "GST number", visible: true },
  { id: "area", label: "Location", visible: false },
  { id: "actions", label: "", visible: true, locked: true },
];

function open(overrides: Partial<Parameters<typeof CustomizeColumns>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onReset = vi.fn();
  render(
    <CustomizeColumns
      open
      columns={COLUMNS}
      onSave={onSave}
      onCancel={onCancel}
      onReset={onReset}
      {...overrides}
    />,
  );
  return { onSave, onCancel, onReset };
}

describe("CustomizeColumns", () => {
  it("renders nothing until it is opened", () => {
    render(
      <CustomizeColumns
        open={false}
        columns={COLUMNS}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("counts what is selected, the way the reference does", () => {
    open();
    expect(screen.getByTestId("column-count")).toHaveTextContent("4 of 5 selected");
  });

  /**
   * NOTHING IS WRITTEN UNTIL SAVE. Someone who hides six columns and thinks
   * better of it presses Cancel and nothing has happened — which is what Cancel
   * means, and is not true of a panel that writes on every click.
   */
  it("changes nothing until Save is pressed", async () => {
    const { onSave, onCancel } = open();

    await userEvent.click(screen.getByRole("checkbox", { name: "Mobile" }));
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("sends the whole layout on Save, with the change applied", async () => {
    const { onSave } = open();

    await userEvent.click(screen.getByRole("checkbox", { name: "Mobile" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const saved = onSave.mock.calls[0]![0] as GridColumnDefault[];
    expect(saved.find((c) => c.id === "mobile")?.visible).toBe(false);
    expect(saved.find((c) => c.id === "gstNo")?.visible).toBe(true);
  });

  describe("locked columns", () => {
    it("cannot be switched off", () => {
      open();
      expect(screen.getByRole("checkbox", { name: "Supplier" })).toBeDisabled();
    });

    it("offer no way to move them", () => {
      open();
      expect(screen.queryByRole("button", { name: "Move Supplier up" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Move Supplier down" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("reordering", () => {
    it("moves a column down and keeps the change until Save", async () => {
      const { onSave } = open();

      await userEvent.click(screen.getByRole("button", { name: "Move Mobile down" }));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      const saved = (onSave.mock.calls[0]![0] as GridColumnDefault[]).map((c) => c.id);
      expect(saved).toEqual(["name", "gstNo", "mobile", "area", "actions"]);
    });

    it("moves a column back up again", async () => {
      const { onSave } = open();

      await userEvent.click(screen.getByRole("button", { name: "Move Location up" }));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      const saved = (onSave.mock.calls[0]![0] as GridColumnDefault[]).map((c) => c.id);
      expect(saved).toEqual(["name", "mobile", "area", "gstNo", "actions"]);
    });

    /**
     * A locked column holds its own position — the identity column first, the row
     * actions last — so nothing can be moved past either end.
     */
    it("will not move a column past a locked one", async () => {
      const { onSave } = open();

      expect(screen.getByRole("button", { name: "Move Mobile up" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move Location down" })).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect((onSave.mock.calls[0]![0] as GridColumnDefault[]).map((c) => c.id)).toEqual(
        COLUMNS.map((c) => c.id),
      );
    });
  });

  describe("search", () => {
    it("shows only the columns that match", async () => {
      open();
      await userEvent.type(screen.getByLabelText("Search columns"), "gst");

      expect(screen.getByRole("checkbox", { name: "GST number" })).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: "Mobile" })).not.toBeInTheDocument();
    });

    /**
     * With a filter on, the rows on screen are not adjacent in the real list, so
     * "move down" would jump a column past the ones the search is hiding. The
     * controls go away and the panel says why.
     */
    it("withdraws the move buttons while filtering, and says so", async () => {
      open();
      await userEvent.type(screen.getByLabelText("Search columns"), "gst");

      expect(
        screen.queryByRole("button", { name: "Move GST number down" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Clear the search to change the order.")).toBeInTheDocument();
    });

    it("can still switch a matching column on or off", async () => {
      const { onSave } = open();
      await userEvent.type(screen.getByLabelText("Search columns"), "location");
      await userEvent.click(screen.getByRole("checkbox", { name: "Location" }));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      const saved = onSave.mock.calls[0]![0] as GridColumnDefault[];
      expect(saved.find((c) => c.id === "area")?.visible).toBe(true);
    });
  });

  it("offers Reset to Default", async () => {
    const { onReset } = open();
    await userEvent.click(screen.getByRole("button", { name: "Reset to Default" }));
    expect(onReset).toHaveBeenCalled();
  });

  it("says when it is saving, and refuses a second press", () => {
    open({ isSaving: true });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
