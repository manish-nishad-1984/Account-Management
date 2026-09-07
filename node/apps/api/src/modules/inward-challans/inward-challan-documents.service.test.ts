import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInwardChallanSchema } from "@accountmanagement/contracts";
import { InwardChallanDocumentsService } from "./inward-challan-documents.service";
import { InwardChallansRepository } from "./inward-challans.repository";
import { LocalDiskStorage } from "../../common/storage/local-disk.storage";
import type { DocumentStorage } from "../../common/storage/document-storage";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const MISSING = "99999999-9999-9999-9999-999999999999";

const PDF = Buffer.from("%PDF-1.7\nchallan scan\n", "binary");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const HTML = Buffer.from("<script>alert(1)</script>", "utf8");

const upload = (fileName: string, bytes: Buffer) => ({ fileName, bytes });

describe("InwardChallanDocumentsService", () => {
  let db: Database;
  let repo: InwardChallansRepository;
  let storage: LocalDiskStorage;
  let service: InwardChallanDocumentsService;
  let root: string;
  let challanId: string;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new InwardChallansRepository(db);
    root = await mkdtemp(join(tmpdir(), "challan-docs-"));
    storage = new LocalDiskStorage(root);
    service = new InwardChallanDocumentsService(repo, storage);

    const [unit] = await db
      .insert(schema.units)
      .values({ name: "Nos" })
      .returning({ id: schema.units.id });
    const [item] = await db
      .insert(schema.items)
      .values({ name: "FLY ASH BRICKS", unitId: unit!.id, pricePerUnit: "8.00" })
      .returning({ id: schema.items.id });
    const [site] = await db
      .insert(schema.sites)
      .values({ name: "SURAT-AURO UNIVERSITY" })
      .returning({ id: schema.sites.id });

    const challan = await repo.create(
      createInwardChallanSchema.parse({
        siteId: site!.id,
        itemId: item!.id,
        unitId: unit!.id,
        quantity: "4000.00",
      }),
      ACTOR,
    );
    challanId = challan.id;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("attaching", () => {
    it("stores the bytes and records the row", async () => {
      await service.attach(challanId, [upload("weighbridge slip.pdf", PDF)], ACTOR);

      const detail = await repo.findById(challanId);
      expect(detail.documents).toHaveLength(1);
      expect(detail.documents[0]).toMatchObject({
        documentName: "weighbridge slip.pdf",
        contentType: "application/pdf",
        sizeBytes: PDF.byteLength,
        isDownloadable: true,
      });
    });

    it("reads back exactly what was uploaded", async () => {
      await service.attach(challanId, [upload("scan.pdf", PDF)], ACTOR);
      const [document] = (await repo.findById(challanId)).documents;

      const file = await service.read(challanId, document!.id);
      expect(file.bytes).toEqual(PDF);
      expect(file.contentType).toBe("application/pdf");
      expect(file.documentName).toBe("scan.pdf");
    });

    it("takes several files at once", async () => {
      await service.attach(
        challanId,
        [upload("a.pdf", PDF), upload("b.png", PNG), upload("c.pdf", PDF)],
        ACTOR,
      );
      expect((await repo.findById(challanId)).documents).toHaveLength(3);
    });

    it("keeps two files of the same name apart", async () => {
      // The legacy single-file path wrote `wwwroot/Content/InWordDocument/<name>`
      // with FileMode.Create, so the second upload of `invoice.pdf` destroyed the
      // first and the earlier challan then showed the later one's document.
      // Same name, different contents — two suppliers, two invoices.
      const raju = Buffer.from("%PDF-1.7\nRAJU M PATEL-CARTING 922\n", "binary");
      const raghu = Buffer.from("%PDF-1.7\nRAGHUNADAN CARTING 253-1\n", "binary");

      await service.attach(challanId, [upload("invoice.pdf", raju)], ACTOR);
      await service.attach(challanId, [upload("invoice.pdf", raghu)], ACTOR);

      const documents = (await repo.findById(challanId)).documents;
      expect(documents).toHaveLength(2);

      const [first, second] = await Promise.all(
        documents.map((d) => service.read(challanId, d.id)),
      );
      expect(first!.bytes).toEqual(raju);
      expect(second!.bytes).toEqual(raghu);
    });

    it("refuses a challan that does not exist, before writing anything", async () => {
      await expect(service.attach(MISSING, [upload("a.pdf", PDF)], ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(await readdir(root)).toEqual([]);
    });

    it("refuses a challan that has been deleted", async () => {
      await repo.remove(challanId, ACTOR);
      await expect(
        service.attach(challanId, [upload("a.pdf", PDF)], ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    describe("refusing a file", () => {
      it("refuses a type that is not on the allowlist", async () => {
        await expect(
          service.attach(challanId, [upload("page.html", HTML)], ACTOR),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("refuses HTML renamed to .pdf", async () => {
        await expect(
          service.attach(challanId, [upload("invoice.pdf", HTML)], ACTOR),
        ).rejects.toThrow(/is not a PDF/);
      });

      it("refuses an empty file", async () => {
        await expect(
          service.attach(challanId, [upload("empty.pdf", Buffer.alloc(0))], ACTOR),
        ).rejects.toThrow(/is empty/);
      });

      it("refuses one over the size limit, naming it", async () => {
        const huge = Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024)]);
        await expect(service.attach(challanId, [upload("big.pdf", huge)], ACTOR)).rejects.toThrow(
          /"big\.pdf" is 11\.0 MB\. The limit is 10\.0 MB\./,
        );
      });

      it("refuses more files than the per-request cap", async () => {
        const many = Array.from({ length: 11 }, (_, i) => upload(`f${i}.pdf`, PDF));
        await expect(service.attach(challanId, many, ACTOR)).rejects.toThrow(/At most 10 files/);
      });

      /**
       * The reason validation happens for EVERY file before ANY is written: a
       * partial success leaves the user to retry and collect duplicates of the
       * files that did get through.
       */
      it("writes nothing at all when one file of several is bad", async () => {
        await expect(
          service.attach(
            challanId,
            [upload("good.pdf", PDF), upload("bad.html", HTML), upload("also-good.png", PNG)],
            ACTOR,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect((await repo.findById(challanId)).documents).toHaveLength(0);
        expect(await readdir(root)).toEqual([]);
      });
    });

    /** Finding H-10: the legacy destination was built from this exact string. */
    it("cannot be steered anywhere by the file name", async () => {
      await service.attach(challanId, [upload("../../../etc/passwd.pdf", PDF)], ACTOR);

      const [document] = (await repo.findById(challanId)).documents;
      // The name is kept as DATA — with its directory components removed.
      expect(document!.documentName).toBe("passwd.pdf");
      // And the file landed under this challan's own prefix, not up the tree.
      const prefix = await readdir(join(root, "inward-challans"));
      expect(prefix).toEqual([challanId]);
    });

    /**
     * If a write fails part way, the bytes already down are removed. A blob with
     * no row pointing at it is invisible, and invisible waste is never reclaimed.
     */
    it("removes what it already wrote when a later write fails", async () => {
      let calls = 0;
      const failing: DocumentStorage = {
        put: async (key, bytes) => {
          if (++calls === 2) throw new Error("disk full");
          return storage.put(key, bytes);
        },
        get: (key) => storage.get(key),
        remove: (key) => storage.remove(key),
        exists: (key) => storage.exists(key),
      };
      const flaky = new InwardChallanDocumentsService(repo, failing);

      await expect(
        flaky.attach(challanId, [upload("a.pdf", PDF), upload("b.pdf", PDF)], ACTOR),
      ).rejects.toThrow("disk full");

      expect((await repo.findById(challanId)).documents).toHaveLength(0);
      const written = await readdir(join(root, "inward-challans", challanId)).catch(() => []);
      expect(written).toEqual([]);
    });
  });

  describe("downloading", () => {
    it("refuses to find a document through another challan", async () => {
      await service.attach(challanId, [upload("a.pdf", PDF)], ACTOR);
      const [document] = (await repo.findById(challanId)).documents;

      const [otherSite] = await db
        .insert(schema.sites)
        .values({ name: "Riverfront" })
        .returning({ id: schema.sites.id });
      const [item] = await db.select({ id: schema.items.id }).from(schema.items);
      const [unit] = await db.select({ id: schema.units.id }).from(schema.units);

      const other = await repo.create(
        createInwardChallanSchema.parse({
          siteId: otherSite!.id,
          itemId: item!.id,
          unitId: unit!.id,
          quantity: "1.00",
        }),
        ACTOR,
      );

      // Holding a document id must not be enough. Both halves of the path are
      // in the query, so this is the IDOR that does not happen.
      await expect(service.read(other.id, document!.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("says so plainly when the file was left on the old server", async () => {
      // What every ETL row looks like: a name and no storage key.
      await db
        .insert(schema.inwardChallanDocuments)
        .values({ challanId, documentName: "old-scan.jpg" });
      const [document] = (await repo.findById(challanId)).documents;

      await expect(service.read(challanId, document!.id)).rejects.toThrow(
        /recorded by the old system/,
      );
    });

    it("does not pretend a row with missing bytes is fine", async () => {
      await service.attach(challanId, [upload("a.pdf", PDF)], ACTOR);
      const [document] = (await repo.findById(challanId)).documents;

      // Delete the bytes behind the application's back — a restore that missed
      // the uploads directory looks exactly like this.
      const keys = await readdir(join(root, "inward-challans", challanId));
      await rm(join(root, "inward-challans", challanId, keys[0]!));

      await expect(service.read(challanId, document!.id)).rejects.toThrow(/missing from storage/);
    });
  });

  describe("detaching", () => {
    it("removes the row and the bytes", async () => {
      await service.attach(challanId, [upload("a.pdf", PDF)], ACTOR);
      const [document] = (await repo.findById(challanId)).documents;

      await service.detach(challanId, document!.id);

      expect((await repo.findById(challanId)).documents).toHaveLength(0);
      expect(await readdir(join(root, "inward-challans", challanId))).toEqual([]);
    });

    it("leaves the other attachments alone", async () => {
      await service.attach(challanId, [upload("a.pdf", PDF), upload("b.png", PNG)], ACTOR);
      const documents = (await repo.findById(challanId)).documents;

      await service.detach(challanId, documents[0]!.id);

      const left = (await repo.findById(challanId)).documents;
      expect(left.map((d) => d.documentName)).toEqual(["b.png"]);
      expect((await service.read(challanId, left[0]!.id)).bytes).toEqual(PNG);
    });

    it("refuses a document that belongs to another challan", async () => {
      await service.attach(challanId, [upload("a.pdf", PDF)], ACTOR);
      const [document] = (await repo.findById(challanId)).documents;
      await expect(service.detach(MISSING, document!.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    /**
     * The row goes first and the blob second, so a failed blob delete leaves a
     * stray file rather than a row that cannot be downloaded. The user asked for
     * the attachment to be gone; from where they sit, it is.
     */
    it("still reports success when the bytes cannot be removed", async () => {
      await service.attach(challanId, [upload("a.pdf", PDF)], ACTOR);
      const [document] = (await repo.findById(challanId)).documents;

      const stubborn: DocumentStorage = {
        put: (key, bytes) => storage.put(key, bytes),
        get: (key) => storage.get(key),
        remove: () => Promise.reject(new Error("read-only filesystem")),
        exists: (key) => storage.exists(key),
      };

      await expect(
        new InwardChallanDocumentsService(repo, stubborn).detach(challanId, document!.id),
      ).resolves.toBeUndefined();
      expect((await repo.findById(challanId)).documents).toHaveLength(0);
    });
  });

  /** Soft delete keeps the row, so it must keep the evidence hanging off it. */
  it("keeps attachments when a challan is soft-deleted", async () => {
    await service.attach(challanId, [upload("a.pdf", PDF)], ACTOR);
    await repo.remove(challanId, ACTOR);

    const [document] = await db
      .select({ id: schema.inwardChallanDocuments.id })
      .from(schema.inwardChallanDocuments)
      .where(eq(schema.inwardChallanDocuments.challanId, challanId));

    expect(document).toBeDefined();
    // And the bytes are still there to be read if the delete is reversed.
    expect(await readdir(join(root, "inward-challans", challanId))).toHaveLength(1);
  });
});
