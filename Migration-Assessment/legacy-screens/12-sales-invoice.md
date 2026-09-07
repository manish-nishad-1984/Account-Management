# 12 — Sales Invoice (list)

`/Sales/SalesList` — "SalesList". Primary action: **Create SalesInvoice**.

## Filters

`Search` · a **company** dropdown showing **AV ENTERPRISE** (pre-selected, not
"Select Company") · `Supplier` free text · **Reset**.

## List

| Sales InvoiceNo | Date | Customer | Company | Total Amount | Action |

**Empty in the capture** — no sales invoices exist for AV ENTERPRISE.

## Worth noting

1. The column is **Customer**, but the filter beside it is labelled **Supplier**.
   The source stores both sides of the trade in `SupplierMaster`; a customer IS a
   supplier row. That is why `SalesRepo` and `SupplierInvoiceRepo` share so much
   code and so many defects.
2. The company filter defaults to a real company rather than an empty prompt, so
   this screen never shows everything at once.
3. An empty list still renders its header. Our `DataGrid` shows an empty-state
   message instead, which is better, but note the difference.

## For the port

Sales is **Phase 5**, after purchase invoicing. The editor is the same component
with the direction switch flipped (see `13-create-sales-invoice.md`), so most of
the work lands with Phase 4 and this becomes configuration rather than new code —
provided `LineItemGrid` is built against the purchase invoice superset first.
