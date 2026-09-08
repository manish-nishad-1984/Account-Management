import { BadRequestException } from "@nestjs/common";
import { attachmentExtension, formatBytes } from "@accountmanagement/contracts";
import { detectRefusedType, detectType } from "../storage/file-type";

/**
 * 5 MB.
 *
 * Lower than the 10 MB attachment cap on purpose. An `.xlsx` is a zip, and a
 * zip is read by decompressing it — so the number that matters is not the
 * upload size but what it expands to in memory. The live catalogue of 758 items
 * is around 40 KB as a spreadsheet; 5 MB is two orders of magnitude of headroom
 * and still bounds the decompression. The row cap in `readWorkbook` is the
 * second guard, and the two are independent: a small file can still declare a
 * million rows.
 */
export const ITEM_SHEET_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Refuses anything that is not an `.xlsx`, before it reaches the parser.
 *
 * Three checks, in the order that produces the most useful sentence:
 *
 * 1. **A legacy `.xls`** is named specifically. The legacy importer accepts one
 *    — `Provider=Microsoft.Jet.OLEDB.4.0` for `.xls`, ACE for `.xlsx` — and no
 *    maintained JavaScript library reads BIFF8. That is a real capability this
 *    port drops, so it has to say so in a sentence with the remedy in it, not
 *    fail with "zip file is corrupt". Detected by the OLE compound-document
 *    signature rather than the extension, so a genuinely-old file renamed to
 *    `.xlsx` gets the same clear answer.
 * 2. **An executable** gets the same treatment it gets on an attachment.
 * 3. **Anything else without a zip signature** is not an OOXML file at all.
 *
 * `.csv` is deliberately NOT accepted. It looks like the friendly option and it
 * is the one that silently corrupts a catalogue: Excel writes CSV in the
 * machine's locale, so a price of 1.234,56 in one region and 1,234.56 in
 * another are the same file to Excel and different numbers to a parser. The
 * legacy importer does not accept CSV either.
 */
export function assertSpreadsheet(fileName: string, bytes: Buffer): void {
  if (bytes.byteLength > ITEM_SHEET_MAX_BYTES) {
    throw new BadRequestException(
      `"${fileName}" is ${formatBytes(bytes.byteLength)}. The limit for a spreadsheet is ${formatBytes(
        ITEM_SHEET_MAX_BYTES,
      )}.`,
    );
  }
  if (bytes.byteLength === 0) {
    throw new BadRequestException(`"${fileName}" is empty.`);
  }

  const refused = detectRefusedType(bytes);
  if (refused) {
    throw new BadRequestException(`"${fileName}" is a program, whatever it is named.`);
  }

  const detected = detectType(bytes);

  if (detected === "application/x-ole-storage") {
    throw new BadRequestException(
      `"${fileName}" is an older Excel file (.xls). Open it in Excel and use ` +
        `"Save As" to save it as .xlsx, then upload that.`,
    );
  }

  if (detected !== "application/zip") {
    const extension = attachmentExtension(fileName);
    throw new BadRequestException(
      `"${fileName}" is not an Excel .xlsx file${
        extension ? `. Its name says ${extension} and its contents say otherwise` : ""
      }.`,
    );
  }
}
