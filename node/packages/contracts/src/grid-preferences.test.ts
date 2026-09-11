import { describe, expect, it } from "vitest";
import {
  moveGridColumn,
  resolveGridColumns,
  toGridPreference,
  type GridColumnDefault,
} from "./grid-preferences";

const DEFAULTS: GridColumnDefault[] = [
  { id: "name", label: "Supplier", visible: true, locked: true },
  { id: "mobile", label: "Mobile", visible: true },
  { id: "gstNo", label: "GST number", visible: true },
  { id: "area", label: "Location", visible: false },
  { id: "actions", label: "", visible: true, locked: true },
];

describe("resolveGridColumns", () => {
  it("uses the grid's own defaults when nobody has chosen anything", () => {
    expect(resolveGridColumns(DEFAULTS, null).map((c) => c.id)).toEqual([
      "name",
      "mobile",
      "gstNo",
      "area",
      "actions",
    ]);
  });

  it("treats an empty saved layout as no choice at all", () => {
    expect(resolveGridColumns(DEFAULTS, []).map((c) => c.id)).toEqual(
      DEFAULTS.map((c) => c.id),
    );
  });

  it("keeps the order the person chose", () => {
    const resolved = resolveGridColumns(DEFAULTS, [
      { id: "area", visible: true },
      { id: "gstNo", visible: true },
      { id: "mobile", visible: false },
    ]);

    // `name` and `actions` are locked, so they hold index 0 and index 4; the
    // three movable columns fill the gap between them in the chosen order.
    expect(resolved.map((c) => c.id)).toEqual(["name", "area", "gstNo", "mobile", "actions"]);
  });

  it("keeps the visibility the person chose", () => {
    const resolved = resolveGridColumns(DEFAULTS, [
      { id: "mobile", visible: false },
      { id: "gstNo", visible: true },
      { id: "area", visible: true },
    ]);

    expect(resolved.find((c) => c.id === "mobile")?.visible).toBe(false);
    expect(resolved.find((c) => c.id === "area")?.visible).toBe(true);
  });

  /**
   * THE CASE THAT BITES. A layout saved before a column existed does not mention
   * it, and the obvious implementation drops anything unmentioned — so a column
   * added later is invisible to everyone who ever saved a layout, and it looks
   * like it was never built.
   */
  it("appends a column added to the grid AFTER the layout was saved", () => {
    const withNewColumn: GridColumnDefault[] = [
      ...DEFAULTS,
      { id: "pincode", label: "Pincode", visible: true },
    ];

    const resolved = resolveGridColumns(withNewColumn, [
      { id: "mobile", visible: true },
      { id: "gstNo", visible: true },
      { id: "area", visible: false },
    ]);

    expect(resolved.map((c) => c.id)).toContain("pincode");
    expect(resolved.find((c) => c.id === "pincode")?.visible).toBe(true);
  });

  it("drops a column the grid no longer has, rather than leaving a hole", () => {
    const resolved = resolveGridColumns(DEFAULTS, [
      { id: "mobile", visible: true },
      { id: "removedLongAgo", visible: true },
      { id: "gstNo", visible: true },
    ]);

    expect(resolved.map((c) => c.id)).not.toContain("removedLongAgo");
    expect(resolved.map((c) => c.id)).toEqual(["name", "mobile", "gstNo", "area", "actions"]);
  });

  it("ignores a repeated id rather than showing the column twice", () => {
    const resolved = resolveGridColumns(DEFAULTS, [
      { id: "mobile", visible: true },
      { id: "mobile", visible: false },
    ]);

    expect(resolved.filter((c) => c.id === "mobile")).toHaveLength(1);
    expect(resolved.find((c) => c.id === "mobile")?.visible).toBe(true);
  });

  describe("locked columns", () => {
    /**
     * PINNED TO THEIR OWN INDEX, not pushed to the front. Forcing every locked
     * column forward also dragged the row-actions column from last to second,
     * which put Edit and Delete in the middle of the data.
     */
    it("hold the position the grid declares for them", () => {
      const resolved = resolveGridColumns(DEFAULTS, [
        { id: "area", visible: true },
        { id: "name", visible: true },
      ]);

      expect(resolved[0]?.id).toBe("name");
      expect(resolved.at(-1)?.id).toBe("actions");
    });

    /** A grid with every column hidden is a grid nobody can use. */
    it("forces them visible even if a stored layout hid them", () => {
      const resolved = resolveGridColumns(DEFAULTS, [
        { id: "name", visible: false },
        { id: "actions", visible: false },
      ]);

      expect(resolved.find((c) => c.id === "name")?.visible).toBe(true);
      expect(resolved.find((c) => c.id === "actions")?.visible).toBe(true);
    });

    it("cannot be dragged out of position by a stored layout", () => {
      const resolved = resolveGridColumns(DEFAULTS, [
        { id: "actions", visible: true },
        { id: "name", visible: true },
      ]);

      expect(resolved[0]?.id).toBe("name");
      expect(resolved.at(-1)?.id).toBe("actions");
    });
  });

  it("never returns the same column twice, whatever it is given", () => {
    const resolved = resolveGridColumns(DEFAULTS, [
      { id: "name", visible: true },
      { id: "mobile", visible: true },
      { id: "mobile", visible: true },
      { id: "gone", visible: true },
    ]);

    expect(new Set(resolved.map((c) => c.id)).size).toBe(resolved.length);
    expect(resolved).toHaveLength(DEFAULTS.length);
  });
});

describe("toGridPreference", () => {
  it("sends ids and visibility, not the labels", () => {
    expect(toGridPreference(DEFAULTS.slice(0, 2))).toEqual([
      { id: "name", visible: true },
      { id: "mobile", visible: true },
    ]);
  });
});

describe("moveGridColumn", () => {
  const list = ["a", "b", "c", "d"];

  it("moves an entry down", () => {
    expect(moveGridColumn(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an entry up", () => {
    expect(moveGridColumn(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("does nothing when the position has not changed", () => {
    expect(moveGridColumn(list, 2, 2)).toEqual(list);
  });

  it("does nothing for a position outside the list", () => {
    expect(moveGridColumn(list, 0, 9)).toEqual(list);
    expect(moveGridColumn(list, -1, 1)).toEqual(list);
  });

  it("never mutates the list it was given", () => {
    const original = [...list];
    moveGridColumn(list, 0, 3);
    expect(list).toEqual(original);
  });
});
