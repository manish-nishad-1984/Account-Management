# 09 — Inward Challan

`/ItemInWord/ItemInWord` — "Inward Challan". Primary action: **Item Inward**.

Note the controller spelling: `ItemInWord`. The entity is `ItemInword`, the
request key is `InwardId` and the property is `InwordId`. All three spellings are
live in the source. The port should settle on `inward` and map at the edges.

## Filters — different from every other screen

Two free-text boxes (`Supplier`, `Item`), a **Search By** dropdown, a magnifier
button and a **Reset** button. Filtering is explicit here, not as-you-type.

## List

| Item Name | Date | Quantity | Supplier | SiteName | InvoiceNo | Action |

| Item | Date | Qty | Supplier | Invoice |
|---|---|---|---|---|
| FLY ASH BRICKS | 07/08/2026 | 4000.0 | RAJU M PATEL-CARTING | 922 |
| FLY ASH BRICKS | 12/06/2026 | 2000.0 | RAJU M PATEL-CARTING | 1 |
| FLY ASH BRICKS | 03/06/2026 | 2000.0 | RAJU M PATEL-CARTING | 253-1 |
| BODELI-WHITE | 06/09/2026 | 37.81 | RAGHUNADAN CARTING | 1851 |
| GSB | 26/08/2026 | 29.62 | MARUTI-NANDAN CARTING | 1716 |

**A purple footer row totals the Quantity column: `70013.25`.** A grid-level
aggregate — the port's `DataGrid` has no such concept.

Quantities are `4000.0` and `29.62` — one decimal place in some rows, two in
others. Decimal strings, again.

Invoice numbers are free text: `922`, `1`, `253-1`.

## Detail pane — "Item Inward Details"

| Field | Value |
|---|---|
| Item Name | FLY ASH BRICKS |
| Unit Name / Site Name | NOS - Number / SURAT-AURO UNIVERSITY |
| Quantity / Supplier | 4000 / RAJU M PATEL-CARTING |
| **IsApproved** / Date | toggle ON / 07/08/2026 |
| VehicleNumber / ReceiverName | 9980 / SURESHBHAI-CC-2000X2 7TH |
| DocumentName | (empty) |

## Create pane — "Create Inward Item"

Product Names · Unit Type · Quantity · Receiver Name · Vehicle Number · Date ·
Site · Supplier · Invoice NO · **Document — "Choose Files", multiple** · Save.

## What the port needs

1. **File upload, and it is the reason this module is Phase 3.** Multiple files
   per challan. Assessment 12 puts these in object storage rather than on the web
   server's disk, which is where they live today. _(Done — local disk behind a
   swappable interface; see below.)_
2. **A footer aggregate** on the grid.
3. **Explicit search** (two fields plus a Search By selector and a Reset), not
   the single as-you-type box every other screen uses.
4. `ReceiverName` here is `SURESHBHAI-CC-2000X2 7TH` — a person, a group code and
   what looks like a batch reference crammed into one field. Do not try to
   normalise it; carry it as free text.
5. No money on this document, which is what makes it a safe Phase 3 companion to
   purchase requests.

---

## PORTED — 7 Sep 2026, upload included

Live at `/inward`. Schema `inward_challans` + `inward_challan_documents`,
migration `0006`, module `apps/api/src/modules/inward-challans/`, screen
`apps/web/src/features/inward-challans/`. Subject `inward-challan`.

Done: the footer aggregate (a real `<tfoot>` on `DataGrid`, totalled over the
filtered set and present when the set is empty — the source loses it exactly
then), the explicit Supplier / Item / date-range / status filters with Search and
Reset, and attachments listed and counted.

**Upload shipped 7 Sep 2026.** `POST/GET/DELETE /inward-challans/:id/documents`,
migration `0007`. See SESSION-HANDOFF §5j and §5l.

### The storage decision, made and stated

**Local disk behind a `DocumentStorage` interface.** Assessment 12 wants object
storage; the business runs a disk today. This ships the disk because it needs no
new infrastructure, no credentials and no bucket policy to review — but behind
the interface, so S3 is one new class and one line in `storage.module.ts`, with
no caller touched. `STORAGE_DIR` on the VPS is `/opt/accountbook-next/uploads`:
outside the web root, and outside `releases/`, which the deploy prunes to the
last five.

### What that closes

The legacy single-file path is four lines and contains every mistake available:

```csharp
var path = Environment.WebRootPath;
var filepath = "Content/InWordDocument/" + ItemInWordDetails.DocumentName.FileName;
var fullpath = Path.Combine(path, filepath);
UploadFile(ItemInWordDetails.DocumentName, fullpath);
```

| Legacy | Here |
|---|---|
| Destination built from the browser's `FileName`, `..` and all — **H-10** | Key generated server-side; the name is a column, never a path |
| `FileMode.Create` truncates, so two `invoice.pdf` overwrite each other | Written with `wx`; a collision is refused, and keys carry a UUID anyway |
| Inside `wwwroot`, so anyone who guesses a name downloads it — **H-9** | Outside anything nginx serves; every byte goes through a token and `inward-challan.view` |
| No extension, size or type check | Allowlist + 10 MB + content sniffing; `.html` and `.svg` are excluded deliberately |
| Served as whatever the web server decides | `attachment` + `nosniff` + a type read from the file's own signature |

The multi-file paths do prefix a GUID, so they avoid the overwrite. The
single-file path does not, and **both are live**.

Verified by running it, not by reading it: an `.html` renamed `.pdf` is refused
by its contents, an executable called `.png` is refused, and a file named
`../../../../etc/passwd.pdf` is stored as `passwd.pdf` under the challan's own
prefix with nothing written outside the root.

Five defects found in `ItemInwardRepo.cs` that the capture could not show — two
create paths and two update paths, one of each silently dropping the supplier and
the invoice number; `Date` overwritten with `DateTime.Now` on create;
`VehicleNumber.ToUpper()` throwing on a blank field; attachments stored twice and
reconciled by hand with a `.Split(';')` that NREs on null. And a whole dead
duplicate repository, `ItemInWordRepo.cs`, that nothing resolves.
