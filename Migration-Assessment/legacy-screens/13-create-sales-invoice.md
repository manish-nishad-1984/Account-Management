# 13 — Create Sales Invoice

`/Sales/CreateSalesInvoice` — "CreateSalesInvoice".

The mirror of `11-create-purchase-invoice.md`. The panels are the same two, with
their positions swapped, and the direction dropdown reads **Sales** instead of
Purchase.

## Panels

### Invoice Details (LEFT — was on the right for purchases)
Company Name (select) · **Invoice No** · Date · Billing Address · GST NO

`Invoice No` is an **empty, editable** box. For a sales invoice the number is
ours to issue — this is where `Company.InvoicePrefix` and the financial year
combine, the same machinery `document_counters` now owns.

### Customer Details (RIGHT) — with the **Sales** switch
Supplier Name (select, labelled Supplier though it means Customer) · Mobile No ·
Address · GST NO

### Add Product
Identical column set to the purchase invoice:

| NO | PRODUCT | HSN | QTY | QTY TYPE | PRICE(₹) | DIS(₹) | DIS(%) | GST(%) | GST(₹) | AMOUNT(₹) |

### Order attributes
Challan/Document No · BUYERS CODE · Vehicle No · Dispatch By · Payment Terms

**No "Active PO" row** — a sales invoice has no purchase order behind it. That is
the only structural difference in the whole form.

### Totals
Sub Total · Total GST · TDS · Discount · Adjustment · Total Amount — identical,
and rendered `₹0.00` / `0` in the capture.

Final action: **Create Invoice**.

## The conclusion for the port

**One editor component, two directions.** The difference is: which side is the
counterparty, whether the invoice number is generated or typed, and whether the
Active PO link exists.

Build it once, against the purchase invoice, and configure it for sales. Building
two is how the source ended up with `SalesRepo` and `SupplierInvoiceRepo` sharing
the same bugs in two places — including the dead `query.FirstOrDefault().GetType()`
round trip removed from both in this repo.

---

## Built 9 Sep 2026, and the advice above was followed literally

The grid is `apps/web/src/features/invoices/InvoiceLineGrid.tsx`. The purchase
invoice form was **refactored onto it** rather than the sales form being copied
from it — the direction that keeps one implementation instead of creating a
second. The purchase form's 12 tests are what made that safe; they all still
pass.

The three differences this document predicts are the three that exist, and
nothing else:

| Difference | How it lands |
|---|---|
| Which side is the counterparty | `customer_id`, referencing `suppliers` — one party table, both sides of the trade |
| Generated or typed number | Generated, from `document_counters`, per company and financial year |
| The Active PO link | Absent, exactly as this document says |

### What this screen does NOT suffer from

**This is the healthiest of the three calculators, and no document said so.**
Counted before the table was written:

- `CreateSalesInvoice.cshtml` loads exactly ONE script, so nothing overwrites
  `updateSalesTotals`. **B-2(a) — the TDS box read by a replaced calculator —
  does not apply here.**
- That page renders ZERO product rows. Every row comes from
  `_DisplaySalesItemDetailsPartial.cshtml`, which carries `class="product"`,
  which is exactly what the calculator iterates. **B-2(b) — the calculator that
  sees half the table — does not apply either.** The purchase invoice page has 3
  rows its winning calculator cannot see; this page has none.

### What it DOES suffer from, both previously unrecorded

**1. The price exists twice, and the two halves of the total read different
copies.** `#txtSalesproductamount` is visible and editable; `#Salesproductamount`
is a hidden twin holding the catalogue price.

```js
// the LINE — reads the HIDDEN price
var AmtWithDisc = hiddenproductPrice - discountprice;
var totalGst = (AmtWithDisc * quantity * gst) / 100;

// the ROLL-UP — sums the VISIBLE price
var subtotal = parseFloat(row.find("#txtSalesproductamount").val()) || 0;
totalSubtotal += subtotal * totalquantity;
```

Type a price and the GST is charged on the catalogue figure while the subtotal
uses yours. The invoice total mixes them.

**2. Typing a discount afterwards silently discards the typed price.** Both
discount handlers end with
`row.find("#txtSalesproductamount").val(productPrice - discountprice)`, where
`productPrice` is the HIDDEN value. Nothing tells the user.

**3. And the TDS is never parsed.** `var Tds = $('#Sales-cart-tds').val();` then
`totalSubtotal + totalGst - Tds` — subtraction on a string. Coercion carries it
for ordinary digits; anything non-numeric makes the whole total `NaN`. It is the
only unparsed value in the function, and the round-off beside it uses
`parseFloat(...) || 0`.

None of the three is reproduced. There is one price, it is the price, and the
server computes everything from it.

### The number

`SalesRepo.CheckSalesInvoiceNo` has the two defects the purchase order numberer
has — read-then-increment with no lock, and `InvoicePef.Trim()` with no null
check inside a catch that returns the error text as the number — plus one it does
not: **it never restarts at 001.** The lookup filters on company alone while the
label uses the current financial year, so `DHP/25-26/157` is followed by
`DHP/26-27/158`.

`document_counters` starts each year at 001, as the format implies. Flagged for
sign-off alongside the same change to purchase orders.

Note the format has **no document-type segment** — `DHP/26-27/001`, against a
purchase order's `DHP/PO/26-27/001`. That asymmetry is the source's and is kept.

### Not built

**BUYERS CODE**, which this document lists under Order attributes, has no column
on `SalesInvoice` — the form field is not stored anywhere. It is not in the port
either; adding a column for it is a decision, not a port.
