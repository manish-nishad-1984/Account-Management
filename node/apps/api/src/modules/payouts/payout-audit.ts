import { sql } from "drizzle-orm";
import type { AuditFacts } from "@accountmanagement/contracts";
import type { Database } from "../../db/database";
import { rawRows } from "../../common/raw-rows";
import { auditDate, auditText, type AuditView } from "../../common/audit";

/**
 * A payout list as its history shows it (20 Oct 2026): the header, then one fact
 * per party - its amount and the bills it pays - so a changed amount or a bill
 * added or dropped shows on that party's line. Null when there is no such list.
 */
export async function payoutListView(db: Database, id: string): Promise<AuditView | null> {
  const [head] = rawRows<Record<string, string | null>>(
    await db.execute(sql`
      select l.list_date::text as list_date, l.title, l.budget::text as budget, l.note, l.status,
             c.name as company,
             (select coalesce(sum(pl.amount), 0)::text from payout_list_lines pl where pl.payout_list_id = l.id) as total
      from payout_lists l
      left join companies c on c.id = l.company_id
      where l.id = ${id}
    `),
  );
  if (!head) return null;

  const lines = rawRows<{ party: string; amount: string; bills: string | null }>(
    await db.execute(sql`
      select s.name as party, pl.amount::text as amount,
             (select string_agg(b.display_no || ' ' || b.amount::text ||
                       case when b.paid_amount is not null then ' (paid ' || b.paid_amount::text || ')' else '' end,
                     ', ' order by b.line_number)
                from payout_list_invoices b where b.payout_line_id = pl.id) as bills
      from payout_list_lines pl
      join suppliers s on s.id = pl.party_id
      where pl.payout_list_id = ${id}
      order by pl.line_number
    `),
  );

  const t = (key: string) => auditText(head[key]);
  const facts: AuditFacts = [
    ["Date", auditDate(head.list_date)],
    ["Title", t("title")],
    ["Company", t("company") || "All companies"],
    ["Budget", t("budget")],
    ["Note", t("note")],
    ["Status", head.status === "confirmed" ? "Confirmed" : "Draft"],
    ...lines.map((line): [string, string] => [
      `Party ${line.party}`,
      `${auditText(line.amount)}${line.bills ? ` · bills: ${line.bills}` : ""}`,
    ]),
    ["Total", t("total")],
  ];
  return {
    label: `Payout list ${auditDate(head.list_date)}${head.title ? ` · ${t("title")}` : ""}`,
    facts: facts.filter(([field, value]) => value !== "" || ["Date", "Status"].includes(field)),
  };
}
