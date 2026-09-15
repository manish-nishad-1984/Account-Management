import type { CSSProperties, ReactNode } from "react";
import {
  DOCUMENT_FIELD_LABELS,
  ITEM_COLUMN_LABELS,
  PAGE_DIMENSIONS_MM,
  formatMoney,
  formatPercent,
  formatQuantity,
  type DocumentField,
  type ItemColumn,
  type PrintDocument,
  type PrintLine,
  type TemplateBlock,
  type TemplateLayout,
  type TemplatePage,
} from "@accountmanagement/contracts";
import { money } from "@accountmanagement/domain";
import { formatDate } from "../../../lib/format";

/**
 * Draws a document from a template layout.
 *
 * ONE RENDERER FOR EVERYTHING: the card thumbnails, the preview and the printed
 * page all come from this component, so a template cannot look one way on the
 * screen that lists it and another way on paper.
 *
 * STYLED WITH ITS OWN CSS, NOT TAILWIND. The page is measured in millimetres and
 * points and coloured from the template, none of which is a utility class — and
 * keeping it apart means a change to the app's look can never move something on
 * a printed invoice. The stylesheet is scoped under `.dt-page`.
 */

const FONT_STACKS: Record<TemplateLayout["styles"]["fontFamily"], string> = {
  Inter: '"Inter Variable", "Inter", Arial, sans-serif',
  Arial: "Arial, Helvetica, sans-serif",
  Georgia: 'Georgia, "Times New Roman", serif',
  "Times New Roman": '"Times New Roman", Times, serif',
};

export function pageSizeMm(page: TemplatePage): { width: number; height: number } {
  const { width, height } = PAGE_DIMENSIONS_MM[page.size];
  return page.orientation === "landscape" ? { width: height, height: width } : { width, height };
}

const STYLESHEET = `
.dt-page { box-sizing: border-box; background: #fff; color: var(--dt-text); font-family: var(--dt-font);
  font-size: var(--dt-size); line-height: 1.35; font-variant-numeric: tabular-nums; }
.dt-page *, .dt-page *::before, .dt-page *::after { box-sizing: border-box; }
.dt-row { display: flex; gap: 4mm; margin-bottom: 3mm; }
.dt-row:last-child { margin-bottom: 0; }
.dt-boxed .dt-row { gap: 0; margin: 0; border: 0.75pt solid var(--dt-rule); }
.dt-boxed .dt-row + .dt-row { border-top: 0; }
.dt-col { min-width: 0; display: flex; flex-direction: column; gap: 2.5mm; }
.dt-boxed .dt-col { padding: 1.8mm 2mm; }
.dt-boxed .dt-col + .dt-col { border-left: 0.75pt solid var(--dt-rule); }
.dt-boxed .dt-col:has(> .dt-table-block:only-child) { padding: 0; }
.dt-left { text-align: left; } .dt-center { text-align: center; } .dt-right { text-align: right; }
.dt-muted { color: #6b7280; }
.dt-heading { font-size: 0.78em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dt-accent); margin-bottom: 0.6mm; }
.dt-strong { font-weight: 700; }
.dt-title { font-weight: 800; letter-spacing: 0.08em; font-size: 1.55em; color: var(--dt-primary); }
.dt-title-banner { display: inline-block; background: var(--dt-primary); color: #fff; padding: 1.6mm 6mm; font-size: 1.35em; }
.dt-company-name { font-weight: 800; color: var(--dt-primary); line-height: 1.15; margin-bottom: 0.6mm; }
.dt-fields { display: inline-grid; grid-template-columns: auto auto; column-gap: 4mm; row-gap: 0.4mm; text-align: left; }
.dt-fields dt { color: #4b5563; } .dt-fields dd { margin: 0; font-weight: 600; }
.dt-table { width: 100%; border-collapse: collapse; }
.dt-table th, .dt-table td { padding: var(--dt-pad) 1.6mm; vertical-align: top; }
.dt-table th { font-weight: 700; text-align: left; white-space: nowrap; }
.dt-table .dt-num { text-align: right; white-space: nowrap; }
.dt-table thead { display: table-header-group; }
.dt-table tr { break-inside: avoid; }
.dt-grid th { background: var(--dt-primary); color: #fff; border: 0.75pt solid var(--dt-primary); }
.dt-grid td { border: 0.75pt solid var(--dt-rule); }
.dt-striped th { background: var(--dt-primary); color: #fff; }
.dt-striped tbody tr:nth-child(even) td { background: var(--dt-tint); }
.dt-striped tfoot td { border-top: 1pt solid var(--dt-primary); }
.dt-lines th { color: var(--dt-primary); border-bottom: 1.2pt solid var(--dt-primary); }
.dt-lines td { border-bottom: 0.5pt solid var(--dt-rule); }
.dt-table tfoot td { font-weight: 700; }
.dt-item-desc { color: #6b7280; font-size: 0.9em; }
.dt-totals { margin-left: auto; min-width: 55%; border-collapse: collapse; }
.dt-totals td { padding: 0.5mm 0; } .dt-totals td + td { padding-left: 6mm; text-align: right; white-space: nowrap; }
.dt-totals .dt-grand td { border-top: 1.2pt solid var(--dt-primary); padding-top: 1.2mm; font-weight: 800; font-size: 1.15em; color: var(--dt-primary); }
.dt-words { font-weight: 600; }
/* Fills its column, so the line sits at the bottom with room above it to sign. */
.dt-signature { display: flex; flex-direction: column; flex: 1; min-height: 22mm; }
.dt-signature-foot { margin-top: auto; padding-top: 12mm; }
.dt-signature-line { border-top: 0.75pt solid var(--dt-text); padding-top: 0.8mm; display: inline-block; min-width: 45mm; }
.dt-divider { border: 0; border-top: 1pt solid var(--dt-primary); margin: 0; }
.dt-pre { white-space: pre-wrap; }
`;

