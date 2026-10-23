import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import {
  PAYMENT_IMPORT_COLUMNS,
  PAYMENT_IMPORT_MAX_ROWS,
  createPaymentSchema,
  type CreatePayment,
  type PaymentDirection,
  type PaymentImportPreview,
  type PaymentImportResult,
  type PaymentImportRow,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { companies, payments, siteLocations, sites, suppliers } from "../../db/schema";
import { BaseRepository } from "../../common/base.repository";
import { SpreadsheetError, readWorkbook } from "../../common/spreadsheet/workbook";
import { parseDate } from "../purchase-invoices/purchase-invoice-import.service";
import { PaymentsRepository } from "./payments.repository";

type Err = PaymentImportPreview["errors"][number];
type ColumnKey = (typeof PAYMENT_IMPORT_COLUMNS)[number]["key"];

/** Thrown when the file reads but cannot be imported; carries the whole preview, errors included. */
export class PaymentImportRejected extends Error {
  constructor(readonly preview: PaymentImportPreview) {
    super("The spreadsheet could not be imported.");
  }
}

/** Other ways a heading may be written, besides the one the sample file uses. */
const HEADING_ALIASES: Partial<Record<ColumnKey, string[]>> = {
  party: ["party", "customer", "supplier name", "party name"],
  date: ["payment date"],
  referenceNo: ["reference no.", "reference", "cheque no", "utr"],
  siteLocation: ["location"],
};

const norm = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();
const headerOf = (key: ColumnKey): string => PAYMENT_IMPORT_COLUMNS.find((c) => c.key === key)!.header;
/** A figure as typed in Excel: "₹ 1,23,456.50" reads as 123456.50. */
const figure = (text: string): string => text.replace(/[₹,\s]/g, "");

const toPaise = (value: string): bigint => {
  const negative = value.trimStart().startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return (negative ? -1n : 1n) * (BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2)));
};
const fromPaise = (paise: bigint): string => {
  const sign = paise < 0n ? "-" : "";
  const absolute = paise < 0n ? -paise : paise;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
};

/** One payment as a key, to find it already recorded or twice in the file. */
const paymentKey = (p: { partyId: string; companyId: string; siteId: string | null; date: string; amount: string; referenceNo: string | null }) =>
  [p.partyId, p.companyId, p.siteId ?? "", p.date, fromPaise(toPaise(p.amount)), norm(p.referenceNo ?? "")].join("|");

/**
 * Brings many payments in from a spreadsheet (client, 23 Oct 2026). Two steps
 * over the SAME file, as the invoice import: `preview` checks every row and
 * reports every problem; `import` checks again and records only when there are
 * none AND the count and total are the ones the person verified.
 */
@Injectable()
export class PaymentImportService extends BaseRepository {
  constructor(
    @Inject(DATABASE) database: Database | null,
    private readonly payments: PaymentsRepository,
  ) {
    super(database);
  }

  async preview(bytes: Buffer, direction: PaymentDirection): Promise<PaymentImportPreview> {
    return (await this.analyse(bytes, direction)).preview;
  }

  async import(
    bytes: Buffer,
    direction: PaymentDirection,
    actorId: string,
    verified: { count: number; total: string },
  ): Promise<PaymentImportResult> {
    const { preview, inputs } = await this.analyse(bytes, direction);
    if (preview.errors.length > 0) {
      throw new PaymentImportRejected(preview);
    }
    if (preview.paymentCount !== verified.count || toPaise(preview.total) !== toPaise(figure(verified.total))) {
      throw new BadRequestException(
        `This file is not the one that was checked: it holds ${preview.paymentCount} payments totalling ` +
          `${preview.total}, not ${verified.count} totalling ${verified.total}. Check the file again.`,
      );
    }
    const created = await this.payments.createMany(inputs, actorId);
    return { created, total: preview.total };
  }

