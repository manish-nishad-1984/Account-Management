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
NOS - Number, BDL - Bundles). Our `units` table stores a single `name`. Check
whether the source has a separate code column the port collapsed into it.

## Port gaps

1. **No Excel import/export.** Download File / Upload File appear here and on
   Supplier. Assessment 03 lists "Excel import moved to a BullMQ worker" as
   Phase 2 work and it has not been done. Users will notice at once — it is how
   a 758-item catalogue is maintained in bulk.
2. **No price history.** The clock icon shows an item's price over time. Nothing
   in our schema records it: `items.price_per_unit` is a single mutable column.
   Restoring this needs a modelling decision (audit table, or temporal rows), not
   just a screen.
