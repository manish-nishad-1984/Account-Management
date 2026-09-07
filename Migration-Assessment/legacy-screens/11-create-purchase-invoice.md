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

- **Discount twice over** — rupees and percent on every line. Which is
  authoritative when both are set? That is business question territory.
- **TDS** — tax deducted at source, at the document level.
- **Adjustment** — the round-off. Assessment finding D-x territory; it is how a
  total is nudged to match a supplier's paperwork.
- **Active PO** — the purchase-order link that is a loose text match today and
  must become a foreign key (assessment 09 section 7.5).

**Build `LineItemGrid` against THIS screen.** It has every column the purchase
order and sales invoice need and four they do not. Building it against the PO
first means rewriting it twice.

And none of it can be built honestly until **B-2** is answered: three different
jQuery calculators compute GST today and they disagree. This grid is where that
disagreement becomes money.