  private async analyse(bytes: Buffer, direction: PaymentDirection): Promise<{ preview: PaymentImportPreview; inputs: CreatePayment[] }> {
    let sheet;
    try {
      sheet = await readWorkbook(bytes, PAYMENT_IMPORT_MAX_ROWS);
    } catch (error) {
      throw new BadRequestException(error instanceof SpreadsheetError ? error.message : "The file could not be read.");
    }
    const reject = (errors: Err[]) => ({
      preview: { rowCount: sheet.rows.length, paymentCount: 0, total: "0.00", payments: [], errors },
      inputs: [],
    });

    // ---- headings -------------------------------------------------------------
    const at = new Map<string, number>();
    sheet.header.forEach((name, i) => at.set(norm(name), i));
    const index = {} as Record<ColumnKey, number | undefined>;
    for (const c of PAYMENT_IMPORT_COLUMNS) {
      index[c.key] = at.get(norm(c.header)) ?? HEADING_ALIASES[c.key]?.map((alias) => at.get(alias)).find((i) => i !== undefined);
    }
    const missing = PAYMENT_IMPORT_COLUMNS.filter((c) => c.required && index[c.key] === undefined);
    if (missing.length > 0) {
      return reject(missing.map((c) => ({ row: 1, column: c.header, message: `The column "${c.header}" is missing.` })));
    }

    const errors: Err[] = [];
    const err = (row: number, key: ColumnKey | null, message: string) => errors.push({ row, column: key ? headerOf(key) : null, message });

    // ---- what the names can mean ---------------------------------------------
    const [partyRows, companyRows, siteRows, locationRows] = await Promise.all([
      this.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.isDeleted, false)),
      this.db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.isDeleted, false)),
      this.db.select({ id: sites.id, name: sites.name }).from(sites).where(eq(sites.isDeleted, false)),
      this.db.select({ id: siteLocations.id, siteId: siteLocations.siteId, name: siteLocations.name }).from(siteLocations).where(eq(siteLocations.isDeleted, false)),
    ]);
    const byName = <T extends { name: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) map.set(norm(row.name), [...(map.get(norm(row.name)) ?? []), row]);
      return map;
    };
    const partyBy = byName(partyRows);
    const companyBy = byName(companyRows);
    const siteBy = byName(siteRows);
    const one = <T extends { name: string }>(map: Map<string, T[]>, text: string, row: number, key: ColumnKey, what: string): T | null => {
      const found = map.get(norm(text)) ?? [];
      if (found.length === 1) return found[0]!;
      err(row, key, found.length === 0 ? `${what} "${text}" was not found.` : `${found.length} ${what.toLowerCase()}s are named "${text}"; it cannot tell which.`);
      return null;
    };

    // ---- payments already recorded, to refuse a file imported twice ------------
    const recorded = await this.db
      .select({
        partyId: payments.partyId,
        companyId: payments.companyId,
        siteId: payments.siteId,
        paymentDate: payments.paymentDate,
        amount: payments.amount,
        referenceNo: payments.referenceNo,
      })
      .from(payments)
      .where(and(eq(payments.isDeleted, false), eq(payments.direction, direction), eq(payments.kind, "payment")));
    const already = new Set(
      recorded
        .filter((p) => p.paymentDate !== null)
        .map((p) => paymentKey({ ...p, date: new Date(p.paymentDate!).toISOString().slice(0, 10), amount: String(p.amount) })),
    );
    const inFile = new Map<string, number>();

    // ---- each row -------------------------------------------------------------
    const summaries: PaymentImportRow[] = [];
    const inputs: CreatePayment[] = [];
    let total = 0n;
    for (const row of sheet.rows) {
      const cell = (key: ColumnKey) => {
        const i = index[key];
        return i === undefined ? "" : (row.cells[i] ?? "").trim();
      };
      const before = errors.length;
      const dateText = cell("date");
      const date = dateText ? parseDate(dateText) : null;
      if (!dateText) err(row.number, "date", "Date is required.");
      else if (!date) err(row.number, "date", `"${dateText}" is not a date. Write it as dd-mm-yyyy.`);

      const partyText = cell("party");
      const party = partyText ? one(partyBy, partyText, row.number, "party", "Supplier") : (err(row.number, "party", "Supplier is required."), null);
      const companyText = cell("company");
      const company = companyText ? one(companyBy, companyText, row.number, "company", "Company") : (err(row.number, "company", "Company is required."), null);
      const siteText = cell("site");
      const site = siteText ? one(siteBy, siteText, row.number, "site", "Site") : (err(row.number, "site", "Site is required."), null);

      let siteLocationId: string | null = null;
      const locationText = cell("siteLocation");
      if (locationText && site) {
        const hit = locationRows.filter((l) => l.siteId === site.id && norm(l.name) === norm(locationText));
        if (hit.length === 1) siteLocationId = hit[0]!.id;
        else err(row.number, "siteLocation", hit.length === 0 ? `"${locationText}" is not a location of site "${site.name}".` : `Site "${site.name}" has ${hit.length} locations named "${locationText}".`);
      }

      const amountText = figure(cell("amount"));
      if (!amountText) err(row.number, "amount", "Amount is required.");

      const candidate = {
        direction,
        kind: "payment" as const,
        partyId: party?.id,
        companyId: company?.id,
        siteId: site?.id ?? null,
        siteLocationId,
        paymentDate: date ? `${date}T00:00:00.000Z` : null,
        amount: amountText,
        method: cell("method"),
        referenceNo: cell("referenceNo"),
        description: cell("description"),
      };
      if (errors.length === before) {
        // The same rules as the Record payments form.
        const parsed = createPaymentSchema.safeParse(candidate);
        if (!parsed.success) {
          // An import names no bills, so the bills rule says nothing a row can fix.
          for (const issue of parsed.error.issues.filter((one) => one.path[0] !== "allocations")) {
            const field = String(issue.path[0] ?? "");
            const key = (["amount", "method", "referenceNo", "description"] as const).find((k) => k === field) ?? null;
            err(row.number, key, issue.message);
          }
        } else {
          const key = paymentKey({ partyId: parsed.data.partyId, companyId: parsed.data.companyId, siteId: parsed.data.siteId, date: date!, amount: parsed.data.amount, referenceNo: parsed.data.referenceNo });
          if (already.has(key)) {
            err(row.number, null, "This payment is already recorded (same supplier, company, site, date, amount and reference).");
          } else if (inFile.has(key)) {
            err(row.number, null, `The same payment is on row ${inFile.get(key)} too.`);
          } else {
            inFile.set(key, row.number);
            inputs.push(parsed.data);
            total += toPaise(parsed.data.amount);
          }
        }
      }
      summaries.push({
        row: row.number,
        date,
        party: party?.name ?? partyText,
        company: company?.name ?? companyText,
        site: site?.name ?? siteText,
        amount: amountText,
        method: cell("method") || null,
        referenceNo: cell("referenceNo") || null,
      });
    }

    if (sheet.rows.length === 0) err(0, null, "The sheet has no payments under the headings.");
    return {
      preview: { rowCount: sheet.rows.length, paymentCount: inputs.length, total: fromPaise(total), payments: summaries, errors },
      inputs,
    };
  }
}
