# Plan — getting the port to match what the screenshots show

Written 7 Sep 2026, from the legacy captures in this folder. It refines
`13-Migration-Strategy-and-Roadmap.md` rather than replacing it: the phase order
there still holds. What the screenshots change is the **backlog inside each
phase**, because they show four things the .NET source alone did not.

---

## Part 1 — Four gaps in what is ALREADY built

These are in shipped screens. They are not new features; they are the port
falling short of the thing it replaces. Verified against our code, not assumed.

### 1.1 There is no global site selector  ·  ~~the biggest one~~  ·  **DONE**

_Shipped 7 Sep 2026. See SESSION-HANDOFF §5h._

The scope lives in `contexts/SiteScopeContext.tsx`, the control in
`components/SiteScopePicker.tsx`, and the options come from a new
`GET /sites/assignable` that requires no permission — `GET /sites` needs
`site.view`, which is the Site MASTER right, and the purchase-request form was
quietly 403ing for anyone without it.

**What every scoped module must now do** — `usePurchaseRequestList` is the worked
example, and it is three lines:

```ts
const { siteId, isReady } = useScopedSiteId(filters.siteId);
return useListResource(RESOURCE, rowSchema, params, { ...filters, siteId },
  { enabled: isReady });
```

and the screen overrides `isLoading={query.isLoading || !scope.isReady}` on its
grid. Both halves matter: an assigned user's default scope is their FIRST SITE,
not everything, so a list that fetches early shows another site's rows, and a
grid that does not know it is waiting announces "nothing found" for a site it has
not asked about yet.

**Do NOT put a site dropdown on a screen.** The header owns that choice.

### 1.2 Master-detail split vs modal dialog

Legacy: click a row, the right pane fills. No modal. The list stays usable and a
user can walk down it reading records.

Ours: full-width grid plus a modal `FormDialog` that blocks the list.

**This is a real change to how the screen is worked**, not a cosmetic one. It is
arguably better for editing and clearly worse for browsing.

**Do:** put it to the business with both on screen. If the split view wins, it is
a change to `useMasterScreen` and one shared layout — every screen inherits it.
Deciding this AFTER five more screens are built makes it five times the work.

### 1.3 Item Master has no Excel import/export and no price history

`Download File` / `Upload File` sit on Item and Supplier, and the clock icon in
the Action column opens an item's price over time. We have neither.

- **Excel** is how a 758-item catalogue is maintained. Roadmap Phase 2 already
  scoped it to a BullMQ worker; it was not done.
- **Price history** has no schema behind it at all: `items.price_per_unit` is a
  single mutable column. Needs a modelling decision (audit table vs temporal
  rows) before a screen.

### 1.4 Company is missing `landmark`, and geography shows ids not names

`landmark` is on the legacy form and absent from our `companies` table —
confirmed. Add the column, or decide explicitly to drop it.

Geography is worse: the legacy shows `GUJRAT` / `Surat` / `India`; we store bare
integers with no lookup because **the census has never been run** (blocker 1).
Until it is, our company and site forms cannot show what the old ones show. This
is a visible regression with a known cause and a known fix.

---

## Part 2 — What to build next, in order

### Next: Inventory Inward  ·  smallest possible step

Six fields, three rows, no money, no files, no numbering. It reuses everything
purchase requests just established. See `15-inventory-inward.md`.

Do it **after** the site selector, as the first screen built against it.

### Then: Inward Challan  ·  the file-upload module

The real Phase 3 work. See `09-inward-challan.md`. Three new capabilities:

1. **Multiple file upload per challan**, to object storage — not the web
   server's disk, where they live today.
2. A **footer aggregate** on the grid (the legacy totals Quantity to 70013.25).
3. **Explicit search** — two fields, a Search By selector, a Reset button — not
   the as-you-type box every other screen uses.

Still no money. That is the point of finishing Phase 3 before Phase 4.

### Then, and only then: Phase 4 — invoicing

**Build the Purchase Invoice editor FIRST.** `11-create-purchase-invoice.md`
shows why: its line grid carries PRICE, DIS(₹), DIS(%), GST(%), GST(₹), AMOUNT,
and its totals carry TDS, Discount and Adjustment. The purchase order needs a
subset; the sales invoice is the same form with the counterparty swapped and the
Active PO row removed.

Build `LineItemGrid` once, against the superset. Building it against the purchase
order first means writing it twice.

**Two blockers must be answered before this starts, not during:**

- **B-2** — which of the three jQuery GST calculators is correct. They disagree
  today. This grid is where that disagreement becomes money.
- **D7** — purchase returns are added instead of subtracted.

Both are in `19-Business-Decisions-Required.md`. **Nothing about Phase 4 can be
honestly estimated until they come back.**

Two further things the captures add to Phase 4:

- **`document_counters` needs a company dimension.** Purchase orders are numbered
  `DHP/PO/24-25/049` and `DEMO/PO/24-25/001` — the company's invoice prefix leads
  the number. Purchase requests are numbered `PR/` globally. The table is keyed
  `(document_type, financial_year)` today and will need `company_id`.
  **Also**: PO numbers carry a typed free-text suffix (` - OMSAGAR`), so the
  number is part generated and part entered.
- **A rich text editor is an unbudgeted dependency.** Three stored Terms and
  Conditions templates, editable per order, rendered onto the printed PO. Stored
  HTML shown back to users needs sanitising on the way in.

### Then: Phase 5 — reports, payments, dashboard

`14-reports-and-payments.md` and `01-dashboard.md`.

The hard part is not the screens, it is that **payments have no table**. They are
sentinel rows inside `SupplierInvoice` and `SalesInvoice`. That is the largest
piece of modelling left in the whole migration and it is invisible from the UI.

Also: a running balance cannot be paged naively. Credit/Debit/Balance are
cumulative, so the balance must be computed server-side over the whole filtered
set and only then paged.

---

## Part 3 — Sequencing, honestly

```
DONE     site selector                                    (7 Sep 2026, §1.1)
NOW      master-detail decision                          <- business call, do not skip
         Inventory Inward                                 (small, proves the selector)
NEXT     Inward Challan  (file upload, aggregates)        <- completes Phase 3
         Excel import/export, item price history          (parallel, independent)
BLOCKED  Purchase Invoice -> Purchase Order -> Sales      <- needs B-2 and D7
LAST     Reports, payments, dashboard queues              <- needs the payments model
```

**The two things on the critical path are not code.** B-2 and D7 have a 2-4 week
lead time with the business, and the census gates the geography lookups and every
foreign key that is still a bare integer. Everything in the NOW and NEXT rows can
proceed while they are outstanding — which is exactly why the phase order is what
it is.

## Part 4 — Conventions to carry forward

From `00-shell-and-navigation.md`, applied to every screen built from here:

- The permission subject comes from `Form.FormName`. **Read it off the `forms`
  table; do not guess it.** Six subjects in `nav.ts` were wrong and would have
  403'd the moment their screen went live.
- Money and quantities are decimal STRINGS end to end.
- Approval is `approve`, its own right, its own endpoint, stating the value —
  never a toggle.
- Document numbers come from `document_counters`, inside the insert transaction.
- Where the port deviates from the legacy behaviour, record it in that screen's
  file here, with the reason. Two such deviations already exist on purchase
  requests and both are written down.
