# 07 — Purchase Orders (list)

`/PurchaseMaster/POListView` — "Purchase Orders". Primary action: **PurchaseOrder**.

## Filters

`Search`, an **Active** dropdown (not "All" — this screen's status filter defaults
to Active), and a **First Created** sort (not "Most Recent").

## List

| Purchase Order Id | Date | Site Name | IsActive | Supplier Name | Company Name | Total Amount | Action |

| PO Id | Date | Site | Supplier | Company | Amount |
|---|---|---|---|---|---|
| DHP/PO/24-25/049 - OMSAGAR | 24/12/2024 | OM SAGAR CONSTRUCTION | ASIAN GRANITO INDIA LIMITED | DH PATEL | ₹4,663,080.34 |
| DEMO/PO/24-25/001 - STUDENT ACIVITY CENTER | 16/01/2025 | VIRTUAL SITE | DEMO SUPPLIERS | DEMO | ₹118,000.00 |

Two things in that Purchase Order Id:

1. **The company's invoice prefix leads it** — `DHP/`, `DEMO/`. So document
   numbering is per company AND per financial year, unlike purchase requests
   which are numbered `PR/` globally. `document_counters` will need a company
   dimension before purchase orders land.
   _(Done 8 Sep 2026: `document_counters.company_id`, nullable with a real FK,
   plus two partial unique indexes so the global PR sequence and the per-company
   PO sequence can share the table.)_
2. ~~**A free-text suffix is appended** — ` - OMSAGAR`, ` - STUDENT ACIVITY
   CENTER`. The number is not purely generated; part of it is typed.~~

   **WRONG — corrected 8 Sep 2026 by reading the view instead of the screenshot.**
   `_POListPartial.cshtml:8` renders the cell as

   ```razor
   <h6 class="product-name mb-2">@item.Poid - @item.BuyersPurchaseNo</h6>
   ```

   so the ` - OMSAGAR` is **`BuyersPurchaseNo`, a separate column, concatenated
   in the view**. `Poid` itself is clean: `DHP/PO/24-25/049`. Nothing about the
   number is typed.

   This matters more than a tidy-up. Had it been believed, the port would have
   built a free-text component into a generated document number — and it would
   also have implied that `CheckPONo`'s trailing-digit regex runs against
   `"049 - OMSAGAR"`, which does not match, which would make the generator return
   its error string as the number for every subsequent order. The number is
   clean, so the regex does match, and that failure does not occur.

   The lesson is §5p's, again: a screen capture tells you a value is displayed,
   only the view tells you what it is made of.

The Purchase Order Id renders as a **link** (purple), unlike every other list.

`Total Amount` uses **Western digit grouping**: `₹4,663,080.34`. Our
`formatMoney` groups the Indian way and would render this `₹46,63,080.34`. A
deliberate port improvement that changes what people see — flagged in
`00-shell-and-navigation.md`.

**Action has a third icon** beyond edit and delete — a document/print glyph.

## Two sub-grids below the list

| Invoice Details | Pending Details |
|---|---|
| InvoiceNo, Date, ItemName, QTY, ItemTotal | ItemName, Date, PO-QTY, Ordered-QTY, Pending-QTY |

**This is PO fulfilment tracking**, and it is the link between a purchase order
and the invoices raised against it. `PO-QTY` vs `Ordered-QTY` vs `Pending-QTY`
means the port needs a real PO-to-invoice-line relationship, not the loose text
match the source uses (assessment 09 section 7.5). Both grids are empty in the
capture because no row was selected.
