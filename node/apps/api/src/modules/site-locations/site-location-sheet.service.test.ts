import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { SiteLocationSheetRejected, SiteLocationSheetService } from "./site-location-sheet.service";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const HEAD = ["Site location", "Location Address"];

async function sheet(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Locations");
  rows.forEach((row) => ws.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("SiteLocationSheetService (real PostgreSQL)", () => {
  let db: Database;
  let service: SiteLocationSheetService;
  let siteId: string;
  let otherSiteId: string;

  const live = async (site: string) =>
    db
      .select({ name: schema.siteLocations.name, address: schema.siteLocations.address })
      .from(schema.siteLocations)
      .where(and(eq(schema.siteLocations.siteId, site), eq(schema.siteLocations.isDeleted, false)))
      .orderBy(schema.siteLocations.name);

  beforeEach(async () => {
    db = await freshDatabase();
    service = new SiteLocationSheetService(db);
    const [site] = await db.insert(schema.sites).values({ name: "Akwada", isActive: true }).returning();
    const [other] = await db.insert(schema.sites).values({ name: "Other", isActive: true }).returning();
    siteId = site!.id;
    otherSiteId = other!.id;
    await db.insert(schema.siteLocations).values({ siteId, name: "Block A", address: "Old address" });
    await db.insert(schema.siteLocations).values({ siteId: otherSiteId, name: "Block A", address: "Other site address" });
  });

  it("sets the address of a location the site has and adds a new one, on that site only", async () => {
    const result = await service.import(
      await sheet([HEAD, ["block  a", "Plot 5, Akwada"], ["Store yard", "Survey 21"]]),
      siteId,
      ACTOR,
    );

    expect(result).toMatchObject({ rowCount: 2, created: 1, updated: 1, errors: [] });
    expect(await live(siteId)).toEqual([
      { name: "Block A", address: "Plot 5, Akwada" },
      { name: "Store yard", address: "Survey 21" },
    ]);
    expect(await live(otherSiteId)).toEqual([{ name: "Block A", address: "Other site address" }]);
  });

  it("leaves an address alone when its cell is blank, and still reads the old 'Shipping address' heading", async () => {
    await service.import(await sheet([HEAD, ["Block A", ""]]), siteId, ACTOR);
    expect(await live(siteId)).toEqual([{ name: "Block A", address: "Old address" }]);

    await service.import(await sheet([["Site location", "Shipping address"], ["Block A", "New one"]]), siteId, ACTOR);
    expect(await live(siteId)).toEqual([{ name: "Block A", address: "New one" }]);
  });

  it("saves nothing and lists every problem when any row is bad", async () => {
    const rejected = await service
      .import(await sheet([HEAD, ["Gate", "Fine"], ["", "No name"], ["Block B", "x"], ["block b", "y"]]), siteId, ACTOR)
      .catch((error) => error);

    expect(rejected).toBeInstanceOf(SiteLocationSheetRejected);
    expect((rejected as SiteLocationSheetRejected).result.errors.map((e) => e.row)).toEqual([3, 5]);
    expect(await live(siteId)).toEqual([{ name: "Block A", address: "Old address" }]);
  });

  it("refuses a file without the Site location column", async () => {
    const rejected = await service.import(await sheet([["Location Address"], ["x"]]), siteId, ACTOR).catch((e) => e);
    expect(rejected).toBeInstanceOf(SiteLocationSheetRejected);
    expect((rejected as SiteLocationSheetRejected).result.errors[0]!.column).toBe("Site location");
  });
});
