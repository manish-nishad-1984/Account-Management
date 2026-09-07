# 10 — Purchase Invoice (list)

`/InvoiceMaster/SupplierInvoiceListView` — "Purchase Invoice".
Primary action: **Create Invoice**.

## A collapsible panel above the list

**"Import Purchase Invoices"**, collapsed in the capture with a chevron. So
invoices are bulk-imported too, not only typed.

## Filters

`Search` · **Select Company** dropdown · `Supplier` free text · **Reset**.
Company-scoped rather than the usual All/Most Recent pair.

## List

| InvoiceNo | Date | Site | Group | Supplier | Company | Total Amount | Action |

| InvoiceNo | Date | Group | Supplier | Amount |
|---|---|---|---|---|
| BB/154 | 07/08/2026 | GOLF CLUB | AL BURHAN PIPES & SANITATION | ₹17,673.00 |
| GSTT/0821 | 03/09/2026 | CC | SHAH ENTERPRISE | ₹2,173,854.00 |
| BE-2026-27-4756 | 03/09/2026 | GOLF CLUB | BHAGAVAT ENTERPRISE | ₹4,080.00 |
| 016 | 31/08/2026 | GOLF CLUB | UDAY SUPPLIERS | ₹542,113.00 |
| 069 | 01/09/2026 | CC | MARUTI-NANDAN CARTING | ₹166,337.00 |
| AE/26-27/00872 | 26/08/2026 | OFFICE | AJARAMAR ENTERPRISE | ₹2,142.00 |

**InvoiceNo is the SUPPLIER's number, not ours.** `BB/154`, `016`, `069`,
`BE-2026-27-4756` — free text in whatever format the supplier uses. It is a
link, like the PO id.

Every row here is site SURAT-AURO UNIVERSITY, company DH PATEL.

**`Group` is a column.** This is the site-group text match — and `OFFICE` is one
of the four groups carrying a trailing carriage return, referenced by 187
invoices. See `04-group-master.md`.

## Bottom right

**Export To Excel** and **Export To Pdf**.

## For the port

1. Invoice numbers are supplier-issued free text, so **no uniqueness can be
   assumed** across suppliers — and probably not within one either.
2. A `Group` on an invoice is a text reference today. It becomes a real foreign
   key only after the whitespace problem is resolved with the business.
3. Export to Excel and PDF are expected on this screen. Phase 5 makes them async
   jobs; until then their absence is visible.
4. The list is filtered by company, which suggests people work one company at a
   time — the same instinct as the global site selector.
