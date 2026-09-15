import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SitesRepository } from "./sites.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

/**
 * THE DELIVERY ADDRESSES OF A SITE.
 *
 * `SiteAddress` came across with the import — 24 rows — and nothing in this
 * application could read or add to it until now. The business asked for a site
 * to carry several addresses and for a document to pick one of them.
 */

describe("site addresses (real PostgreSQL)", () => {
  let db: Database;
  let repo: SitesRepository;
  let siteId: string;
  let otherSiteId: string;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new SitesRepository(db);

    const [site, other] = await db
      .insert(schema.sites)
      .values([
        {
          name: "Surat Riverfront",
          address: "Plot 14, Ring Road, Surat 395002",
          shippingAddress: "Gate 3, Ring Road, Surat 395002",
        },
        { name: "Valsad Depot", address: "NH 48, Valsad 396001" },
      ])
      .returning({ id: schema.sites.id });

    siteId = site!.id;
    otherSiteId = other!.id;
  });

  describe("listing", () => {
    it("is empty for a site nobody has added one to", async () => {
      expect(await repo.listAddresses(siteId)).toEqual([]);
    });

    it("returns them in the order they were added", async () => {
      await repo.addAddress(siteId, { address: "Warehouse B, Sachin GIDC" });
      await repo.addAddress(siteId, { address: "Site office, Gate 2" });

      expect((await repo.listAddresses(siteId)).map((a) => a.address)).toEqual([
        "Warehouse B, Sachin GIDC",
        "Site office, Gate 2",
      ]);
    });

    it("shows only the addresses of the site asked for", async () => {
      await repo.addAddress(siteId, { address: "Warehouse B, Sachin GIDC" });
      await repo.addAddress(otherSiteId, { address: "Somewhere else entirely" });

      expect((await repo.listAddresses(siteId)).map((a) => a.address)).toEqual([
        "Warehouse B, Sachin GIDC",
      ]);
    });

    /** A wrong id must not read as a site that simply has no addresses. */
    it("refuses a site that does not exist", async () => {
      await expect(
        repo.listAddresses("00000000-0000-0000-0000-000000000000"),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("editing", () => {
    it("changes the text", async () => {
      const created = await repo.addAddress(siteId, { address: "Gate 2" });
      const updated = await repo.updateAddress(siteId, created.id, {
        address: "Gate 2, behind the weighbridge",
      });

      expect(updated.address).toBe("Gate 2, behind the weighbridge");
      expect(updated.id).toBe(created.id);
    });

    /**
     * THE ID IS A SMALL INTEGER, so guessing one is not a feat. Without the site
     * in the WHERE clause, anyone who can edit one site could edit any address
     * in the database by number.
     */
    it("will not edit an address belonging to another site", async () => {
      const theirs = await repo.addAddress(otherSiteId, { address: "Their yard" });

      await expect(
        repo.updateAddress(siteId, theirs.id, { address: "Mine now" }),
      ).rejects.toThrow(/not found/i);

      expect((await repo.listAddresses(otherSiteId))[0]!.address).toBe("Their yard");
    });
  });

  describe("deleting", () => {
    it("takes it off the list", async () => {
      const created = await repo.addAddress(siteId, { address: "Gate 2" });
      await repo.removeAddress(siteId, created.id);

      expect(await repo.listAddresses(siteId)).toEqual([]);
    });

    /** Soft, like every other delete here. */
    it("keeps the row, marked deleted", async () => {
      const created = await repo.addAddress(siteId, { address: "Gate 2" });
      await repo.removeAddress(siteId, created.id);

      const rows = await db.select().from(schema.siteAddresses);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.isDeleted).toBe(true);
    });

    it("will not delete an address belonging to another site", async () => {
      const theirs = await repo.addAddress(otherSiteId, { address: "Their yard" });

      await expect(repo.removeAddress(siteId, theirs.id)).rejects.toThrow(/not found/i);
      expect(await repo.listAddresses(otherSiteId)).toHaveLength(1);
    });

    it("refuses to delete the same address twice", async () => {
      const created = await repo.addAddress(siteId, { address: "Gate 2" });
      await repo.removeAddress(siteId, created.id);

      await expect(repo.removeAddress(siteId, created.id)).rejects.toThrow(/not found/i);
    });
  });

  describe("what a document form is offered", () => {
    const choicesFor = async (id: string) => (await repo.documentOptions(id)).shippingAddresses;

    it("leads with the site's own address", async () => {
      const choices = await choicesFor(siteId);

      expect(choices[0]).toMatchObject({
        source: "site",
        address: "Plot 14, Ring Road, Surat 395002",
      });
    });

    it("includes the shipping address, then the extra ones, then the location addresses", async () => {
      await repo.addAddress(siteId, { address: "Warehouse B, Sachin GIDC" });
      await db
        .insert(schema.siteLocationAddresses)
        .values({ siteId, address: "Block A gate, Ring Road", lineNumber: 1 });
      const choices = await choicesFor(siteId);

      expect(choices.map((c) => c.source)).toEqual(["site", "site-shipping", "extra", "location"]);
      expect(choices.at(-1)!.address).toBe("Block A gate, Ring Road");
    });

    it("offers nothing for an address the site has left blank", async () => {
      const choices = await choicesFor(otherSiteId);

      expect(choices).toHaveLength(1);
      expect(choices[0]!.source).toBe("site");
    });

    /** The business rule: billing is the site's own address, and only that. */
    it("gives the site's own address as the billing address", async () => {
      expect((await repo.documentOptions(siteId)).billingAddress).toBe(
        "Plot 14, Ring Road, Surat 395002",
      );
    });

    it("lists the site's live locations by name, and no other site's", async () => {
      await db.insert(schema.siteLocations).values([
        { siteId, name: "Store yard" },
        { siteId, name: "Block A" },
        { siteId, name: "Gone", isDeleted: true },
        { siteId: otherSiteId, name: "Theirs" },
      ]);

      const { locations } = await repo.documentOptions(siteId);
      expect(locations.map((l) => l.name)).toEqual(["Block A", "Store yard"]);
    });

    it("lists the site's contacts in the Site master's order, and no other site's", async () => {
      await db.insert(schema.siteContacts).values([
        { siteId, name: "Suresh", phone: "9824000002", lineNumber: 2 },
        { siteId, name: "Ramesh", phone: "9824000001", lineNumber: 1 },
        { siteId, name: null, phone: "0261 2400000", lineNumber: 3 },
        { siteId: otherSiteId, name: "Theirs", phone: "9999999999", lineNumber: 1 },
      ]);

      const { contacts } = await repo.documentOptions(siteId);
      expect(contacts.map(({ name, phone }) => ({ name, phone }))).toEqual([
        { name: "Ramesh", phone: "9824000001" },
        { name: "Suresh", phone: "9824000002" },
        { name: null, phone: "0261 2400000" },
      ]);
    });

    /**
     * Several live sites have a shipping address that is a copy of the billing
     * one. Offered twice, the list asks the reader to choose between two
     * identical lines and tells them nothing about which is which.
     */
    it("offers a repeated address only once", async () => {
      await db
        .update(schema.sites)
        .set({ shippingAddress: "Plot 14, Ring Road, Surat 395002" })
        .where(eq(schema.sites.id, siteId));

      const choices = await choicesFor(siteId);
      expect(choices).toHaveLength(1);
    });

    it("does not offer one that was deleted", async () => {
      const created = await repo.addAddress(siteId, { address: "Gate 2" });
      await repo.removeAddress(siteId, created.id);

      const choices = await choicesFor(siteId);
      expect(choices.map((c) => c.address)).not.toContain("Gate 2");
    });

    it("gives each choice a key that is stable within the site", async () => {
      const created = await repo.addAddress(siteId, { address: "Gate 2" });
      const choices = await choicesFor(siteId);

      expect(choices.map((c) => c.key)).toEqual([
        "site",
        "site-shipping",
        `extra-${created.id}`,
      ]);
    });
  });
});