/** The stylesheet, once per page that shows documents. Harmless if repeated. */
export function DocumentStyles() {
  return <style>{STYLESHEET}</style>;
}

const m = (value: string) => formatMoney(value);
const rupees = (value: string) => `₹${formatMoney(value)}`;
const isZero = (value: string) => money.isZero(money.decimal(value));

function fieldValue(document: PrintDocument, field: DocumentField): string | null {
  const f = document.fields;
  switch (field) {
    case "number":
      return document.number;
    case "date":
      return document.date ? formatDate(document.date) : null;
    case "invoice-type":
      return document.invoiceType;
    case "party-invoice-no":
      return f.partyInvoiceNo;
    case "purchase-order-no":
      return f.purchaseOrderNo;
    case "challan-no":
      return f.challanNo;
    case "lr-no":
      return f.lrNo;
    case "vehicle-no":
      return f.vehicleNo;
    case "dispatch-by":
      return f.dispatchBy;
    case "payment-terms":
      return f.paymentTerms;
    case "site":
      return f.siteName;
    case "site-group":
      return f.siteGroupName;
    case "contact":
      return [f.contactName, f.contactNumber].filter(Boolean).join(" · ") || null;
  }
}

const NUMERIC_COLUMNS = new Set<ItemColumn>([
  "quantity",
  "rate",
  "discount",
  "discount-percent",
  "taxable",
  "gst-percent",
  "gst-amount",
  "amount",
]);

