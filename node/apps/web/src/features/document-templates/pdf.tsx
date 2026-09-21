import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { PrintDocument, TemplateLayout } from "@accountmanagement/contracts";
import { DocumentRenderer, DocumentStyles, pageSizeMm } from "./render/DocumentRenderer";

/**
 * A document, saved as a PDF file without the print dialog (client request,
 * 18 Sep 2026: "PDF apne aap download ho").
 *
 * MADE IN THE BROWSER, NOT ON THE SERVER. The VPS also carries the live
 * business, and a server-side PDF means a headless Chromium there — hundreds of
 * megabytes and a memory spike per document. The browser can already draw the
 * document; this draws it once more off screen, photographs it and pages it.
 *
 * WHAT THAT COSTS, stated so nobody is surprised by it: each page is an IMAGE of
 * the document, so its text cannot be selected or searched in a PDF reader. The
 * print page's "Print" still goes through the browser's dialog, whose Save as
 * PDF keeps the text.
 *
 * BOTH LIBRARIES ARE LOADED ON THE FIRST CLICK, not with the app: together they
 * are larger than half the application, and most sessions never save a PDF.
 * `html2canvas-pro` rather than `html2canvas` because the original cannot read
 * the oklch() colours Tailwind 4 writes, and throws on the first one it meets.
 */

/** Rendered at twice CSS resolution — about 190 dpi on A4, sharp when printed. */
const SCALE = 2;

