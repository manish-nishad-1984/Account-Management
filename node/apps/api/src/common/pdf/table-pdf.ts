import PDFDocument from "pdfkit";

/**
 * The only place this codebase talks to a PDF library.
 *
 * Everything above it deals in `string[][]`, exactly as
 * `spreadsheet/workbook.ts` does, so the choice of library is one import to
 * change.
 *
 * WHY pdfkit AND NOT WHAT THE LEGACY APP USES.
 *
 * `ReportController.cs` builds its PDFs with **Aspose.Pdf**, which is
 * commercially licensed per developer and per deployment. Carrying that into
 * the port would mean buying a licence to render a table of numbers.
 * `13-Migration-Strategy-and-Roadmap.md` proposed Playwright instead — render
 * the HTML and print it — which works, but puts a ~300 MB Chromium download and
 * a headless browser process on a VPS that is also running the live business.
 * These reports are a header block and one table; pdfkit draws that with a pure
 * JavaScript dependency, no native build, no browser, and no new advisory
 * (checked against `npm audit` on the production dependency tree).
 *
 * WHAT IT COSTS, AND THE TRAP THAT COMES WITH IT.
 *
 * pdfkit's built-in fonts are the 14 PDF standard ones, encoded WinAnsi. The
 * rupee sign U+20B9 is not in that encoding, and pdfkit does NOT fail on it:
 * `widthOfString("₹")` returns **0**, so the glyph is dropped, the text
 * still lays out, and the file looks correct until someone notices the amounts
 * have no symbol. Verified directly before choosing this library.
 *
 * Two consequences, both deliberate:
 *
 * - **Amounts are written without a currency symbol**, as the legacy Excel
 *   exporters also do. The legacy PDF prints one, so this is a visible
 *   difference; it is stated in the document header block instead, where it is
 *   said once rather than on every one of twenty thousand rows.
 * - **Anything the encoding cannot represent becomes a question mark** rather
 *   than vanishing (see `toRenderable`). A visible marker is a bug report; a
 *   silently missing character is a wrong number nobody questions.
 *
 * Embedding a Unicode TrueType font would lift both restrictions, and costs a
 * ~450 KB binary in the repository and in every release tarball. Worth doing
 * the day a report has to print a name this encoding cannot hold; the live
 * database currently holds none.
 */

export interface PdfTableColumn {
  header: string;
  /** Relative width. Scaled to the page, so only the ratios matter. */
  width: number;
  align: "left" | "right";
}

export interface PdfTableDocument {
  /** Shown large at the top of the first page, and in the PDF metadata. */
  title: string;
  /** The filters this report was run with, as label and value pairs. */
  captions: { label: string; value: string }[];
  columns: PdfTableColumn[];
  rows: string[][];
  /** The Total row, drawn in bold on a shaded band. */
  footer?: string[];
  generatedOn: Date;
}

/**
 * Characters the standard fonts can actually draw: ASCII, Latin-1, and the
 * handful of punctuation marks WinAnsi adds above it.
 */
const RENDERABLE =
  /[^\u0020-\u007E\u00A0-\u00FF\u2018\u2019\u201C\u201D\u2013\u2014\u2022\u2026\u20AC]/g;

/**
 * Makes one cell safe to draw.
 *
 * Control characters go first, and they are not hypothetical: four site group
 * names in the live database end with a carriage return, left there by whatever
 * loaded them. HTML collapses that to nothing, which is why it has never been
 * noticed on a screen. In a PDF cell it is a line break in the middle of a
 * table row.
 */
export function toRenderable(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(RENDERABLE, "?")
    .replace(/\s+/g, " ")
    .trim();
}

const PAGE_MARGIN = 24;
const HEADER_FILL = "#1f2937";
const RULE = "#cbd5e1";
const ROW_HEIGHT = 16;
const FONT_SIZE = 8;

/**
 * Renders a title block and one table, paginated, with the header repeated on
 * every page.
 *
 * Always landscape A4. The ledger has eight columns and the summary five;
 * giving them different orientations would mean two layouts to check, and the
 * five-column report reads perfectly well on a wide page.
 */
