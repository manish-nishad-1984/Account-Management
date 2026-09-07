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