function cell(line: PrintLine, column: ItemColumn, showDescription: boolean): ReactNode {
  switch (column) {
    case "index":
      return line.lineNumber;
    case "item":
      return (
        <>
          <div>{line.name}</div>
          {showDescription && line.description && <div className="dt-item-desc">{line.description}</div>}
        </>
      );
    case "hsn":
      return line.hsnCode ?? "";
    case "quantity":
      return formatQuantity(line.quantity);
    case "unit":
      return line.unitName;
    case "rate":
      return m(line.unitPrice);
    case "discount":
      return isZero(line.discountPerUnit) ? "" : m(line.discountPerUnit);
    case "discount-percent":
      return isZero(line.discountPercent) ? "" : formatPercent(line.discountPercent);
    case "taxable":
      return m(line.netAmount);
    case "gst-percent":
      return line.gstPercent === null ? "" : formatPercent(line.gstPercent);
    case "gst-amount":
      return m(line.gstAmount);
    case "amount":
      return m(line.lineTotal);
  }
}

function footerCell(document: PrintDocument, column: ItemColumn): ReactNode {
  const t = document.totals;
  switch (column) {
    case "item":
      return "Total";
    case "quantity":
      return formatQuantity(t.totalQuantity);
    case "taxable":
      return m(t.subtotal);
    case "gst-amount":
      return m(t.totalGstAmount);
    case "amount":
      return m(money.format(money.sum(document.lines.map((line) => money.decimal(line.lineTotal)))));
    default:
      return "";
  }
}

