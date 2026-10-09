import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import type { FastifyReply } from "fastify";
import {
  GridExportController,
  safeFileName,
  safeSheetName,
} from "./grid-export.controller";

/** A reply that records what was sent, the way the real one would be called. */
function fakeReply() {
  const headers: Record<string, unknown> = {};
  let body: Buffer | undefined;
  const reply = {
    header(name: string, value: unknown) {
      headers[name] = value;
      return reply;
    },
    send(bytes: Buffer) {
      body = bytes;
      return Promise.resolve();
    },
  };
  return { reply: reply as unknown as FastifyReply, headers, bytes: () => body! };
}

describe("GridExportController", () => {
  it("writes the rows it is given, with amounts as numbers and the rest as text", async () => {
    const { reply, headers, bytes } = fakeReply();

    await new GridExportController().xlsx(
      {
        sheetName: "Suppliers",
        fileName: "Suppliers 2026-10-09",
        columns: [
          { header: "Name", width: 20, align: "left" },
          { header: "GST", width: 18, align: "left" },
          { header: "Opening balance", width: 16, align: "right" },
        ],
        rows: [
          ["Om Sagar", "24AABFD8160H1ZN", "1234.50"],
          ["Short row"],
          ["Credit", "", "-57820.00"],
        ],
      },
      reply,
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes() as never);
    const sheet = workbook.worksheets[0]!;

    expect(sheet.name).toBe("Suppliers");
    expect(sheet.getRow(1).values).toEqual([undefined, "Name", "GST", "Opening balance"]);
    expect(sheet.getRow(2).getCell(3).value).toBe(1234.5);
    expect(sheet.getRow(3).getCell(3).value ?? "").toBe(""); // padded, not shifted
    expect(sheet.getRow(4).getCell(3).value).toBe(-57820);
    expect(sheet.getRow(2).getCell(2).value).toBe("24AABFD8160H1ZN"); // text stays text

    expect(String(headers["Content-Disposition"])).toContain("Suppliers-2026-10-09.xlsx");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("does not turn a text column that looks like a number into a number", async () => {
    const { reply, bytes } = fakeReply();
    await new GridExportController().xlsx(
      {
        sheetName: "Sites",
        fileName: "Sites",
        columns: [
          { header: "Pincode", width: 10, align: "left" },
          { header: "Mobile", width: 12, align: "left" },
        ],
        rows: [["395007", "0261234567"]],
      },
      reply,
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes() as never);
    const row = workbook.worksheets[0]!.getRow(2);
    expect(row.getCell(1).value).toBe("395007");
    expect(row.getCell(2).value).toBe("0261234567");
  });
});

describe("names", () => {
  it("makes a sheet name Excel accepts", () => {
    expect(safeSheetName("Ledger [Q1]: A/B?*")).toBe("Ledger Q1 A B");
    expect(safeSheetName("x".repeat(60))).toHaveLength(31);
    expect(safeSheetName("[]:")).toBe("Sheet1");
  });

  it("makes a file name with nothing a path or a header could take advantage of", () => {
    expect(safeFileName("../etc/passwd")).toBe("etc-passwd");
    expect(safeFileName('a"b\r\nc')).toBe("a-b-c");
    expect(safeFileName("///")).toBe("export");
  });
});

void vi;
