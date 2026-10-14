import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import {
  SITE_LOCATION_ADDRESS_MAX,
  SITE_LOCATION_SHEET_COLUMNS,
  SITE_LOCATION_SHEET_MAX_ROWS,
  type SiteLocationSheetResult,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { siteLocations, sites } from "../../db/schema";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { SpreadsheetError, readWorkbook } from "../../common/spreadsheet/workbook";

type SheetError = SiteLocationSheetResult["errors"][number];

/** Thrown when the file reads but cannot be applied; carries every problem. */
export class SiteLocationSheetRejected extends Error {
  constructor(readonly result: SiteLocationSheetResult) {
    super("The spreadsheet could not be imported.");
  }
}

const norm = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Adds locations to ONE site, and sets their Location Address, from a spreadsheet
 * (client, 14 Oct 2026).
 *
 * ALL OR NOTHING, every problem reported at once, as the other imports do. A name
 * the site already has takes the sheet's address (a blank cell leaves it alone);
 * a new name is added. Nothing is removed.
 */
@Injectable()
export class SiteLocationSheetService extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  async import(bytes: Buffer, siteId: string, actorId: string): Promise<SiteLocationSheetResult> {
    const [site] = await this.db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.isDeleted, false)))
      .limit(1);
    if (!site) throw new BadRequestException("Choose a site first.");

    let sheet;
    try {
      sheet = await readWorkbook(bytes, SITE_LOCATION_SHEET_MAX_ROWS);
    } catch (error) {
      throw new BadRequestException(
        error instanceof SpreadsheetError ? error.message : "The file could not be read.",
      );
    }

    const at = new Map<string, number>();
    sheet.header.forEach((name, i) => at.set(norm(name), i));
    const col = {
      name: at.get(norm("Site location")),
      address: at.get(norm("Location Address")) ?? at.get(norm("Shipping address")),
    };

    const headerErrors: SheetError[] = SITE_LOCATION_SHEET_COLUMNS.filter(
      (c) => c.required && at.get(norm(c.header)) === undefined,
    ).map((c) => ({ row: 1, column: c.header, message: `The column "${c.header}" is missing.` }));
    if (headerErrors.length > 0) {
      throw new SiteLocationSheetRejected({ rowCount: sheet.rows.length, created: 0, updated: 0, errors: headerErrors });
    }

    const cell = (cells: string[], index: number | undefined) => (index === undefined ? "" : (cells[index] ?? "").trim());
    const wanted = sheet.rows
      .map((row) => ({ number: row.number, name: cell(row.cells, col.name), address: cell(row.cells, col.address) }))
      .filter((w) => w.name !== "" || w.address !== "");

    const current = await this.db
      .select({ id: siteLocations.id, name: siteLocations.name, address: siteLocations.address })
      .from(siteLocations)
      .where(and(eq(siteLocations.siteId, siteId), eq(siteLocations.isDeleted, false)));

    const errors: SheetError[] = [];
    const seen = new Map<string, number>();
    const toUpdate: { id: string; address: string }[] = [];
    const toCreate: { name: string; address: string | null }[] = [];

    for (const w of wanted) {
      if (!w.name) {
        errors.push({ row: w.number, column: "Site location", message: "Site location is required." });
        continue;
      }
      if (w.address.length > SITE_LOCATION_ADDRESS_MAX) {
        errors.push({
          row: w.number,
          column: "Location Address",
          message: `Location Address is longer than ${SITE_LOCATION_ADDRESS_MAX} characters.`,
        });
        continue;
      }
      const key = norm(w.name);
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        errors.push({ row: w.number, column: "Site location", message: `"${w.name}" is on row ${earlier} too.` });
        continue;
      }
      seen.set(key, w.number);

      const existing = current.find((l) => norm(l.name) === key);
      if (existing) {
        if (w.address && w.address !== (existing.address ?? "")) toUpdate.push({ id: existing.id, address: w.address });
      } else {
        toCreate.push({ name: w.name, address: w.address || null });
      }
    }

    if (errors.length > 0) {
      throw new SiteLocationSheetRejected({ rowCount: wanted.length, created: 0, updated: 0, errors });
    }

    await this.db.transaction(async (tx) => {
      for (const u of toUpdate) {
        await tx.update(siteLocations).set({ address: u.address, ...updatedBy(actorId) }).where(eq(siteLocations.id, u.id));
      }
      for (const c of toCreate) {
        await tx.insert(siteLocations).values({ siteId, name: c.name, address: c.address, ...createdBy(actorId) });
      }
    });

    return { rowCount: wanted.length, created: toCreate.length, updated: toUpdate.length, errors: [] };
  }
}