function Block({ block, document, styles }: { block: TemplateBlock; document: PrintDocument; styles: TemplateLayout["styles"] }) {
  const tableClass = `dt-table dt-${styles.tableStyle}`;

  switch (block.type) {
    case "title": {
      const text = block.text ?? document.title;
      return (
        <div className={`dt-${block.align}`}>
          <span className={block.variant === "banner" ? "dt-title dt-title-banner" : "dt-title"}>{text}</span>
        </div>
      );
    }

    case "company": {
      const c = document.company;
      const size = { md: "1.3em", lg: "1.65em", xl: "2.1em" }[block.nameSize];
      return (
        <div className={`dt-${block.align}`}>
          <div className="dt-company-name" style={{ fontSize: size }}>{c.name}</div>
          {block.showAddress && c.address && <div>{c.address}</div>}
          {block.showGstin && c.gstNo && <div>GSTIN/UIN: <span className="dt-strong">{c.gstNo}</span></div>}
          {block.showPan && c.panNo && <div>PAN: {c.panNo}</div>}
          {block.showState && c.stateName && (
            <div>State Name: {c.stateName}{c.stateCode ? `, Code: ${c.stateCode}` : ""}</div>
          )}
        </div>
      );
    }

    case "party": {
      const p = document.party;
      return (
        <div>
          {block.heading && <div className="dt-heading">{block.heading}</div>}
          <div className="dt-strong">{p.name}</div>
          {block.showAddress && p.address && <div>{p.address}</div>}
          {block.showGstin && p.gstNo && <div>GSTIN/UIN: <span className="dt-strong">{p.gstNo}</span></div>}
          {block.showState && p.stateName && (
            <div>State Name: {p.stateName}{p.stateCode ? `, Code: ${p.stateCode}` : ""}</div>
          )}
          {block.showContact && (p.mobile || p.email) && (
            <div>{[p.mobile, p.email].filter(Boolean).join(" · ")}</div>
          )}
        </div>
      );
    }

    case "shipping":
      return (
        <div>
          {block.heading && <div className="dt-heading">{block.heading}</div>}
          <div className="dt-strong">{document.party.name}</div>
          <div className="dt-pre">{document.shippingAddress ?? document.party.address ?? ""}</div>
        </div>
      );

    case "document-fields": {
      const rows = block.fields
        .map((field) => [field, fieldValue(document, field)] as const)
        .filter(([, value]) => !block.hideEmpty || (value !== null && value !== ""));
      if (rows.length === 0) return null;
      return (
        <div className={`dt-${block.align}`}>
          <dl className="dt-fields">
            {rows.map(([field, value]) => (
              <div key={field} style={{ display: "contents" }}>
                <dt>{DOCUMENT_FIELD_LABELS[field]}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    }

    case "items-table":
      return (
        <div className="dt-table-block">
          <table className={tableClass}>
            <thead>
              <tr>
                {block.columns.map((column) => (
                  <th key={column} className={NUMERIC_COLUMNS.has(column) ? "dt-num" : undefined}>
                    {ITEM_COLUMN_LABELS[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {document.lines.map((line) => (
                <tr key={line.lineNumber}>
                  {block.columns.map((column) => (
                    <td key={column} className={NUMERIC_COLUMNS.has(column) ? "dt-num" : undefined}>
                      {cell(line, column, block.showDescription)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {block.showTotalRow && (
              <tfoot>
                <tr>
                  {block.columns.map((column) => (
                    <td key={column} className={NUMERIC_COLUMNS.has(column) ? "dt-num" : undefined}>
                      {footerCell(document, column)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      );

    case "tax-summary": {
      const s = document.taxSummary;
      if (s.rows.length === 0) return null;
      const split = block.split;
      const rateHeads =
        split === "cgst-sgst" ? ["Central Tax", "State Tax"] : split === "igst" ? ["Integrated Tax"] : ["GST"];
      return (
        <div className="dt-table-block">
          <table className={tableClass}>
            <thead>
              <tr>
                {block.showHsn && <th rowSpan={2}>HSN/SAC</th>}
                <th rowSpan={2} className="dt-num">Taxable Value</th>
                {rateHeads.map((head) => (
                  <th key={head} colSpan={2} style={{ textAlign: "center" }}>{head}</th>
                ))}
                <th rowSpan={2} className="dt-num">Total Tax</th>
              </tr>
              <tr>
                {rateHeads.map((head) => [
                  <th key={`${head}-r`} className="dt-num">Rate</th>,
                  <th key={`${head}-a`} className="dt-num">Amount</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((row) => (
                <tr key={row.gstPercent}>
                  {block.showHsn && <td>{row.hsnCodes.join(", ")}</td>}
                  <td className="dt-num">{m(row.taxableValue)}</td>
                  {split === "cgst-sgst" ? (
                    <>
                      <td className="dt-num">{formatPercent(row.halfPercent)}</td>
                      <td className="dt-num">{m(row.centralTax)}</td>
                      <td className="dt-num">{formatPercent(row.halfPercent)}</td>
                      <td className="dt-num">{m(row.stateTax)}</td>
                    </>
                  ) : (
                    <>
                      <td className="dt-num">{formatPercent(row.gstPercent)}</td>
                      <td className="dt-num">{m(row.gstAmount)}</td>
                    </>
                  )}
                  <td className="dt-num">{m(row.gstAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                {block.showHsn && <td>Total</td>}
                <td className="dt-num">{m(s.taxableValue)}</td>
                {split === "cgst-sgst" ? (
                  <>
                    <td />
                    <td className="dt-num">{m(s.centralTax)}</td>
                    <td />
                    <td className="dt-num">{m(s.stateTax)}</td>
                  </>
                ) : (
                  <>
                    <td />
                    <td className="dt-num">{m(s.gstAmount)}</td>
                  </>
                )}
                <td className="dt-num">{m(s.gstAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      );
    }

    case "totals": {
      const t = document.totals;
      const s = document.taxSummary;
      const rows: Array<[string, string]> = [];
      for (const key of block.rows) {
        if (key === "subtotal") rows.push(["Taxable amount", t.subtotal]);
        if (key === "discount") rows.push(["Discount", t.totalDiscount]);
        if (key === "gst") rows.push(["GST", t.totalGstAmount]);
        if (key === "cgst-sgst") {
          rows.push(["CGST", s.centralTax]);
          rows.push(["SGST", s.stateTax]);
        }
        if (key === "tds") rows.push(["Less: TDS", t.tds]);
        if (key === "round-off") rows.push(["Round off", t.roundOff]);
      }
      const shown = block.hideZero ? rows.filter(([, value]) => !isZero(value)) : rows;
      return (
        <table className="dt-totals">
          <tbody>
            {shown.map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{m(value)}</td>
              </tr>
            ))}
            <tr className="dt-grand">
              <td>Total</td>
              <td>{rupees(t.totalAmount)}</td>
            </tr>
          </tbody>
        </table>
      );
    }

    case "amount-in-words":
      return (
        <div>
          {block.show !== "tax" && (
            <div>
              <div className="dt-muted">Amount chargeable (in words)</div>
              <div className="dt-words">{document.amountInWords}</div>
            </div>
          )}
          {block.show !== "amount" && (
            <div style={block.show === "both" ? { marginTop: "1.5mm" } : undefined}>
              <div className="dt-muted">Tax amount (in words)</div>
              <div className="dt-words">{document.taxInWords}</div>
            </div>
          )}
        </div>
      );

    case "bank-details": {
      const c = document.company;
      const rows: Array<[string, string | null]> = [
        ["Bank Name", c.bankName],
        ["A/c No", c.accountNo],
        ["Branch", c.bankBranch],
        ["IFSC Code", c.ifscCode],
      ];
      const present = rows.filter(([, value]) => value);
      if (present.length === 0) return null;
      return (
        <div>
          {block.heading && <div className="dt-heading">{block.heading}</div>}
          <dl className="dt-fields">
            {present.map(([label, value]) => (
              <div key={label} style={{ display: "contents" }}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    }

    case "notes":
      if (!document.description) return null;
      return (
        <div>
          {block.heading && <div className="dt-heading">{block.heading}</div>}
          <div className="dt-pre">{document.description}</div>
        </div>
      );

    case "text":
      if (!block.heading && !block.body) return null;
      return (
        <div className={`dt-${block.align}`}>
          {block.heading && <div className="dt-heading">{block.heading}</div>}
          {block.body && <div className="dt-pre">{block.body}</div>}
        </div>
      );

    case "signature":
      return (
        <div className={`dt-signature dt-${block.align}`}>
          {block.showCompany && <div className="dt-strong">for {document.company.name}</div>}
          <div className="dt-signature-foot">
            <span className="dt-signature-line">{block.label}</span>
          </div>
        </div>
      );

    case "divider":
      return <hr className="dt-divider" />;

    case "spacer":
      return <div style={{ height: `${block.heightMm}mm` }} />;
  }
}

/**
 * One document on one sheet.
 *
 * On screen it is a page of the template's size with its margins as padding.
 * In print the margins move to `@page` (see the print page) and the padding is
 * dropped, so a document that runs to a second sheet keeps its margins there
 * too — padding would only apply to the top of the first sheet and the bottom
 * of the last.
 */
export function DocumentRenderer({
  layout,
  document,
  className,
}: {
  layout: TemplateLayout;
  document: PrintDocument;
  className?: string;
}) {
  const { width, height } = pageSizeMm(layout.page);
  const s = layout.styles;
  const style = {
    "--dt-primary": s.primaryColor,
    "--dt-accent": s.accentColor,
    "--dt-text": s.textColor,
    "--dt-rule": s.boxed ? s.textColor : "#d1d5db",
    "--dt-tint": `${s.primaryColor}14`,
    "--dt-font": FONT_STACKS[s.fontFamily],
    "--dt-size": `${s.baseFontSize}pt`,
    "--dt-pad": `${s.tableRowSpacing}px`,
    width: `${width}mm`,
    minHeight: `${height}mm`,
    padding: `${layout.page.marginMm}mm`,
  } as CSSProperties;

  return (
    <div className={`dt-page${s.boxed ? " dt-boxed" : ""}${className ? ` ${className}` : ""}`} style={style}>
      {layout.rows.map((row) => (
        <div key={row.id} className="dt-row">
          {row.columns.map((column) => (
            <div key={column.id} className="dt-col" style={{ flex: `${column.weight} 1 0` }}>
              {column.blocks.map((block) => (
                <Block key={block.id} block={block} document={document} styles={s} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
