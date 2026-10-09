import { describe, expect, it } from "vitest";
import { buildExportRequest, exportAmount, exportDate, exportYesNo } from "./grid-export";

type Row = { name: string; balance: string | null; approved: boolean; on: string | null };

describe("buildExportRequest", () => {
  const columns = [
    { header: "Name", value: (r: Row) => r.name },
    { header: "Balance", align: "right" as const, value: (r: Row) => exportAmount(r.balance) },
    { header: "Approved", value: (r: Row) => exportYesNo(r.approved) },
    { header: "Date", value: (r: Row) => exportDate(r.on) },
  ];

  it("turns rows into the sheet the screen describes, column for column", () => {
    const request = buildExportRequest<Row>(
      [
        { name: "Om Sagar", balance: "1234.50", approved: true, on: "2026-10-09T00:00:00.000Z" },
        { name: "No balance", balance: null, approved: false, on: null },
      ],
      columns,
      "Suppliers",
      "Suppliers-2026-10-09",
    );

    expect(request.columns.map((c) => [c.header, c.align, c.width])).toEqual([
      ["Name", "left", 18],
      ["Balance", "right", 18],
      ["Approved", "left", 18],
      ["Date", "left", 18],
    ]);
    expect(request.rows).toEqual([
      ["Om Sagar", "1234.50", "Yes", "09-10-2026"],
      ["No balance", "", "No", ""],
    ]);
  });

  it("writes a null or undefined value as an empty cell, never the word null", () => {
    const request = buildExportRequest<Row>(
      [{ name: "A", balance: null, approved: true, on: null }],
      [{ header: "X", value: () => null }, { header: "Y", value: () => undefined }],
      "S",
      "F",
    );
    expect(request.rows).toEqual([["", ""]]);
  });
});
