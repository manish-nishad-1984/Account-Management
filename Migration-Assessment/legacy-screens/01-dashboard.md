# 01 — Dashboard

`/Home/Index`

Six **pending-approval queues** in a 2x3 grid. This is the approval cockpit, and
it is why `approve` is a first-class right rather than a flavour of edit.

| Panel | Columns |
|---|---|
| Purchase Requests | Site, Date, Item, Unit, Qty, Approve, Action |
| Item | Item, Price, Approve, Action |
| Purchase Order | Purchase-Id, Date, Site, Supplier, Company, Amount, Approve, Action |
| Purchase Invoice | Invoice No, Date, Site, Supplier, Company, Amount, Approve, Action |
| Supplier | Supplier, Gst, Approve, Action |
| Inward Challan | Item, Quantity, Approve, Action |

## The detail that matters

**The Approve column header is itself a checkbox** — select all, then one bulk
action. That is the entry point for `MultiplePurchaseRequestIsApproved` and its
five siblings, all six of which had the finding-P2 defect (load the whole table,
call `Update()` on every row) fixed in this repo.

Each row also carries inline edit and delete icons, so the dashboard is not
read-only.

Empty panels read **"No data found for the selected criteria"** — criteria,
because the panels honour the global site selector in the header.

## Port status

The React `DashboardPage` exists but does not implement these queues.

When it is built:
- it must read through the same repositories as the list screens, not grow its
  own idea of what "pending" means;
- `PurchaseRequestsRepository.setApprovalMany` and `POST
  /purchase-requests/approvals` are already in place for the first panel — one
  UPDATE, permission-guarded, reporting how many rows actually changed;
- the bulk endpoint takes an explicit `isApproved`, so a select-all spanning
  already-approved rows does not flip them off.
