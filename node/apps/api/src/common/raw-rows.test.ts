import { describe, expect, it } from "vitest";
import { rawRow, rawRows } from "./raw-rows";

/**
 * Both driver shapes, as literal objects.
 *
 * The point of this file is that it covers the PRODUCTION branch, which the
 * integration tests cannot: they run on PGlite and production runs on
 * postgres.js, and the two return different things from `db.execute()`.
 */
describe("rawRows", () => {
  it("takes the array postgres.js returns in production", () => {
    const production = [{ id: 1 }, { id: 2 }];

    expect(rawRows(production)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("takes the object PGlite returns in tests and development", () => {
    const pglite = {
      rows: [{ id: 1 }, { id: 2 }],
      fields: [{ name: "id", dataTypeID: 23 }],
      command: "SELECT",
      affectedRows: 0,
      rowCount: 2,
    };

    expect(rawRows(pglite)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("returns an empty array for an empty result of either shape", () => {
    expect(rawRows([])).toEqual([]);
    expect(rawRows({ rows: [], rowCount: 0 })).toEqual([]);
  });

  /**
   * Not `[]`. A driver whose shape is neither of these would otherwise make
   * every report silently empty, which is a wrong answer that looks like a
   * correct one — the failure mode this whole port keeps finding in the system
   * it replaces.
   */
  it("throws rather than reporting no rows for an unknown shape", () => {
    expect(() => rawRows({ data: [{ id: 1 }] })).toThrow(/Unrecognised database result shape/);
    expect(() => rawRows(null)).toThrow(/got null/);
    expect(() => rawRows(undefined)).toThrow(/got undefined/);
    expect(() => rawRows("rows")).toThrow(/got string/);
  });

  it("does not mistake a rows property that is not an array", () => {
    expect(() => rawRows({ rows: 5 })).toThrow(/Unrecognised database result shape/);
  });
});

describe("rawRow", () => {
  it("returns the first row of either shape", () => {
    expect(rawRow([{ id: 7 }, { id: 8 }])).toEqual({ id: 7 });
    expect(rawRow({ rows: [{ id: 7 }] })).toEqual({ id: 7 });
  });

  it("returns undefined when there are no rows", () => {
    expect(rawRow([])).toBeUndefined();
    expect(rawRow({ rows: [] })).toBeUndefined();
  });
});
