# 11 — Create Invoice (purchase)  ⚠️ THE RISK CENTRE

`/InvoiceMaster/CreateInvoice` — "Create Invoice".

Assessment 03 rates this the highest-complexity screen in the system: 941 lines
of Razor over **5,623 lines of JavaScript**. Phase 4 of the roadmap says build
this FIRST among the three document editors, and the capture shows why.

## A Purchase / Sales switch

Top of Supplier Details is a dropdown reading **"Purchase"**. The same editor
serves both directions — which is how `SalesRepo` and `SupplierInvoiceRepo`
ended up sharing defects.

## Panels

### Supplier Details
Supplier Name (select) · Mobile No · Address · GST NO — read-only after select.

### Invoice Details
Company Name (select) · **Supplier Invoice No (free text, TYPED)** · Order Date ·
Billing Address · GST NO

**Contrast with the purchase order**, where the number is generated and
read-only. Here it is the supplier's number and is typed in.

### Add Product — the widest line-item grid in the app

| NO | PRODUCT | HSN | QTY | QTY TYPE | PRICE(₹) | DIS(₹) | DIS(%) | GST(%) | GST(₹) | AMOUNT(₹) |

Plus a per-row **+ Item Description** expander, an add (+) and a delete button.

**This is the superset**: PRICE, then discount in BOTH rupees and percent, then
GST in both percent and rupees, then the amount. `DIS(₹)` and `DIS(%)` both
default to `0`.

### Order attributes (left)
Challan/Document No · BUYERS CODE · **Active PO** (read-only — the link back to a
purchase order) · Vehicle No · Dispatch By · Payment Terms

### Totals (right) — six lines, not three
Sub Total · Total GST · **TDS** · **Discount** · **Adjustment** · Total Amount

TDS and Adjustment render `₹0.00` and appear read-only/derived; Sub Total, Total
GST, Discount and Total Amount render `0.00`.

### Shipping Addresses / Group Addresses
Two panels, as on the purchase order.

Final action: **Create Invoice**.

## Why this screen decides the money model

Everything the assessment calls out is visible in one place:

- ~~**Discount twice over** — rupees and percent on every line. Which is
  authoritative when both are set? That is business question territory.~~

  **THIS IS ANSWERABLE FROM THE CODE, and the answer is "neither, because they
  cannot disagree" — corrected 8 Sep 2026 by reading the handlers.**
  `InvoiceMasterScript.js` binds both boxes, and each writes the other:

  ```js
  updateDiscount(row)           // rupees typed  -> writes .txtdiscountpercentage
  UpdateDiscountPercentage(row) // percent typed -> writes .txtdiscountamount
  ```

  Both then write `.txtproductamount`, the effective price the totals actually
  read. So there is no state in which the two hold different discounts — the
  second field is a rendering of the first, and the stored pair is one fact
  written twice. Not business question territory.

  The port stores it ONCE, in rupees per unit, and derives the percent for
  display. The form offers one input, so the ambiguity cannot be created there
  either. The ETL must still RECONCILE the legacy pair and report rows where they
  disagree — a row that does disagree was written by something other than these
  two handlers and is worth seeing.
- **TDS** — tax deducted at source, at the document level.
- **Adjustment** — the round-off. Assessment finding D-x territory; it is how a
  total is nudged to match a supplier's paperwork.
- **Active PO** — the purchase-order link that is a loose text match today and
  must become a foreign key (assessment 09 section 7.5).

**Build `LineItemGrid` against THIS screen.** It has every column the purchase
order and sales invoice need and four they do not. Building it against the PO
first means rewriting it twice.

~~And none of it can be built honestly until **B-2** is answered: three different
jQuery calculators compute GST today and they disagree. This grid is where that
disagreement becomes money.~~

**BUILT 8 Sep 2026.** The sentence above was right that the disagreement is real
— unlike on the purchase order screen, this one loads three scripts and does have
TDS, Discount and RoundOff. What it got wrong is what B-2 is asking.

The arithmetic had already been settled in code, by running the real scripts
rather than reading them: `packages/domain/src/invoice-total.ts` holds
`asProduced()` (the shipped behaviour, defects included) beside `corrected()`
(the arithmetic the business believes it has), with 24 tests. The source was
re-read from scratch before the table was written, and agreed on every point.
The two findings that most change this document are the discount one struck
through above, and this:

**Every invoice total is a WHOLE RUPEE, with exactly .50 rounding DOWN.**

```js
var decimal = grandTotal - Math.floor(grandTotal);
grandTotal = (decimal <= 0.5) ? Math.floor(grandTotal) : Math.ceil(grandTotal);
```

Nothing in the assessment recorded this, and the data corroborates it: all six
sample totals in `10-purchase-invoice.md` end in `.00`. Commercial rounding takes
.50 UP; this takes it down, always in the supplier's favour. It is a business
rule applied to every document ever issued, so it is reproduced, defaulted on,
and stated on the screen — turning it off changes what suppliers are paid and
needs question 1 answered first.

What remains open in B-2 is **historical remediation**: whether the live server
runs this build, how far back to investigate invoices saved with a total that
ignored their own TDS, and whether to keep the half-down rule. Those are
questions about existing data. Nothing was guessed to build the screen.