/** "TAX INVOICE" + "DHP/26-27/0042" -> "Tax Invoice DHP-26-27-0042.pdf". */
export function pdfFileName(document: Pick<PrintDocument, "title" | "number">): string {
  const title = document.title.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  // Every document number here has slashes, which are path separators in a file name.
  const safe = `${title} ${document.number}`
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${safe}.pdf`;
}

/**
 * Where to cut the image into pages: under a table row or a layout row, never
 * through a line of text.
 *
 * `edges` are the bottoms of everything it is safe to cut under, in the same
 * pixels as `total`. Each page takes the lowest safe edge that still fits; a
 * single row taller than a page is cut where the page ends, because there is no
 * better place. Returns the bottom of each page, the last being `total`.
 *
 * A LAST PAGE OF A FEW LINES IS FOLDED INTO THE ONE BEFORE, when what is left is
 * no more than `SQUEEZE` of a page: the first 60-line order saved put its
 * one-line footer alone on page 3. That page is then drawn a few percent
 * smaller to fit (see `saveDocumentPdf`), which nobody can see; an extra page
 * with one line on it everybody can.
 */
export function pageBreaks(edges: number[], total: number, pageHeight: number): number[] {
  const sorted = [...new Set(edges.map((edge) => Math.round(edge)))].sort((a, b) => a - b);
  const cuts: number[] = [];
  let top = 0;
  while (total - top > pageHeight) {
    const limit = top + pageHeight;
    // A cut in the top fifth of a page would leave that page nearly empty.
    const fits = sorted.filter((edge) => edge > top + pageHeight * 0.2 && edge <= limit);
    const cut = fits.length > 0 ? fits[fits.length - 1]! : limit;
    cuts.push(cut);
    top = cut;
  }
  cuts.push(total);

  const previous = cuts.length >= 2 ? cuts[cuts.length - 2]! : 0;
  const before = cuts.length >= 3 ? cuts[cuts.length - 3]! : 0;
  if (cuts.length >= 2 && total - previous <= pageHeight * SQUEEZE && total - before <= pageHeight * (1 + SQUEEZE)) {
    cuts.splice(cuts.length - 2, 1);
  }
  return cuts;
}

/** How much a page may shrink to take in a short last page. */
const SQUEEZE = 0.05;

/**
 * What the photographed copy changes, and nothing on screen or on paper does.
 *
 * The margins, as above. And the table rules: html2canvas draws a collapsed
 * border once per cell, at each cell's own edge, so every ruled table came out
 * with doubled lines and white gaps between its cells — seen in the first PDF
 * saved, 18 Sep 2026. Separate borders drawn only on each cell's right and
 * bottom, with the first column's left and the first row's top, draw every line
 * exactly once, which it renders faithfully.
 */
const PDF_OVERRIDES = (contentWidthMm: number) => `
.dt-pdf .dt-page { padding: 0 !important; min-height: 0 !important; width: ${contentWidthMm}mm !important; }
.dt-pdf .dt-table { border-collapse: separate; border-spacing: 0; }
.dt-pdf .dt-grid th, .dt-pdf .dt-grid td { border-width: 0 0.75pt 0.75pt 0; }
.dt-pdf .dt-grid tr > :first-child { border-left-width: 0.75pt; }
.dt-pdf .dt-grid thead tr:first-child > * { border-top-width: 0.75pt; }
`;

/**
 * Draw `document` with `layout` off screen, as the CONTENT of a page — no
 * margins, and narrowed by them — and hand back the sheet and a way to remove it.
 *
 * The margins are not photographed: every PDF page puts them back, so the second
 * page of a long invoice has a top margin too, which the on-screen sheet's
 * padding would only give the first.
 *
 * Off screen by position, not by `visibility` or `opacity`: the photograph is of
 * what the element looks like, and a hidden element photographs as nothing.
 */
function drawOffScreen(layout: TemplateLayout, document: PrintDocument, contentWidthMm: number) {
  const host = window.document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:absolute;left:-100000px;top:0;pointer-events:none;";
  window.document.body.appendChild(host);

  const root = createRoot(host);
  flushSync(() => {
    root.render(
      <>
        <DocumentStyles />
        <style>{PDF_OVERRIDES(contentWidthMm)}</style>
        <div className="dt-pdf">
          <DocumentRenderer layout={layout} document={document} />
        </div>
      </>,
    );
  });

  const sheet = host.querySelector<HTMLElement>(".dt-page");
  if (!sheet) throw new Error("The document could not be drawn.");
  return {
    sheet,
    remove: () => {
      root.unmount();
      host.remove();
    },
  };
}

/** Draw, photograph, page and save one document. Resolves once the file is handed to the browser. */
export async function saveDocumentPdf(layout: TemplateLayout, document: PrintDocument): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);

  const size = pageSizeMm(layout.page);
  const margin = layout.page.marginMm;
  const contentWidthMm = size.width - 2 * margin;
  const contentHeightMm = size.height - 2 * margin;
  const orientation = size.width > size.height ? "landscape" : "portrait";

  const { sheet, remove } = drawOffScreen(layout, document, contentWidthMm);
  try {
    await window.document.fonts?.ready;

    const origin = sheet.getBoundingClientRect();
    const edges = [...sheet.querySelectorAll(".dt-row, tr")].map(
      (node) => node.getBoundingClientRect().bottom - origin.top,
    );
    const pxPerMm = origin.width / contentWidthMm;
    const cuts = pageBreaks(edges, origin.height, contentHeightMm * pxPerMm);

    const canvas = await html2canvas(sheet, { scale: SCALE, backgroundColor: "#ffffff", logging: false });
    // The canvas is SCALE times the CSS pixels, give or take its own rounding.
    const ratio = canvas.height / origin.height;

    const pdf = new jsPDF({ unit: "mm", format: [size.width, size.height], orientation, compress: true });
    const fileName = pdfFileName(document);
    pdf.setProperties({ title: fileName.replace(/\.pdf$/, "") });

    let top = 0;
    cuts.forEach((cut, index) => {
      const slice = window.document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = Math.max(1, Math.round((cut - top) * ratio));
      const context = slice.getContext("2d");
      if (!context) throw new Error("This browser cannot draw the PDF.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, slice.width, slice.height);
      context.drawImage(canvas, 0, -Math.round(top * ratio));

      if (index > 0) pdf.addPage([size.width, size.height], orientation);
      // Only a page that took in a short last page is taller than the space; it
      // is drawn that little bit smaller, centred, rather than into the margin.
      const heightMm = (cut - top) / pxPerMm;
      const fit = Math.min(1, contentHeightMm / heightMm);
      const widthMm = contentWidthMm * fit;
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margin + (contentWidthMm - widthMm) / 2, margin, widthMm, heightMm * fit);
      top = cut;
    });

    pdf.save(fileName);
  } finally {
    remove();
  }
}
