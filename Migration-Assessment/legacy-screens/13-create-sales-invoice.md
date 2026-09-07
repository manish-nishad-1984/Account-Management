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
