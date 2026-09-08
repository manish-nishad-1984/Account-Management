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

### 1.2 Master-detail split vs modal dialog  ·  **BOTH BUILT — awaiting the business**

_Both layouts shipped 8 Sep 2026. The question is now doc 19 Question 12, and it
can be answered on the real screens in two minutes._

Legacy: click a row, the right pane fills. No modal. The list stays usable and a
user can walk down it reading records.

Ours: full-width grid plus a modal `FormDialog` that blocks the list.

**This is a real change to how the screen is worked**, not a cosmetic one. It is
arguably better for editing and clearly worse for browsing.

A written description is a poor way to ask, so both are in the header switch
(`RecordLayoutPicker`) and every screen has both. **It is three shared files and
no page changes:**

| File | Does |
|---|---|
| `contexts/RecordLayoutContext.tsx` | the preference, per user, in localStorage |
| `components/ui/FormDialog.tsx` | renders `Modal` or `SidePanel` |
| `lib/use-master-screen.ts` | adds row-click and selection to `gridProps` in split mode |

Every page already spreads `screen.gridProps(query)`, which is why row-click and
the selected-row highlight arrived on twelve screens without touching one of
them. **That property is the whole argument for deciding now:** the machinery is
shared today, and each new screen built against one layout is another that has to
be re-checked against the other.

Outside a provider the context answers `modal` — what every screen shipped with —
so nothing changed for any existing test.

**Two things worth knowing when the answer comes back:**

- The pane is a labelled `region`, not `complementary`: the nav sidebar is an
  `<aside>` and already owns that role. Found by driving a real browser, where
  the query for one landmark matched both.
- The reserved width was silently not applied at first — a conditional
  `sm:pr-[29rem]` lost to a base `lg:px-8`, because Tailwind emits `sm:` before
  `lg:`. The pane sat on top of 415px of the list and **looked correct in a
  screenshot**. Only measuring the boxes in the browser caught it.

**When the business answers, delete the loser and the switch.** A permanent
toggle is two layouts to test and support, and a question that never closes.

### 1.3 Item Master Excel · **ITEM DONE** · price history and Supplier still open

`Download File` / `Upload File` sit on Item and Supplier, and the clock icon in
the Action column opens an item's price over time.

**Item Master's pair shipped 8 Sep 2026. See SESSION-HANDOFF §5o.**

- **Excel, on Item** — done. `GET /items/export` and `POST /items/import`, one
  shared column list in `contracts/item-sheet.ts`, all-or-nothing with every bad
  row reported at once. **Not** a BullMQ worker: 758 items validate and insert in
  one transaction in well under a second, and a queue would have added Redis to
  the deployment to make a fast thing asynchronous. Revisit only if a real file
  ever takes long enough to time out.
- **The legacy pair does not round-trip, and that is the headline.** Its exporter
  writes `Item Name | Unit type | PricePerUnit | Gst(%) | HSN Code`; its importer
  reads `ItemName | UnitType | PricePerUnit | GSTPer | HSNCode`. Four of five
  disagree, so the downloaded file cannot be uploaded back — silently, because
  the missing column throws per row inside a `catch` that only writes to the
  console. Ours is one list both halves share, with a test that fails if they
  ever drift.
- **Excel, on Supplier — BLOCKED, and not on effort.**
  `SupplierMasterRepo.ImportSupplierListFromExcel` resolves a State NAME and a
  City NAME against the `States` and `Cities` tables to get their ids. Those
  tables have never been extracted (blocker 1), and our `suppliers.city_id` /
  `state_id` are bare integers with no lookup behind them — §1.4 below. There is
  nothing to resolve a name against, so the import cannot be written honestly.
  **This one needs the census, not a session.**
- **Price history** has no schema behind it at all: `items.price_per_unit` is a
  single mutable column. Needs a modelling decision (audit table vs temporal
  rows) before a screen. Now the NEXT row on its own.

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

### ~~Then: Inward Challan  ·  the file-upload module~~  ·  **DONE**

_Shipped 7 Sep 2026. All three capabilities. See `09-inward-challan.md`._

1. **Multiple file upload per challan.** The storage question was answered by
   putting a `DocumentStorage` interface in front of it and shipping the local
   disk — what the business already runs, needing no new infrastructure. Object
   storage is one new class and one line in `storage.module.ts`.
2. A **footer aggregate** on the grid (the legacy totals Quantity to 70013.25).
3. **Explicit search** — two fields, a Search By selector, a Reset button.

**What every module that gains attachments now does**, and none of it needs
repeating per module:

```ts
constructor(@Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage) {}
```

- The **key is generated**, never derived from the uploaded name
  (`newStorageKey`). The name is a column.
- The **allowlist and the size cap live in `contracts/attachments.ts`**, so the
  browser and the server refuse the same files with the same sentence.
- **Downloads go through the API**, never a static path — `attachment`,
  `nosniff`, and a content type read from the file's own signature.
- The route needs **`edit`, not `add`**: changing what is attached to a document
  is changing the document.

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
         Inventory Inward                                 (7 Sep 2026, §15)
         Inward Challan  (aggregates, filters)            (7 Sep 2026, §09)
         file upload for challans                         (7 Sep 2026, §09)
         both record layouts, for comparison              (8 Sep 2026, §1.2)
         Item Master Excel import/export                  (8 Sep 2026, §1.3)
NOW      master-detail ANSWER                            <- with the business now, doc 19 Q12
NEXT     item price history                               (needs a modelling decision — ours)
BLOCKED  Supplier Excel import                           <- needs the States/Cities census
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
