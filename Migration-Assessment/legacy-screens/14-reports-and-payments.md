# 14 — Reports and Payments

`/Report/ReportDetails` — "Report".

Three stacked panels, each with a purple header. No master-detail split.

## 1. Payout Summary

Filters: All Site · Select Company · Supplier · Select Gr(oup) · Purchase(/Sales)
· a date · magnifier · Reset.

| Site | Supplier | Net Amount |

with a **Total:** row. Exports: **Export To Excel**, **Export To Pdf**.

## 2. Payment Report

The same seven filters, then:

| Invoice No | Date | Site | Group | Supplier | Credit | Debit | Balance | Action |

with a **Total:** row. **This is a running-balance ledger** — assessment 03
screen 31, rated High, 1130 lines of JavaScript.

Exports: **Supplier Excel**, **Export To Excel**, **Export To Pdf** — three
buttons, so there is a supplier-specific export distinct from the grid dump.

## 3. Payment Actions

A **PayOut** button, then:

| # | Payment Status | Date | Site | Description | Amount | Action |

This is where a payment is actually recorded. Assessment 03 notes payments are
stored as **sentinel rows inside `SupplierInvoice` / `SalesInvoice`** rather than
in a table of their own — there is no payments table. That is the single largest
modelling decision left in the migration, and it is not visible from this screen.

## What the port must reckon with

1. **A running balance cannot be computed page by page.** Credit, Debit and
   Balance are cumulative, so keyset pagination changes the numbers unless the
   balance is computed server-side over the whole filtered set (a window
   function) and only then paged. Assessment 05 flags that all three report grids
   currently set `serverSide: true` and `paging: false` — everything on one
   screen.
2. **Enabling pagination here is a visible behaviour change** users will notice.
   Roadmap Phase 5 says manage that expectation early.
3. **Six exports across three panels.** Phase 5 makes them async jobs.
4. Both `Purchase` and `Sales` flow through the same report, so the ledger spans
   both directions.
5. The payments model needs deciding before this screen can be ported honestly.
   Sentinel rows in the invoice tables will not survive a real schema.
