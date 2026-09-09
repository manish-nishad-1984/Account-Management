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

## Built 9 Sep 2026

List, form, single and bulk approval. Point 1 above is confirmed and is now a
column name: the counterparty column says **Customer**, because that is what it
is, and the form's dropdown carries a hint saying the list is shared with
suppliers. The COLUMN in the database is `sales_invoices.customer_id` and it
references `suppliers` — splitting the party master is a real modelling question
with a data migration behind it, so the name at least stops the next reader
thinking a sales invoice bills a supplier.

Point 2 is reproduced as a filter but NOT as a forced default: the company
dropdown offers "All companies" and starts there. The legacy screen's
pre-selected company means it never shows everything at once, which is a
different thing from choosing to narrow.

Point 3 stands — the empty state is a message rather than a bare header.

## For the port

~~Sales is **Phase 5**, after purchase invoicing.~~ It landed immediately after
purchase invoicing, on the same day, because the editor really was the same
component — see below.

The editor is the same component with the direction switch flipped (see
`13-create-sales-invoice.md`), so most of the work lands with Phase 4 and this
becomes configuration rather than new code — provided `LineItemGrid` is built
against the purchase invoice superset first. **That is what happened**: the grid
lives at `apps/web/src/features/invoices/InvoiceLineGrid.tsx`, and the purchase
form was refactored onto it rather than the sales form being copied from it.
