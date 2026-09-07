# 08 — Create Purchase Order

`/PurchaseMaster/CreatePurchaseOrder` — "Create PurchaseOrder".

A **full-page form**, not a split view. The one screen in the app that abandons
the master-detail pattern, because it cannot fit.

Assessment 03 rates this **Very High** complexity (1023 lines of Razor, 2377 of
JavaScript). The capture explains why.

## Panels, top to bottom

### Supplier Details
Supplier Name (select) · Mobile No · Address · GST NO
— the last three fill in from the chosen supplier and are read-only.

### Purchase Order Details
Company Name (select) · **Order No (read-only, "Purchase Order Number")** ·
Order Date · Billing Address · GST NO

**Order No is disabled and pre-filled.** Same pattern as the purchase request:
the number is fetched when the form opens and posted back on save — the race
that `document_counters` exists to close.

### Add Product — the line-item grid

| # | PRODUCT DETAILS | HSN CODE | QUANTITY | QTY TYPE | PRICE | GST (%) | GST AMT (₹) | AMOUNT (₹) | ACTION |

Rows are added with a **+** beside the "Add Product" heading. A footer row totals
Quantity, GST AMT and AMOUNT.

### Order attributes (left column, below the grid)

Buyers Purchase Number · **Delivery Schedule** (a date input PLUS an
Immediate/Date radio pair) · Contact Person · Mobile No · Other ContactPerson ·
Other ContectNo *(sic)* · Dispatch By · **Group** (select)

### Totals (right column)
Sub Total · Total GST · Total Amount

### Shipping Addresses / Group Address
Two panels, empty until a site and group are chosen. The Group Address list comes
from the chosen group's "Multiple Group Address" repeater — see
`04-group-master.md`.

### Select Terms and Conditions
**Three tabbed templates** (Template 1/2/3) over a **rich text editor** with a
full toolbar: paragraph style, bold, italic, link, bullet and numbered lists,
indent/outdent, image, blockquote, table, embed, undo/redo.

Template 1 in the capture is an 8-clause boilerplate: prices, packing, freight,
tax ("18% Gst Extra"), delivery, payment terms, validity of offer, warranty.

Final action, bottom right: **Add Purchase Order**.

## What this means for the port

1. **A rich text editor is a dependency nobody has budgeted for.** Three stored
   templates, editable per order, and the result must render identically on the
   printed PO. It needs a sanitiser on the way in — this is stored HTML rendered
   back to users.
2. **Three print layouts exist** for this document (`POPrintDetails`,
   `PrintJKDetails`, `PurchaseUltraView` — assessment 03 screens 17-19). The PDF
   story is Phase 5, via Playwright.
3. **`Other ContectNo` is misspelled in the UI.** Decide whether to keep the
   label or fix it; either way the column name should be correct.
4. Delivery Schedule is a date **or** the word "Immediate" — two representations
   of one field. In the target that is a nullable date plus a boolean, or a
   nullable date where NULL means immediate. Pick one deliberately.
5. The totals are computed in the browser today. In the port they are
   **server-authoritative** — the single most important change in Phase 4, and
   the reason the GST question (B-2) has to be answered first.
