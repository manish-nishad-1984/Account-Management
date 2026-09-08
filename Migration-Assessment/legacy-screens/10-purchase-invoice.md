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

## Built 8 Sep 2026

The list, the form, single and bulk approval, and the sixth dashboard queue.
Three things this document said, checked against the source while building:

1. **"InvoiceNo is the SUPPLIER's number" — right, but there are TWO columns.**
   `SupplierInvoice` has `SupplierInvoiceNo` AND `InvoiceNo`, and the partial
   picks between them with `@if (item.SupplierInvoiceNo == "")`. That test is
   `== ""`, which a NULL fails — so an invoice with no supplier number takes the
   ELSE branch and renders an empty, unclickable link. Both columns are carried,
   and the API computes a `displayNo` where null, empty and whitespace all mean
   the same thing, with a last-resort placeholder so the cell is never blank.
2. **Every sample total on this page ends in `.00`, and that is not a
   coincidence.** The calculator rounds the grand total to a whole rupee with
   exactly .50 going DOWN. See `11-create-purchase-invoice.md`.
3. **There is no Active/Inactive filter, and there should not be.** The table has
   no `IsActive` and no `IsDeleted`, which is also why deleting an invoice in the
   new screen really deletes it — there is no soft-delete column to set, and the
   confirmation says so rather than promising the record is kept.

## For the port

1. Invoice numbers are supplier-issued free text, so **no uniqueness can be
   assumed** across suppliers — and probably not within one either.
2. A `Group` on an invoice is a text reference today. It becomes a real foreign
   key only after the whitespace problem is resolved with the business.
3. Export to Excel and PDF are expected on this screen. Phase 5 makes them async
   jobs; until then their absence is visible.
4. The list is filtered by company, which suggests people work one company at a
   time — the same instinct as the global site selector.
