import { sql } from "drizzle-orm";
import type { AuditFacts } from "@accountmanagement/contracts";
import type { Database } from "../../db/database";
import { rawRows } from "../../common/raw-rows";
import { auditDate, auditText, type AuditView } from "../../common/audit";

/**
 * A payment as its history shows it (20 Oct 2026), with each bill it settles as a
 * fact of its own - "Settles bill 1: 1416.00" - so cutting what it settles shows.
 * Null when there is no such payment.
 */
export async function paymentView(db: Database, id: string): Promise<AuditView | null> {
  const [head] = rawRows<Record<string, string | null>>(
    await db.execute(sql`
      select p.kind, p.direction, p.payment_date::text as payment_date, p.amount::text as amount,
             p.method, p.reference_no, p.description, sp.name as party, c.name as company,
             s.name as site, sl.name as location
      from payments p
      join suppliers sp on sp.id = p.party_id
      join companies c on c.id = p.company_id
      left join sites s on s.id = p.site_id
      left join site_locations sl on sl.id = p.site_location_id
      where p.id = ${id}
    `),
  );
  if (!head) return null;

  const settles = rawRows<{ no: string | null; amount: string }>(
    await db.execute(sql`
      select coalesce(nullif(btrim(pi.supplier_invoice_no), ''), nullif(btrim(si.sales_invoice_no), ''), ob.reference_no, 'opening balance') as no,
             a.amount::text as amount
      from payment_allocations a
      left join purchase_invoices pi on a.document_kind = 'invoice' and pi.id::text = a.document_id::text
      left join sales_invoices si on a.document_kind = 'invoice' and si.id::text = a.document_id::text
      left join payments ob on a.document_kind = 'opening_balance' and ob.id::text = a.document_id::text
      where a.payment_id = ${id}
      order by coalesce(pi.document_date, si.document_date, ob.payment_date), a.id
    `),
  );

  const t = (key: string) => auditText(head[key]);
  const what = head.kind === "opening_balance" ? "Opening balance" : head.direction === "in" ? "Receipt" : "Payment";
  const facts: AuditFacts = [
    ["Type", what],
    ["Party", t("party")],
    ["Company", t("company")],
    ["Site", t("site")],
    ["Location", t("location")],
    ["Date", auditDate(head.payment_date)],
    ["Amount", t("amount")],
    ["Method", t("method")],
    ["Reference no", t("reference_no")],
    ["Description", t("description")],
    ...settles.map((one): [string, string] => [`Settles bill ${auditText(one.no)}`, auditText(one.amount)]),
  ];
  return {
    label: `${what} ${t("amount")} · ${t("party")}${head.payment_date ? ` · ${auditDate(head.payment_date)}` : ""}`,
    facts: facts.filter(([field, value]) => value !== "" || ["Party", "Amount", "Date"].includes(field)),
  };
}
