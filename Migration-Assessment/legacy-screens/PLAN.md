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
- **Price history — the description above was WRONG, and it is now BLOCKED.**
  Corrected 8 Sep 2026 by reading `GetItemHistory` instead of inferring from the
  clock icon.

  It is **not** an audit log of `items.price_per_unit`, so there is no
  audit-table-vs-temporal-rows decision to make. `ItemMasterRepo.GetItemHistory`
  (line 581) returns a `SupplierInvoiceList`: it joins `SupplierInvoices` to
  `SupplierInvoiceDetails` for that `ItemId` and lists **every supplier invoice
  line for the item**, ordered by date. `_ItemHistoryPartial.cshtml` renders
  `InvoiceNo | Supplier | Site | Date | Price | GST | PriceWithGST`, and its
  empty state is literally **"No invoices found."**

  So it is a PURCHASE-price history — what we actually paid, per invoice — and
  it reads two Phase 4 tables that are not migrated. There is nothing to read
  and nothing to model. It moves out of NEXT and into BLOCKED behind supplier
  invoices, alongside everything else in Phase 4.

  The lesson is worth keeping: this entry was written from a screenshot of a
  clock icon, and the icon's obvious meaning was the wrong one.

  **UNBLOCKED 8 Sep 2026.** Those are exactly the two tables that landed as
  `purchase_invoices` and `purchase_invoice_items`, and every column the partial
  renders is now there: `displayNo` for InvoiceNo, the supplier and site joins,
  `document_date`, and `unit_price` / `gst_amount` / `line_total` for Price, GST
  and PriceWithGST. It is a query and a panel, with no business decision behind
  it — back into NEXT.

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
         Dashboard approval queues, 4 of 6                (8 Sep 2026, §01)
         Purchase Orders (list, form, approval)           (8 Sep 2026, §07/§08)
         PO dashboard queue, 5 of 6                       (8 Sep 2026, §01)
         Purchase Invoices (list, form, approval)         (8 Sep 2026, §10/§11)
         Dashboard approval queues, ALL 6                 (8 Sep 2026, §01)
NOW      master-detail ANSWER                            <- with the business now, doc 19 Q12
NEXT     Sales Invoices                                  <- same calculator, now written
         PO delivery addresses + T&C editor              <- see the two carve-outs below
         item price history                              <- UNBLOCKED: reads purchase invoices
BLOCKED  Supplier Excel import                           <- needs the States/Cities census
BLOCKED  Reports, payments, supplier balances            <- needs D7 and the payments model
```

**Purchase orders moved out of BLOCKED on 8 Sep 2026, and the reason is worth
keeping.** They were listed behind B-2 because `08-create-purchase-order.md` said
PO totals become server-authoritative and that this needed the GST answer first.
Checking the screen rather than the phase showed the opposite: it loads one
calculator, and has no discount, TDS or round-off anywhere in it — so there is
nothing for the three calculators to disagree about. B-2 was said at the time to
still block the two INVOICE screens. See §5 of that document for the counts.

**Purchase invoices moved out of BLOCKED on 8 Sep 2026, and this one needs more
care than the purchase order did**, because unlike that case the screen really
does exercise the disagreement — three scripts, and TDS, Discount and RoundOff
all present. What changed is not the screen but what B-2 is asking:

- **The arithmetic was already settled, in code, before this session.**
  `packages/domain/src/invoice-total.ts` carries `asProduced()` — the shipped
  JavaScript reproduced in float, defects included — and `corrected()`, the
  arithmetic the business believes it is getting. Both were written from running
  the real scripts against the real markup, and 24 tests pin them. The invoice
  screens are built on `corrected()`.
- **The source was re-read from scratch before the table was written**, rather
  than trusting that summary, and it agreed on every point. Two findings are
  worth having in this file:
  - **The discount is ONE number in two boxes, not two competing numbers.**
    `11-create-purchase-invoice.md` asks which of rupees and percent is
    authoritative when both are set. `updateDiscount` writes the percent from the
    rupees and `UpdateDiscountPercentage` writes the rupees from the percent, and
    both then write the effective price — so they cannot independently disagree.
    The question cannot arise. The new form offers one input and derives the
    other, so it cannot arise there either.
  - **Every invoice total is a WHOLE RUPEE, with exactly .50 rounding DOWN.**
    `grandTotal = (decimal <= 0.5) ? floor : ceil`. Corroborated by the data: all
    six sample totals in `10-purchase-invoice.md` end in `.00`. This is a business
    rule applied to every document ever issued, reproduced deliberately and
    stated on the screen.
- **What is still open in B-2 is historical remediation** — whether the live
  server runs this build, how far back to investigate invoices saved with a total
  that ignored their own TDS, and whether to keep the round-half-down rule. Those
  are questions about EXISTING DATA and a future decision, not about what the new
  table should hold. Nothing was guessed to build this.

**D7 does not block the invoice screens either, and the reason is the same shape.**
D7 is "purchase returns are added to supplier balances instead of subtracted".
The adding happens in `SupplierInvoiceRepo.cs:227` and its four copies, which
bucket `InvoiceType in ('Purchase Return','Credit Note')` into
`PayOutTotalAmount`. That is a BALANCE aggregate, in reports and payments.
Listing, detailing, creating and approving an invoice never computes a supplier
balance. **D7 still blocks Phase 5**, and the seed now carries returns and credit
notes so that work has data waiting for it.

**Two parts of the PO screen were deliberately NOT built**, and neither is
blocked on the business:

- **Delivery addresses.** `PodeliveryAddresses` is a separate table feeding the
  Shipping Addresses / Group Address panels. Not modelled; the form does not
  pretend to have it.
- **The terms and conditions editor.** The source stores rich-text HTML from a
  full toolbar with three saved templates. The column is plain text for now, and
  the form says so — storing HTML without a sanitiser is stored XSS on the app's
  own origin, the same hole §5l closed on attachments. The editor and the
  sanitiser land together or not at all.

**The two things on the critical path are still not code.** B-2 and D7 have a 2-4
week lead time with the business, and the census gates the geography lookups and
every foreign key that is still a bare integer. Everything in the NOW and NEXT
rows can proceed while they are outstanding — which is exactly why the phase order
is what it is.

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
