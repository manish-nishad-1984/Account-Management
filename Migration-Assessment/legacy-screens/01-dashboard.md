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

## THE PERMISSION FINDING — read this before touching the queues

**All six panels are gated on a single `Dashboard` form permission, not on each
module's own rights.** `Home/Index.cshtml` and its seven partials contain **41**
`UserSession.FormPermisionData.Any(...)` checks and every one of them reads
`FormName == "Dashboard"` — `Dashboard.View` for the panels, `Dashboard.IsApproved`
for the Approve checkboxes, `Dashboard.Edit` and `Dashboard.Delete` for the row
icons.

Two consequences, and they point in opposite directions:

1. **`Dashboard-Approve` is one right that approves five different document
   types** — purchase requests, purchase orders, items, purchase invoices and
   suppliers — regardless of whether the holder has any of those modules' own
   approve rights. That is a privilege-escalation surface, not a design.
2. **Someone who legitimately holds `Purchase Request-Approve` cannot approve
   from the dashboard** without also holding `Dashboard-Approve`.

It is finding C-6 again, and in its worst form: the check is in the view only,
so the underlying endpoints are unguarded either way.

**The port does NOT reproduce this.** Each queue is guarded by its own module's
`approve` right, which is the same departure §5b made for supplier edit and
delete, for the same stated reason — the convention that ported rules keep their
defects covers BUSINESS rules, not missing or wrong authorization checks.

**This changes who can approve what on day one**, so it is in doc 19 with
Question 11.

### A related discovery: Supplier has no approve right of its own

Every other approvable form has a view that reads its own flag —
`FormName == "Item" && a.IsApproved` at `ItemMasterController.cs:97`, and the
same shape for Purchase Request, Inward Challan, Purchase Order and Purchase
Invoice. **The Supplier views read only Add, Edit and Delete.** Supplier
approval happens exclusively on the dashboard, through `Dashboard-Approve`.

So `supplier.approve` is a right the port needs and that no production user
currently holds. An administrator must grant it at cutover, or the Suppliers
queue is read-only for everyone.

## Port status — 4 of 6 built, 8 Sep 2026 (SESSION-HANDOFF §5p)

| Panel | State |
|---|---|
| Purchase Requests | **built** — was already fully endpoint-backed |
| Item | **built** — `isApproved` filter, `PATCH /items/:id/approval`, `POST /items/approvals` added |
| Supplier | **built** — same three, plus the right above |
| Inward Challan | **built** — single approval existed; `POST /inward-challans/approvals` added |
| Purchase Order | not migrated — no table |
| Purchase Invoice | not migrated — no table |

The two that are absent say which and why on the screen, rather than rendering
an empty queue that reads as "nothing is pending" (convention 2).

What held when it was built:
- the queues read the **same hooks the list screens use**, so the dashboard and
  the screen it links to cannot disagree about what "pending" means;
- every bulk endpoint is ONE `UPDATE ... WHERE id = ANY(...)`, replacing the
  finding-P2 methods that loaded the whole table and called `Update()` on every
  row;
- the WHERE carries `isApproved = NOT :isApproved`, so a select-all spanning
  already-approved rows does not flip them off, and the returned `updated` is
  what actually changed rather than how many boxes were ticked;
- select-all skips rows whose `capabilities.canApprove` is false, so the count
  cannot disagree with the ticks;
- the two site-scoped queues honour the header's site selector, which is why the
  empty state keeps the legacy wording about "criteria".