export async function renderTablePdf(doc: PdfTableDocument): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: PAGE_MARGIN,
    bufferPages: true,
    info: { Title: doc.title, Creator: "Account Book" },
  });

  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => {
    pdf.on("end", () => resolve());
  });

  const left = PAGE_MARGIN;
  const right = pdf.page.width - PAGE_MARGIN;
  const available = right - left;

  const totalWidth = doc.columns.reduce((sum, column) => sum + column.width, 0);
  const widths = doc.columns.map((column) => (column.width / totalWidth) * available);
  const offsets: number[] = [];
  widths.reduce((x, width) => {
    offsets.push(x);
    return x + width;
  }, left);

  const drawRow = (cells: string[], y: number, bold = false): void => {
    pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(FONT_SIZE);
    doc.columns.forEach((column, index) => {
      const text = toRenderable(cells[index] ?? "");
      if (text === "") return;
      pdf.text(text, offsets[index]! + 4, y + 4, {
        width: widths[index]! - 8,
        align: column.align,
        // Without BOTH of these, a long supplier name wraps onto a second line
        // and every column after it on that row is drawn at the wrong height —
        // the table stays upright and the data silently shifts.
        lineBreak: false,
        ellipsis: true,
      });
    });
  };

  const drawHeader = (y: number): number => {
    pdf.rect(left, y, available, ROW_HEIGHT).fill(HEADER_FILL);
    pdf.fillColor("#ffffff");
    drawRow(
      doc.columns.map((column) => column.header),
      y,
      true,
    );
    pdf.fillColor("#000000");
    return y + ROW_HEIGHT;
  };

  const bottom = pdf.page.height - PAGE_MARGIN - ROW_HEIGHT;

  pdf.font("Helvetica-Bold").fontSize(14).text(toRenderable(doc.title), left, PAGE_MARGIN);
  pdf.moveDown(0.3);

  const captionLine = doc.captions
    .filter((caption) => caption.value !== "")
    .map((caption) => `${caption.label}: ${caption.value}`)
    .join("     ");
  pdf.font("Helvetica").fontSize(9).fillColor("#475569");
  if (captionLine !== "") {
    pdf.text(toRenderable(captionLine), left, pdf.y, { width: available });
  }
  pdf.text(
    `Generated ${doc.generatedOn.toISOString().slice(0, 10)}. All amounts in INR.`,
    left,
    pdf.y,
    { width: available },
  );
  pdf.fillColor("#000000");

  let y = pdf.y + 8;
  y = drawHeader(y);

  for (const row of doc.rows) {
    if (y + ROW_HEIGHT > bottom) {
      pdf.addPage();
      y = drawHeader(PAGE_MARGIN);
    }
    drawRow(row, y);
    pdf
      .moveTo(left, y + ROW_HEIGHT)
      .lineTo(right, y + ROW_HEIGHT)
      .strokeColor(RULE)
      .lineWidth(0.4)
      .stroke();
    y += ROW_HEIGHT;
  }

  if (doc.footer) {
    if (y + ROW_HEIGHT > bottom) {
      pdf.addPage();
      y = drawHeader(PAGE_MARGIN);
    }
    pdf.rect(left, y, available, ROW_HEIGHT).fill("#e2e8f0");
    pdf.fillColor("#000000");
    drawRow(doc.footer, y, true);
    y += ROW_HEIGHT;
  }

  // Page numbers, once the total is known. `bufferPages` is what makes "of N"
  // possible at all — without it the first page has already been written by the
  // time the count is known, and every report says "Page 1 of 1".
  const range = pdf.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    pdf.switchToPage(range.start + index);
    pdf
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#64748b")
      .text(`Page ${index + 1} of ${range.count}`, left, pdf.page.height - PAGE_MARGIN - 10, {
        width: available,
        align: "right",
      });
  }
  pdf.flushPages();

  pdf.end();
  await finished;
  return Buffer.concat(chunks);
}
