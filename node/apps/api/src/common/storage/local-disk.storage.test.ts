import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorage } from "./local-disk.storage";
import { StoredObjectMissingError, newStorageKey, safeExtension, safeFileName } from "./document-storage";

describe("LocalDiskStorage", () => {
  let root: string;
  let storage: LocalDiskStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "storage-test-"));
    storage = new LocalDiskStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips bytes exactly", async () => {
    // Binary, not text: a driver that decodes to a string somewhere silently
    // corrupts every PDF and passes a test written with "hello".
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80]);
    const stored = await storage.put("inward-challans/a/file.pdf", bytes);

    expect(stored.sizeBytes).toBe(8);
    expect(await storage.get("inward-challans/a/file.pdf")).toEqual(bytes);
  });

  it("creates the directories a key implies", async () => {
    await storage.put("deep/nested/path/file.txt", Buffer.from("x"));
    expect(await storage.exists("deep/nested/path/file.txt")).toBe(true);
  });

  /**
   * FINDING H-10, as a test.
   *
   * The legacy handler built its destination from the browser's file name and
   * `Path.Combine`, so a name of `../../appsettings.json` wrote there. Keys here
   * are generated, so this can only fire if a caller bypasses the generator —
   * which is exactly the day it needs to fire.
   */
  describe("refuses a key that escapes the root", () => {
    const escapes = [
      "../outside.txt",
      "a/../../outside.txt",
      "./../../outside.txt",
      "a/b/../../../outside.txt",
    ];

    for (const key of escapes) {
      it(JSON.stringify(key), async () => {
        await expect(storage.put(key, Buffer.from("x"))).rejects.toThrow(/escapes the storage root/);
        await expect(storage.get(key)).rejects.toThrow(/escapes the storage root/);
        await expect(storage.remove(key)).rejects.toThrow(/escapes the storage root/);
      });
    }

    it("an absolute path", async () => {
      const absolute = join(tmpdir(), "absolute-escape.txt");
      await expect(storage.put(absolute, Buffer.from("x"))).rejects.toThrow(/Unsafe storage key/);
    });

    it("a NUL byte, which truncates a path in some syscalls", async () => {
      await expect(storage.put("ok.txt\u0000.png", Buffer.from("x"))).rejects.toThrow(
        /Unsafe storage key/,
      );
    });

    it("an empty key", async () => {
      await expect(storage.put("", Buffer.from("x"))).rejects.toThrow(/Unsafe storage key/);
    });
  });

  /**
   * `startsWith(root)` alone would let this through: "/tmp/x-evil" starts with
   * "/tmp/x". The separator has to be part of the comparison.
   */
  it("refuses a sibling directory whose name merely starts with the root's", async () => {
    const sibling = `..${sep}${root.split(sep).pop()}-evil${sep}file.txt`;
    await expect(storage.put(sibling, Buffer.from("x"))).rejects.toThrow(
      /escapes the storage root/,
    );
  });

  /**
   * The legacy single-file path used `FileMode.Create`, which truncates. Two
   * suppliers uploading `invoice.pdf` overwrote one another and the second
   * challan then showed the first's document.
   */
  it("refuses to overwrite rather than truncating", async () => {
    await storage.put("a/file.pdf", Buffer.from("first"));
    await expect(storage.put("a/file.pdf", Buffer.from("second"))).rejects.toThrow();
    expect(await storage.get("a/file.pdf")).toEqual(Buffer.from("first"));
  });

  it("reports a missing object as StoredObjectMissingError, not ENOENT", async () => {
    // The service distinguishes "the row points at nothing" from a real IO
    // failure, and it can only do that if the driver names the case.
    await expect(storage.get("a/gone.pdf")).rejects.toBeInstanceOf(StoredObjectMissingError);
  });

  it("treats removing something already gone as success", async () => {
    await expect(storage.remove("a/never-existed.pdf")).resolves.toBeUndefined();

    await storage.put("a/file.pdf", Buffer.from("x"));
    await storage.remove("a/file.pdf");
    await storage.remove("a/file.pdf");
    expect(await storage.exists("a/file.pdf")).toBe(false);
  });

  it("does not call a directory a file", async () => {
    await storage.put("a/file.pdf", Buffer.from("x"));
    expect(await storage.exists("a")).toBe(false);
  });

  describe("verifyWritable", () => {
    it("creates a root that does not exist yet", async () => {
      const missing = join(root, "not", "yet", "there");
      await new LocalDiskStorage(missing).verifyWritable();
      await expect(new LocalDiskStorage(missing).put("f.txt", Buffer.from("x"))).resolves.toBeTruthy();
    });

    it("leaves no probe file behind", async () => {
      await storage.verifyWritable();
      const { readdir } = await import("node:fs/promises");
      expect(await readdir(root)).toEqual([]);
    });

    it("fails when the root is a file rather than a directory", async () => {
      const file = join(root, "a-file");
      await writeFile(file, "");
      await expect(new LocalDiskStorage(file).verifyWritable()).rejects.toThrow();
    });
  });

  it("writes where the key says, and nowhere else", async () => {
    const key = "inward-challans/abc/def.pdf";
    await storage.put(key, Buffer.from("payload"));
    expect(await readFile(join(root, "inward-challans", "abc", "def.pdf"), "utf8")).toBe("payload");
  });
});

