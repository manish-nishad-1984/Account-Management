import { Controller, Post, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  ATTACHMENT_TYPES,
  gridExportRequestSchema,
  type GridExportRequest,
} from "@accountmanagement/contracts";
import { writeReportWorkbook } from "../../common/spreadsheet/report-workbook";
import { contentDisposition } from "../../common/storage/content-disposition";
import { ZodBody } from "../../common/zod-validation.pipe";

/**
 * Turns the rows a list screen sends into an `.xlsx` (client, 9 Oct 2026: every
 * list and report gets "Export to Excel").
 *
 * NO `@Permissions`, DELIBERATELY. This reads nothing from the database. It
 * formats exactly the rows the caller put in the request, and the caller got
 * those rows from a list route that did check the right to see them — so there
 * is nothing here that could be reached without the right to it. Inventing a
 * permission would mean a new form row and one more thing to grant wrongly. The
 * route is still authenticated: `AuthGuard` is global and this is not `@Public()`.
 */
@Controller("grid-exports")
export class GridExportController {
  @Post("xlsx")
  async xlsx(
    @ZodBody(gridExportRequestSchema) body: GridExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await writeReportWorkbook(safeSheetName(body.sheetName), [
      {
        kind: "table",
        columns: body.columns,
        // A short row is padded, so a column index is always safe.
        rows: body.rows.map((row) =>
          body.columns.map((_, index) => row[index] ?? ""),
        ),
      },
    ]);

    await reply
      .header("Content-Type", ATTACHMENT_TYPES[".xlsx"]!)
      .header("Content-Length", bytes.byteLength)
      .header("Content-Disposition", contentDisposition(`${safeFileName(body.fileName)}.xlsx`))
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-store")
      .send(bytes);
  }
}

/** Excel refuses `[ ] : * ? / \` in a sheet name and anything over 31 characters. */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Sheet1").slice(0, 31);
}

/** Letters, digits, dash and underscore only; the extension is added by the caller. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "export";
}
