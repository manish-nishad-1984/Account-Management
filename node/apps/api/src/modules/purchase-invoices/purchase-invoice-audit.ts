import { sql } from "drizzle-orm";
import type { AuditFacts } from "@accountmanagement/contracts";
import type { Database } from "../../db/database";
import { rawRows } from "../../common/raw-rows";
import { auditDate, auditText, auditYesNo, type AuditView } from "../../common/audit";

/**
 * A purchase invoice as its history shows it (20 Oct 2026): names, not ids, and
 * one fact per line - "Line 2: CEMENT · 10 Bag × 395.00 · GST 18% = 4661.00" - so
 * a changed quantity or rate shows as that line's old and new text.
 *
 * Null when there is no such invoice.
 */
export async function purchaseInvoiceView(db: Database, id: string): Promise<AuditView | null> {
  const [head] = rawRows<Record<string, string | boolean | null>>(
    await db.execute(sql`
      select pi.supplier_invoice_no, pi.invoice_no, pi.invoice_type, pi.document_date::text as document_date,
             sp.name as supplier, c.name as company, s.name as site, sl.name as location, po.po_no,
             pi.challan_no, pi.lr_no, pi.vehicle_no, pi.dispatch_by, pi.payment_terms, pi.description,
             pi.contact_name, pi.contact_number, pi.shipping_address,
             pi.subtotal::text as subtotal, pi.total_discount::text as total_discount,
             pi.total_gst_amount::text as total_gst, pi.tds::text as tds, pi.round_off::text as round_off,
             pi.total_amount::text as total, pi.is_approved
      from purchase_invoices pi
      join suppliers sp on sp.id = pi.supplier_id
      join companies c on c.id = pi.company_id
      left join sites s on s.id = pi.site_id
      left join site_locations sl on sl.id = pi.site_location_id
      left join purchase_orders po on po.id = pi.purchase_order_id
      where pi.id = ${id}
    `),
  );
  if (!head) return null;

  const lines = rawRows<Record<string, string | number | null>>(
    await db.execute(sql`
      select l.line_number, coalesce(i.name, l.item_name, '') as item, l.item_description, u.name as unit,
             l.quantity::text as quantity, regexp_replace(l.unit_price::text, '(\\.\\d\\d)0$', '\\1') as price, l.discount_per_unit::text as discount,
             l.gst_percent::text as gst, l.line_total::text as total
      from purchase_invoice_items l
      join units u on u.id = l.unit_id
      left join items i on i.id = l.item_id
      where l.purchase_invoice_id = ${id}
      order by l.line_number
    `),
  );

  const t = (key: string) => auditText(head[key]);
  const facts: AuditFacts = [
    ["Bill no", t("supplier_invoice_no")],
    ["Our no", t("invoice_no")],
    ["Type", t("invoice_type")],
    ["Date", auditDate(head.document_date as string | null)],
    ["Supplier", t("supplier")],
    ["Company", t("company")],
    ["Site", t("site")],
    ["Location", t("location")],
    ["Location address", t("shipping_address")],
    ["Purchase order", t("po_no")],
    ["Challan no", t("challan_no")],
    ["LR no", t("lr_no")],
    ["Vehicle no", t("vehicle_no")],
    ["Dispatch by", t("dispatch_by")],
    ["Payment terms", t("payment_terms")],
    ["Description", t("description")],
    ["Contact", t("contact_name")],
    ["Contact number", t("contact_number")],
    ...lines.map((line): [string, string] => {
      const discount = Number(line.discount) ? ` − ${line.discount}` : "";
      const gst = line.gst ? ` · GST ${auditText(line.gst)}%` : "";
      const note = line.item_description ? ` (${auditText(line.item_description)})` : "";
      return [
        `Line ${line.line_number}`,
        `${auditText(line.item)}${note} · ${auditText(line.quantity)} ${auditText(line.unit)} × ${auditText(line.price)}${discount}${gst} = ${auditText(line.total)}`,
      ];
    }),
    ["Subtotal", t("subtotal")],
    ["Discount", t("total_discount")],
    ["GST", t("total_gst")],
    ["TDS", t("tds")],
    ["Adjustment", t("round_off")],
    ["Total", t("total")],
    ["Approved", auditYesNo(head.is_approved as boolean)],
  ];

  return {
    label: `Bill ${t("supplier_invoice_no") || t("invoice_no") || "(no number)"} · ${t("supplier")}`,
    facts: facts.filter(([field, value]) => value !== "" || ["Bill no", "Date", "Supplier", "Company", "Total"].includes(field)),
  };
}
