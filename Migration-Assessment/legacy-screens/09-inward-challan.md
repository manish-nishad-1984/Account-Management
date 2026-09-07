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
   server's disk, which is where they live today.
2. **A footer aggregate** on the grid.
3. **Explicit search** (two fields plus a Search By selector and a Reset), not
   the single as-you-type box every other screen uses.
4. `ReceiverName` here is `SURESHBHAI-CC-2000X2 7TH` — a person, a group code and
   what looks like a batch reference crammed into one field. Do not try to
   normalise it; carry it as free text.
5. No money on this document, which is what makes it a safe Phase 3 companion to
   purchase requests.
