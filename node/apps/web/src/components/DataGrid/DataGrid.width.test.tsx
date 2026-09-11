import { render, screen, within } from "@testing-library/react";
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

function renderGrid(withActions = true) {
  return render(
    <DataGrid
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

  /** Losing the words is only acceptable because hovering gives them back. */
  it("say the same thing on hover", () => {
    renderGrid();
    expect(screen.getByRole("button", { name: "Edit Anmol Adhesives" })).toHaveAttribute(
      "title",
      "Edit Anmol Adhesives",
    );
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
    expect(headers.at(-1)!.className).toContain("sticky");
    expect(headers[0]!.className).not.toContain("sticky");
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
