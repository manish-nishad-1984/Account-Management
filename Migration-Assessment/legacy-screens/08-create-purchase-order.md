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

> **CORRECTED 9 Sep 2026, by reading the view rather than the screenshot.** These
> are not display panels. Each row is a **checkbox and a quantity box**, and the
> ticked rows post as ONE list into ONE table, `PodeliveryAddress` — so an order
> allocates its quantity across the places it is delivered to.
>
> Three things the capture could not show, all now in
> `packages/domain/src/delivery-allocation.ts` and the schema:
>
> 1. **Which panel a row came from is a string prefix.**
>    `PurchaseRequestScript.js:1003` posts a group address as
>    `'Group-' + address`, and the view strips it with
>    `Address.Replace("Group-", "")` — which removes the marker from ANY
>    position, so "Ward 3, Group-B" displays as "Ward 3, B". `kind` is a column
>    in the port.
> 2. **The quantity check is per panel, so an order can be delivered twice.**
>    `totalShippingQuantity` and `totalGroupQuantity` are separate accumulators,
>    each compared to the ordered quantity on its own. 100 to site addresses and
>    100 to group addresses passes against an order for 100. The port sums them
>    together — a departure, flagged for sign-off.
> 3. **`PodeliveryAddress.Quantity` is an `int`** while the browser collects it
>    with `parseFloat` and every line quantity is decimal, so 2.5 tonnes cannot
>    be allocated. `numeric` in the port.
>
> Also: the header's own `GroupAddress` column is filled with
> `$('input[name="selectedPOGroupAddress"]:checked').val()`, and jQuery's `.val()`
> on a set returns only the FIRST value — so the header records one address while
> the detail rows carry all of them.

### Select Terms and Conditions
**Three tabbed templates** (Template 1/2/3) over a **rich text editor** with a
full toolbar: paragraph style, bold, italic, link, bullet and numbered lists,
indent/outdent, image, blockquote, table, embed, undo/redo.

Template 1 in the capture is an 8-clause boilerplate: prices, packing, freight,
tax ("18% Gst Extra"), delivery, payment terms, validity of offer, warranty.

> **CORRECTED 9 Sep 2026. The templates are not stored anywhere.** All three are
> hard-coded in this view, one per tab pane (`:704-855`), and no screen edits
> them — changing a template means changing the Razor and redeploying. They are
> constants in `contracts/purchase-order-terms.ts` for exactly that reason.
>
> **The column is `PaymentTerms`, not `Terms`.** The editor's HTML posts as
> `PaymentTerms` and the chosen tab as `PaymentTermsId` ("Term-1"/"Term-2"/
> "Term-3"). Nothing on this screen binds to `Terms` at all, and the "Payment
> Terms" text input that would explain the name is **commented out** (`:427-436`).
> The ETL must load legacy `PaymentTerms` into `purchase_orders.terms`.
>
> **Only the ACTIVE tab is read on save** (`PurchaseRequestScript.js:1013-1025`),
> so text typed into either of the other two editors is discarded with no
> indication. The port has one editor and one set of terms.
>
> **And the print view renders it with `@Html.Raw`** (`POPrintDetails.cshtml:406`),
> so whatever HTML is stored executes for every reader of that order. That is why
> the port stored plain text until a sanitiser existed.

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
   **server-authoritative** — the single most important change in Phase 4.
   ~~and the reason the GST question (B-2) has to be answered first.~~

   **THE B-2 CLAIM IS WRONG FOR THIS SCREEN — corrected 8 Sep 2026, by counting
   rather than by reasoning from the phase it sits in.** Three checks, all
   against `Views/PurchaseMaster/CreatePurchaseOrder.cshtml`:

   - It loads **exactly one** script from `moduls/`, `purchaserequestscript.js`.
     D-JS-1's three-way `updateTotals` collision is on `CreateInvoice.cshtml`,
     which loads three. There is nothing here to collide.
   - It contains **zero** occurrences of `discount`, `tds`, `roundoff` and
     `round-off`. Those three are precisely what the calculators disagree about,
     so the disagreement has no surface on this screen.
   - The "each calculator sees half the table" defect needs two row classes.
     `_GetItemDetailsPartial.cshtml` renders rows as `class="product"` and
     `updateTotals` iterates `$(".product")` — they match, so the one calculator
     that runs sees every row.

   So a purchase order has exactly one defensible total:

   ```
   line GST   = round2(price x qty x gstPercent / 100)
   line total = price x qty + line GST
   subtotal   = SUM(price x qty)          -- accumulated unrounded
   total GST  = SUM(line GST)             -- per-line ROUNDED, then summed
   total      = subtotal + total GST
   ```

   Computing that on the server answers no business question by implication,
   which is what "gated on B-2" was protecting against. **B-2 still blocks the
   purchase invoice and sales invoice screens**, where TDS, round-off, discount
   and the three-way collision all bite.

   Built 8 Sep 2026 as `packages/domain/src/purchase-order-total.ts`, with the
   legacy float calculator transcribed beside it as a test oracle so the decimal
   version is checked against what the browser produces rather than against what
   its author believed the browser produces.
