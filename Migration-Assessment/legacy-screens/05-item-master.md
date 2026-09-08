# 05 — Item Master

`/ItemMaster/ItemListView` — "Item Master".

**Three** primary actions: **Create Item**, **Download File**, **Upload File**.

## List

| Item Name | Price | Approved | Action |

Price renders as `₹27.00`. Approved is a ticked checkbox. The Action cell holds
**three** controls: edit, delete, and a **clock icon on its own line** — item
price history.

## Detail pane — "Item Details"

| Left | Right |
|---|---|
| Item Name | Unit Name (PCS - Pieces) |
| Price Per Unit (₹ 27) | **IsWithGST** — a toggle, shown OFF |
| GST Amount (₹ 4.86) | GST % (18) |
| HsnCode (39174000) | |

## The arithmetic on display

27.00 at 18% is 4.86. Exact, in this row.

But **IsWithGST is OFF while GST Amount and GST % are both populated.** That is
exactly the inconsistency our `createItemSchema` refuses:

> "Clear the GST figures, or mark the item as GST-inclusive"

So **this production row would fail our validation.** Deliberately: reads never
re-validate, so it displays fine and only an edit is blocked. Worth knowing
before someone reports it as a bug.

The unit label format is `CODE - Name` (PCS - Pieces, MTS - Metric Ton,
NOS - Number, BDL - Bundles). Our `units` table stores a single `name`.

**Answered, 8 Sep 2026: the source has no code column.** `UnitMaster` is
`UnitId` and `UnitName` and nothing else, so `PCS - Pieces` is the whole value of
`UnitName` in production, not two columns rendered together. Our single `name`
is a faithful port and there is nothing to split. This matters for the Excel
import, which resolves a sheet's `Unit Type` against `UnitName` by exact
(case-insensitive) match: a sheet must carry whatever the unit is actually
called, `PCS - Pieces` included.

## Port gaps

1. ~~**No Excel import/export.**~~ **DONE, 8 Sep 2026 — see SESSION-HANDOFF §5o.**
   Download File and Upload File are both on the screen. Supplier's pair is
   blocked on the States/Cities census, not on effort — see PLAN.md §1.3.
2. **No price history.** The clock icon shows an item's price over time. Nothing
   in our schema records it: `items.price_per_unit` is a single mutable column.
   Restoring this needs a modelling decision (audit table, or temporal rows), not
   just a screen.

## What the legacy Excel pair actually does — read before changing ours

Four findings, all confirmed in the source and all departed from deliberately.

1. **The two halves do not fit together.** `DownloadItemListDemoExcelFile`
   (`ItemMasterController.cs:665`) writes `Item Name | Unit type | PricePerUnit
   | Gst(%) | HSN Code`. `ImportExcelFile` (`:264-268`) reads `ItemName |
   UnitType | PricePerUnit | GSTPer | HSNCode`. **Only `PricePerUnit` matches**,
   so the downloaded file cannot be uploaded back — and it fails invisibly,
   because the missing column throws per row inside a `catch` that writes to
   `Console.WriteLine` and continues. Every row is dropped and the user is told
   "Failed to insert item details".
2. **A row that will not parse is discarded in silence.** That same `catch`
   swallows `Convert.ToDecimal` failures, so a price of `₹27.00` or `1,234.56`
   removes the item from the import and reports nothing. Ours strips the symbols
   and refuses anything genuinely wrong with the row number and column.
3. **The importer creates the contradiction this document already noted.** It
   writes `IsWithGst = false` while computing and storing `Gstamount` and
   `Gstper` — which is exactly the "IsWithGST off with GST populated" shape of
   the captured production row above, and exactly what `createItemSchema`
   refuses. Ours derives the flag from whether a GST percentage is present, so
   imported items can be opened and saved in our own edit form.
4. **The upload is written into the web root under its own name.**
   `wwwroot/UploadExcelFile/<FormFile.FileName>` with `FileMode.Create` — an
   unsanitised, caller-controlled path, truncating on collision, inside a
   directory the web server hands out. The GUID prefix that would have fixed the
   collision IS computed on the next line, with the comment "Fixing incorrect
   usage of Guid", and is then used only for its file extension. Findings H-9
   and H-10 again, on a second screen. Ours never writes the upload to disk at
   all: it is parsed in memory and thrown away.