describe("storage keys", () => {
  it("puts no part of the uploaded name in the key but the extension", () => {
    const key = newStorageKey("inward-challans/c1", "SURESHBHAI weighbridge slip.pdf");

    expect(key).toMatch(/^inward-challans\/c1\/[0-9a-f-]{36}\.pdf$/);
    expect(key).not.toContain("SURESHBHAI");
    expect(key).not.toContain(" ");
  });

  it("cannot be talked into a traversal by the file name", () => {
    const key = newStorageKey("inward-challans/c1", "../../../etc/passwd");
    expect(key).not.toContain("..");
  });

  it("is unique per call, so two files of the same name cannot collide", () => {
    const a = newStorageKey("p", "invoice.pdf");
    const b = newStorageKey("p", "invoice.pdf");
    expect(a).not.toBe(b);
  });

  describe("safeExtension", () => {
    const cases: [string, string][] = [
      ["invoice.pdf", ".pdf"],
      ["INVOICE.PDF", ".pdf"],
      ["a.b.tar.gz", ".gz"],
      ["no-extension", ""],
      // A "double extension" is only ever the last one here.
      ["shell.php.pdf", ".pdf"],
      // Too long, or not alphanumeric — not an extension worth keeping.
      ["x.verylongext", ""],
      ["x.a b", ""],
      [".hidden", ""],
    ];

    for (const [input, expected] of cases) {
      it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
        expect(safeExtension(input)).toBe(expected);
      });
    }
  });

  describe("safeFileName", () => {
    const cases: [string, string][] = [
      ["invoice.pdf", "invoice.pdf"],
      ["/etc/passwd", "passwd"],
      // basename() is platform-aware, so on Linux it would return the whole
      // string here. Both separators are cut regardless of platform, because
      // the name came from a browser and not from this machine.
      ["C:\\Windows\\System32\\config", "config"],
      ["../../../etc/passwd", "passwd"],
      ["..", "attachment"],
      [".", "attachment"],
      ["", "attachment"],
      ["   ", "attachment"],
      ["report\u0000.pdf", "report.pdf"],
      ["line\nbreak.pdf", "linebreak.pdf"],
    ];

    for (const [input, expected] of cases) {
      it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
        expect(safeFileName(input)).toBe(expected);
      });
    }

    it("caps the length, because a column and a header both have limits", () => {
      expect(safeFileName(`${"a".repeat(400)}.pdf`)).toHaveLength(255);
    });
  });
});
