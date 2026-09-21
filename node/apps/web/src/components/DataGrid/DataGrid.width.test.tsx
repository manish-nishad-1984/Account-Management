import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "./DataGrid";
import { RowActions } from "./RowActions";

/**
 * WHAT KEEPS A GRID INSIDE ITS OWN WIDTH.
 *
 * The client reported that the grids scroll sideways on every screen, and the
 * measurements said why: the row-actions cell was 298px — wider than any column
 * of real data on seven of the twelve grids — and every cell refused to wrap, so
 * one long email set a floor under a whole column.
 *
 * jsdom cannot measure any of that; it applies no stylesheet. What it CAN pin is
 * the structure the widths depend on, and that is what these tests do: no text
 * inside the action buttons, an accessible name and a tooltip on each of them
 * anyway, and the floating cell applied to the actions column and to nothing
 * else. The pixels were measured in a real browser and are recorded in the
 * commit.
 */

interface Row {
  id: number;
  name: string;
}

const ROWS: Row[] = [
  { id: 1, name: "Ambica Steel Traders" },
  { id: 2, name: "Anmol Adhesives" },
];

function columns(withActions: boolean): ColumnDef<Row, unknown>[] {
  const list: ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Supplier", cell: ({ row }) => row.original.name },
    { id: "mobile", header: "Mobile", cell: () => "9700000000" },
  ];
  if (withActions) {
    list.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <RowActions
          capabilities={{ canEdit: true, canDelete: true, canApprove: false }}
          label={row.original.name}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      ),
    });
  }
  return list;
}

function renderGrid(
  withActions = true,
  toolbar: { filters?: React.ReactNode; actions?: React.ReactNode } = {},
) {
  return render(
    <DataGrid
      {...toolbar}
      columns={columns(withActions)}
      rows={ROWS}
      total={ROWS.length}
      isLoading={false}
      search=""
      onSearchChange={vi.fn()}
      sortBy="name"
      sortDir="asc"
      onSortChange={vi.fn()}
      sortableFields={["name"]}
      canGoBack={false}
      canGoForward={false}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      pageIndex={0}
    />,
  );
}

const lastCellOfFirstRow = () => {
  const row = screen.getAllByRole("row")[1]!;
  const cells = within(row).getAllByRole("cell");
  return cells.at(-1)!;
};

describe("row actions", () => {
  it("carry no text, which is what made the column narrow", () => {
    renderGrid();
    const cell = lastCellOfFirstRow();
    expect(cell.textContent).toBe("");
  });

  it("still name themselves for a screen reader", () => {
    renderGrid();
    expect(
      screen.getByRole("button", { name: "Edit Ambica Steel Traders" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete Anmol Adhesives" }),
    ).toBeInTheDocument();
  });

  /**
   * Losing the words is only acceptable because hovering gives them back.
   *
   * It was a `title` attribute and is now a real tooltip, so this drives the
   * pointer rather than reading a string off the element. The reason for the
   * change is that `title` and a styled tip cannot coexist - the browser draws
   * its own a second later, in its own corner, saying the same thing - so the
   * attribute had to go and the behaviour had to be pinned somewhere else.
   *
   * The tip is `aria-hidden` and the button keeps its `aria-label`, which is why
   * this queries by TEXT: the label is not text content, so the only node that
   * can match is the tip itself.
   */
  it("say the same thing on hover", async () => {
    const user = userEvent.setup();
    renderGrid();
    const edit = screen.getByRole("button", { name: "Edit Anmol Adhesives" });

    expect(screen.queryByText("Edit Anmol Adhesives")).not.toBeInTheDocument();

    await user.hover(edit);
    expect(screen.getByText("Edit Anmol Adhesives")).toBeInTheDocument();

    await user.unhover(edit);
    expect(screen.queryByText("Edit Anmol Adhesives")).not.toBeInTheDocument();
  });

  it("keeps Delete visibly destructive", () => {
    renderGrid();
    expect(
      screen.getByRole("button", { name: "Delete Ambica Steel Traders" }).className,
    ).toContain("text-rose-600");
  });
});

describe("the floating actions column", () => {
  /**
   * A grid that does not fit must never push Edit and Delete off the screen —
   * that is the difference between a list that is untidy and one that cannot be
   * worked.
   */
  it("pins the actions cell to the right edge", () => {
    renderGrid();
    expect(lastCellOfFirstRow().className).toContain("sticky");
  });

  it("pins the actions header with it, so the two cannot part company", () => {
    renderGrid();
    const headers = screen.getAllByRole("columnheader");
    expect(headers.at(-1)!.className).toContain("right-0");
    expect(headers[0]!.className).not.toContain("right-0");
  });

  /** Every header is pinned to the TOP, so the rows scroll under it (18 Sep 2026). */
  it("keeps the header row in view while the rows scroll", () => {
    renderGrid();
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.className).toContain("sticky");
      expect(header.className).toContain("top-0");
    }
  });

  it("leaves every other cell to scroll normally", () => {
    renderGrid();
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    expect(cells[0]!.className).not.toContain("sticky");
    expect(cells[1]!.className).not.toContain("sticky");
  });

  /**
   * A grid whose last column is DATA must not float it: the reader would lose
   * the column at the edge of the table to a shadow and never know why.
   */
  it("floats nothing when the grid has no actions column", () => {
    renderGrid(false);
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    for (const cell of cells) {
      expect(cell.className).not.toContain("sticky");
    }
  });
});

/** One row above the grid (client request, 18 Sep 2026): search, filters, count and actions together. */
describe("the toolbar", () => {
  it("puts the screen's filters and actions on the search row", () => {
    renderGrid(true, {
      filters: <select aria-label="Status" />,
      actions: <button type="button">New request</button>,
    });
    const search = screen.getByRole("textbox", { name: "Search" });
    const row = search.closest("div.border-b") as HTMLElement;
    expect(within(row).getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "New request" })).toBeInTheDocument();
  });
});
