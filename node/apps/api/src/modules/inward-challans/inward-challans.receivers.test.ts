import "reflect-metadata";
import { beforeEach, describe, expect, it } from "vitest";
import { receiverLabel } from "@accountmanagement/contracts";
import { InwardChallansRepository } from "./inward-challans.repository";
import { InwardChallansController } from "./inward-challans.controller";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

/**
 * A challan's Receiver, chosen from the site's contacts in the Site master
 * (client request, 15 Sep 2026): "Fetch Name & Contact no. from Site Master.
 * Example: Nikunj-989898988".
 */

describe("receiverLabel", () => {
  it.each([
    ["Nikunj", "989898988", "Nikunj-989898988"],
    [" Nikunj ", " 989898988 ", "Nikunj-989898988"],
    ["Nikunj", null, "Nikunj"],
    [null, "989898988", "989898988"],
    [null, null, ""],
    ["", "  ", ""],
  ])("%j and %j read %j", (name, phone, label) => {
    expect(receiverLabel(name, phone)).toBe(label);
  });
});

describe("InwardChallansRepository.receivers (real PostgreSQL)", () => {
  let db: Database;
  let repo: InwardChallansRepository;
  let siteId: string;
  let otherSiteId: string;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new InwardChallansRepository(db);
    const rows = await db
      .insert(schema.sites)
      .values([{ name: "SURAT-AURO UNIVERSITY" }, { name: "AMIDHARA GROUPS" }])
      .returning({ id: schema.sites.id, name: schema.sites.name });
    siteId = rows.find((row) => row.name === "SURAT-AURO UNIVERSITY")!.id;
    otherSiteId = rows.find((row) => row.name === "AMIDHARA GROUPS")!.id;
  });

  it("lists the site's contacts in the order they were keyed, as Name-Phone", async () => {
    await db.insert(schema.siteContacts).values([
      { siteId, name: "Ramesh", phone: "9825011111", lineNumber: 2 },
      { siteId, name: "Nikunj", phone: "989898988", lineNumber: 1 },
      { siteId, name: null, phone: "9925022222", lineNumber: 3 },
    ]);

    const rows = await repo.receivers(siteId);

    expect(rows.map((row) => row.label)).toEqual(["Nikunj-989898988", "Ramesh-9825011111", "9925022222"]);
  });

  it("does not offer another site's contacts", async () => {
    await db.insert(schema.siteContacts).values([
      { siteId: otherSiteId, name: "Someone", phone: "9000000000", lineNumber: 1 },
    ]);

    expect(await repo.receivers(siteId)).toEqual([]);
  });
});

describe("the receivers route", () => {
  /** Under the challan's own right: a gate clerk need not hold `site.view`. */
  it("asks for inward-challan.view and nothing else", () => {
    const handler = InwardChallansController.prototype.receivers;
    expect(Reflect.getMetadata("permissions", handler)).toEqual(["inward-challan.view"]);
  });
});
