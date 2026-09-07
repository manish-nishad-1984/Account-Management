# 15 — Inventory Inward

`/Sales/CreateInventory` — "CreateInventory". Primary action: **Inventory Inward**.

Note the controller: `Sales`, not a controller of its own. Assessment 03 lists
this as "part of `SalesRepo.cs`" with no dedicated repository.

## List

| Item Name | Date | Unit | Quantity | Approve | Action |

| Item | Date | Unit | Qty | Approve |
|---|---|---|---|---|
| HELMET YELLOW LABOUR | 04/01/2026 | NOS - Number | 1000.0 | ticked |
| HELMET YELLOW LABOUR | 04/01/2026 | NOS - Number | 10.0 | ticked |
| GI WIRE CUTTING SIZE: 12 INCH 20 GAUZE KG (10 KG BAG) | 22/12/2025 | BDL - Bundles | 1.0 | ticked |

Only three rows. **The smallest transaction table in the system.**

## Create pane — "Create Inventory"

Product Names · Date · Product Description (textarea) · Unit Type · Quantity ·
**Save**.

Six fields. No site, no supplier, no document number, no file upload, no money.

## Detail pane — "Inventory Details"

Item Name · Item Description · Unit Name · Quantity · **IsApproved** toggle.

In the capture: HELMET YELLOW LABOUR / "TO RAJAOUL" / NOS - Number / 10 /
approved.

## Why this is the easiest thing left to port

- Six fields, three rows, no money, no files, no numbering, no site scoping.
- It reuses everything purchase requests just established: the item and unit
  dropdowns, the approve-by-stated-value endpoint, decimal-string quantities,
  `formatQuantity` (note `1000.0` and `1.0` in the list).
- It has an `Approve` column, so it is one of the six dashboard queues.

**Item Description here is genuinely free text** — "TO RAJAOUL" is a destination,
not a description. Do not try to give it meaning.

## One caution

Because it lives inside `SalesRepo`, check what else that repository does before
extracting it. The dead `query.FirstOrDefault().GetType()` line removed from
`SalesRepo` in this repo was one round trip per sorted report and threw on empty
results — the file has form.

---

## PORTED — 7 Sep 2026

Live at `/inventory`. Schema `inventory_inward`, migration `0005`, module
`apps/api/src/modules/inventory-inward/`, screen
`apps/web/src/features/inventory/`. Permission subject `inventory-inward`, from
`Form.FormName` — NOT from the `Sales` controller.

Four things found in `SalesRepo.cs` that the capture could not show, all
departed from and all recorded in SESSION-HANDOFF §5i:

- **`SiteId` exists on the table and nothing ever writes it.** Every production
  row has none, so the site-scoped list filters "this site OR no site" and the
  screen carries a notice while unallocated rows remain.
- **`IsApproved = true` is hard-coded on insert**, so the Approve column has
  never gated anything. New rows are created unapproved. Needs sign-off.
- **The delete is a hard delete** — `IsDeleted = true` followed by `Remove()` on
  the same entity. Ours is a real soft delete.
- **The list and the edit form read different item names** (`i.ItemName` vs
  `a.Item`), so renaming an item makes them disagree. Both read the master here.

It also surfaced a bug of ours: paging any list by `createdAt` threw on the
second page. See §5i.
