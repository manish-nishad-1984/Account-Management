# 11 — Existing UI → React Mapping

---

## 1. The prerequisite that blocks everything

**36 MVC endpoints return rendered HTML partials, not JSON. React cannot consume
any of them.**

Because `Helper/APIServices.cs` proves the MVC tier is a pure HTTP proxy, the
correct move is not to convert those 36 actions — it is to **expose the API
directly to React and delete the MVC tier entirely.**

Three things must exist on the API before any screen work begins. None exists today:

1. **JSON contracts with real pagination.** `{ cursor, limit, sortBy, sortDir, filters }`
   → `{ rows, nextCursor, total }`.
2. **Server-authoritative money.** Every total recomputed on save; client values
   discarded. Today three divergent JavaScript implementations exist and **none on
   the server**.
3. **Real authorization plus capability flags on every row DTO**
   (`canEdit`, `canDelete`, `canApprove`) — because permission logic currently lives
   inside Razor partials that will cease to exist.

---

## 2. Recommended React architecture

**Minimum viable. Nothing added because it is popular.**

| Concern | Choice | Why this and not more |
|---|---|---|
| Build | **Vite** | Solves the unbundled-JS problem for free |
| Language | **TypeScript, strict** | Non-negotiable for a financial system |
| Routing | **React Router v7** | Path structure mirrors the current controller/action so existing bookmarks survive |
| **Server state** | **TanStack Query** | The single highest-value library here. Caching, deduplication, invalidation and request cancellation replace ~40 redundant fetches and every `location.reload()` |
| **Client state** | **React Context + `useState`** | ⚠️ **No Redux, no Zustand initially.** Once TanStack Query owns server state, what remains is auth, permissions and theme — three contexts. Add Zustand later only if a genuine need appears |
| Forms | **React Hook Form + Zod** | Zod schemas **shared with the API** via `packages/contracts` |
| Tables | **TanStack Table** (headless) | Server-side pagination is mandatory. Add TanStack Virtual only where a list is genuinely long |
| UI kit | **Mantine** *(or MUI)* | See §3 |
| Money | **decimal.js**, from `packages/domain` | The same calculator the server uses |
| Dates | **date-fns** | Lighter than moment; the current app loads moment.js for very little |
| Charts | **Recharts** | ApexCharts + Chart.js are both loaded today; Chart.js draws nothing |
| Notifications | The UI kit's own | Replaces SweetAlert2 + toastr + lobibox — **three notification libraries are loaded today** |
| Rich text | **TipTap** | Replaces CKEditor 5, which blocks first paint on all 31 screens for one screen's benefit |
| Testing | **Vitest + Testing Library + Playwright** | |

### Explicitly not recommended

| Library | Why not |
|---|---|
| **Redux Toolkit** | Server state belongs to TanStack Query. What is left does not justify Redux's ceremony. Adding it would mean writing slices for data that is already cached correctly |
| Zustand | Same reasoning. Revisit only if a real cross-cutting client state need emerges |
| A CSS-in-JS runtime | Mantine and MUI bring their own; adding another is duplication |
| GraphQL | The access patterns are conventional REST. It would add a layer to solve a problem this system does not have |

---

## 3. UI framework choice

| | Material UI | **Mantine** | Ant Design |
|---|---|---|---|
| Data-dense forms | Good | **Excellent** | Excellent |
| Built-in form hooks | No | **Yes** | Partial |
| Bundle size | Large | **Medium** | Large |
| Look | Distinctly Material | **Neutral** | Distinctly Ant |
| Date/number inputs | Separate package | **Built in** | Built in |
| Table | DataGrid is a paid tier for advanced features | Headless-friendly | Built in |

**Recommendation: Mantine.** This application is dense data-entry — line-item grids,
number inputs, date pickers, multi-selects. Mantine's form primitives and inputs fit
that directly, its visual language is neutral rather than opinionated (the current UI
is generic Bootstrap, so users will not feel a brand shift), and it does not push
advanced table features behind a licence.

**MUI is a defensible alternative** if the team already knows it. Ant Design's
strong visual identity is the main argument against it here.

---

## 4. Folder structure

```
apps/web/src/
  main.tsx
  App.tsx                       router + providers
  lib/
    api-client.ts               generated from OpenAPI; typed
    query-client.ts             TanStack Query defaults
    permissions.ts              usePermission('Supplier Invoice', 'edit')
  contexts/
    AuthContext.tsx             user, access token (in memory), login/logout
    PermissionContext.tsx       the matrix — UI hints ONLY
    ScopeContext.tsx            selected site / company
  components/
    DataGrid/                   server-paged table + toolbar + filters
    EntityForm/                 drawer/modal form shell
    LineItemGrid/               ◄── THE critical shared component (§6)
    CurrencyInput/  Money/      decimal-safe
    EntityAutocomplete/         supplier · item · site pickers
    GeoCascade/                 country → state → city
    PermissionGate/             <PermissionGate form="Item" right="edit">
    FileUpload/  PrintLayout/
  features/
    auth/  dashboard/  companies/  sites/  suppliers/  items/  users/
    purchase-requests/  purchase-orders/  inward/  inventory/
    purchase-invoices/  sales-invoices/  payments/  reports/
      ├─ api.ts                 query + mutation hooks
      ├─ schema.ts              re-exports from packages/contracts
      ├─ ListPage.tsx
      ├─ EditorPage.tsx
      └─ components/
```

---

## 5. Screen-by-screen mapping

| # | Existing screen | React route | Key components | Server cache (TanStack Query) | Hardest part |
|---|---|---|---|---|---|
| 1 | Login | `/login` | `LoginPage` | `useMutation(login)` | Replacing the plaintext-password cookie with refresh tokens. `UserSession` (read by ~80 Razor sites) becomes client state + API claims |
| 2 | Dashboard | `/` | 6 × `ApprovalQueueCard`, `BulkApproveBar` | 6 parallel `useQuery` + 6 `useMutation` with optimistic updates | Six queues with six different bulk-approve payload shapes. The 6 endpoints currently return *everything* and filter to `IsApproved == false` in the controller — the API needs an `unapprovedOnly` filter first |
| 3 | Unauthorised | `/403` | `ErrorPage` | — | Trivial |
| 4 | **Company** | `/masters/companies` | `DataGrid`, `CompanyFormDrawer`, `GeoCascade` | `['companies', filters]`, `['countries'\|'states'\|'cities']` | Cascading country→state→city — today three chained `$.ajax` with `setTimeout(…,100)` hacks. Becomes dependent queries with `enabled`. **Best pilot screen** |
| 5 | Supplier | `/masters/suppliers` | + `ExcelImportModal` | `['suppliers', filters]` | **Excel import.** The current implementation uses ACE OLEDB (`SupplierController.cs:279`) — Windows-only, must be replaced with ExcelJS. A server rewrite, not a UI port. Per-row failures currently vanish to `Console.WriteLine` (`:363`) |
| 6 | **Site** | `/masters/sites` | `ContactRepeater`, `ShippingAddressRepeater`, `SameAsBillingToggle`, 2 × `GeoCascade` | `['sites', filters]` | Two independent geo cascades (billing + shipping), a mirror checkbox, and two dynamic repeaters. 1,493 LOC of jQuery DOM-building collapses to `useFieldArray` — high value, high effort |
| 7 | Site Group | `/masters/site-groups` | `MultiSiteSelect` | `['siteGroups']`, `['siteNames']` | Select2 multi-select → `react-select`. The mirrored readonly `<textarea>`s become derived render |
| 8 | Item | `/masters/items` | `GstToggle`, `ItemHistoryPanel`, `ExcelImportModal` | `['items', filters]`, `['itemHistory', id]`, `['unitTypes']` | **GST-inclusive back-calculation** — 3 identical JS copies plus a *divergent* C# import path. Must become one server rule. Plus a divide-by-zero in `_ItemHistoryPartial.cshtml:26` |
| 9 | Inward Challan | `/inward-challans` | `MultiFileUpload`, `FilePreviewGrid` | `['inwards', filters]` | Multi-file upload with client preview — `useState<File[]>` plus object-URL lifecycle. Server-side, fix the path traversal (`ItemInWordController.cs:181`) and the leaking `FileStream` (`:219`) |
| 10 | Inventory | `/inventory` | `InventoryFormPanel` | `['inventory', filters]` | Small. ⚠️ **Fix the permission-key mismatch first** — the view tests `"Purchase Request"` while the server guards `"Inventory Inward"` |
| 11 | User | `/admin/users` | 2 × multi-select | `['users', filters]` | **Stop rendering the password.** Two validator rule-sets branch on role — unify |
| 12 | Userwise Permission | `/admin/permissions` | `PermissionMatrix` | `['permissions', userId]` | Tri-state check-all across rows, columns and the whole grid — 165 LOC of imperative jQuery becomes derived state. ⚠️ **Add the missing authorization — this screen is currently unguarded** |
| 13 | Purchase Request | `/purchase-requests` | `PRFormPanel` | `['purchaseRequests', filters]` | Modest. Restore validation messages — `errorPlacement` currently returns `true`, suppressing every message (`PurchaseRequestScript.js:313`) |
| 14 | PO List | `/purchase-orders` | `POInvoiceSubGrid`, `POPendingSubGrid` | `['purchaseOrders']`, `['poPending', id]` | Master-detail with two dependent sub-grids. **Delete the `<script src>` inside `_POListPartial.cshtml:62`** — that alone fixes handler accumulation |
| 15 | **Create/Edit PO** | `/purchase-orders/new`, `/:id/edit` | **`LineItemGrid`**, `ItemPickerModal`, `TermsEditor`, `TotalsPanel` | `['purchaseOrder', id]` + reference lists | **The line-item grid.** `_GetItemDetailsPartial.cshtml` is a server-rendered editable row with **duplicate ids on every row** (`id="txtproductquantity"` repeated), mutated by jQuery. ⚠️ **PO uniquely has no discount, no TDS, no round-off — decide whether that is intentional before writing the shared calculator.** ~3 weeks |
| 16 | Display PO | `/purchase-orders/:id` | `PODocumentView` | `['purchaseOrder', id]` | Rewrite `ExportToPdf` entirely — the current 187-line `GetHtmlContentForPdf` emits **unevaluated Razor tokens** and empty totals rows, and is fed to the PDF engine as a raw text fragment, so nothing renders |
| 17-19 | PO Print × 3 | `/print/po/:id` etc. | `POPrintLayout` | `['purchaseOrder', id]` | **Recommendation: do not migrate to React.** Keep server-rendered HTML→PDF (Playwright) with a real `@media print` stylesheet — which does not exist today. Pixel-perfect statutory documents are the wrong job for a SPA |
| 20 | Supplier Invoice List | `/purchase-invoices` | `DataGrid`, `ExportButtons` | `['supplierInvoices', filters]` | The four in-memory filter passes (`InvoiceMasterController.cs:180-218`) move into the API query |
| 21 | Invoice List *(legacy)* | — | — | — | **DO NOT MIGRATE.** Duplicates #20; its sort dropdown calls a fully commented-out function; two panels are `hidden`. Confirm with the business, then delete |
| 22 | **Create/Edit Purchase Invoice** | `/purchase-invoices/new`, `/:id/edit` | `LineItemGrid` + discount, `TotalsPanel` (subtotal/GST/TDS/discount/round-off) | `['supplierInvoice', id]`, `['poDetailsForInvoice', poId]` | **The single hardest screen and the project's risk centre.** (a) Three JS modules load together and **their globals collide — the PO formulas overwrite the Invoice formulas, so TDS and round-off are never applied.** Untangling this is task one. (b) Bidirectional discount amount↔% mutating a visible field via a shadow hidden input. (c) A dead `discount` variable bug. (d) Duplicate `id="cart-tds"`. (e) Two seed paths (blank vs from-PO). **~4 weeks** |
| 23 | Display Invoice | `/purchase-invoices/:id` | `InvoiceDocumentView` | `['supplierInvoice', id]` | Drop the two broken print helpers |
| 24 | Invoice Print | `/print/invoice/:id` | `InvoicePrintLayout` | — | As #17-19 — keep server-rendered |
| 25 | Payout / Payin | `/payments` | `PaymentEntryRepeater`, `LedgerGrid` | `['payoutSummary']`, `['ledger']` | (a) Two server-side DataTables that **currently disable paging** — enabling it is a real behaviour change users will notice. (b) The O(N²) dropdown rebuild disappears with a cached `siteNames` query. (c) ⚠️ **Payments have no invoice allocation** — if the business wants it, that is new schema, not migration |
| 26 | Sales List | `/sales-invoices` | `DataGrid` | `['salesInvoices', filters]` | Mirror of #20. Restore the commented-out export |
| 27 | **Create/Edit Sales Invoice** | `/sales-invoices/new`, `/:id/edit` | **Reuses #22's components** | `['salesInvoice', id]` | Merging with #22. Sales computes `AmtWithDisc` inline while Invoice pre-mutates the price field — **two mechanisms for one concept**. Once #22 is done, **~1 week of reuse** |
| 28 | Display Sales Invoice | `/sales-invoices/:id` | `SalesDocumentView` | `['salesInvoice', id]` | Straightforward |
| 29 | Sales Invoice Print | `/print/sales-invoice/:id` | — | — | Keep server-rendered |
| 30 | Sales Report | `/reports/sales` | `ReportFilters`, `ServerDataGrid` | `['salesReport', filters]` | **Easiest report** — the endpoint already returns clean JSON. Enable paging. Restore the commented-out exports. ⚠️ Add the missing `[FormPermissionAttribute]` |
| 31 | Payment / Details Report | `/reports/payments` | `RunningBalanceColumn`, `EditPayoutModal` | `['ledgerReport', filters]` | (a) Row actions are built as **HTML strings inside `columns.render`** using a JSON-serialised permission blob — becomes a `<PermissionGate>` cell. (b) ⚠️ **Running balance is computed only in the Excel exporter** and shown as a grid column header that is never populated — decide where it belongs. (c) Three different permission-name strings for one screen |

---

## 6. `LineItemGrid` — the component that determines the schedule

Four screens depend on it: Create PO, Create Purchase Invoice, Create Sales
Invoice, and the PR form. It is where all the money arithmetic lives, and it is
where the current system is most broken.

```typescript
// Build this ONCE, against the hardest case (Purchase Invoice — the full superset
// with discount + TDS + round-off), then reuse for PO and Sales.

interface LineItemGridProps {
  control: Control<DocumentForm>;          // react-hook-form
  features: {
    discount: boolean;                     // PO: false, Invoice: true, Sales: true
    tds: boolean;
    roundOff: boolean;
    gstInclusive: boolean;
  };
  onItemPick: () => void;
}
```

**Non-negotiable rules for this component:**

1. `useFieldArray` — never DOM manipulation.
2. Every row has a **stable React key**. The current markup repeats the same `id`
   on every row, which is invalid HTML and the root cause of several jQuery bugs.
3. All arithmetic delegates to `packages/domain/invoice-calculator` — **the same
   module the server uses.** Never duplicated inline.
4. `CurrencyInput` uses decimal-safe parsing. **No `parseFloat` on money** — the
   current code has a `NaN` bug from exactly this.
5. The displayed total is a **preview**. The server recomputes and returns the
   authoritative value, which the client then displays.

Building this once, correctly, against the hardest case is what makes screens 15,
22 and 27 tractable. Building it three times is what makes them a disaster.

---

## 7. Validation mapping

| Today | Target |
|---|---|
| jQuery Validate rules scattered per form | **One Zod schema per entity in `packages/contracts`** |
| `errorPlacement` returning `true`, suppressing all messages (`PurchaseRequestScript.js:313`) | React Hook Form field errors, rendered by the form component |
| Two divergent rule-sets branching on role (`UserListView.cshtml:381` vs `:419`) | One schema with a discriminated union |
| **No server-side validation at all** | The same Zod schema validates on the server. **A schema change cannot drift between tiers** |
| Money validated only in the browser | Server recomputes and rejects mismatches |

---

## 8. Permission handling

```tsx
// PermissionContext holds the matrix. It is a UI HINT ONLY.
// The API enforces independently — see 08-Security-Model-and-Review.md.

<PermissionGate form="Supplier Invoice" right="edit">
  <Button onClick={onEdit}>Edit</Button>
</PermissionGate>
```

Row-level capabilities come from the API on each row DTO
(`canEdit`, `canDelete`, `canApprove`) rather than being recomputed client-side —
which is how the Payment Report currently does it, by serialising a permission blob
into a `columns.render` HTML string.

**Fix during migration:** the three inconsistent permission-name strings on the
Payment Report, the `"Purchase Request"` vs `"Inventory Inward"` mismatch on the
Inventory screen, and the missing attribute on Sales Report.

---

## 9. Recommended wave sequence

| Wave | Screens | Rationale |
|---|---|---|
| **0 — API** | *(no UI)* | JSON contracts, pagination, **server-side money calculator**, real authorization, capability flags. **Blocks everything** |
| **1 — Pilot** | Login, Unauthorised, Company | Prove the shell, auth, `DataGrid`, `GeoCascade`, form drawer on low-risk screens |
| **2 — Masters** | Supplier, Site, Site Group, Item, User, Permissions | Everything downstream depends on these lookups. Also closes the unguarded permission-matrix hole |
| **3 — Simple transactions** | Purchase Request, Inward, Inventory | Exercise repeaters and file upload. **No money maths** |
| **4 — Lists** | PO List, Supplier Invoice List, Sales List | Grid + filter patterns at scale. Retire the legacy Invoice List |
| **5 — Documents (risk centre)** | **Purchase Invoice first**, then PO, then Sales | Build `LineItemGrid` once against the hardest case, reuse twice. Invoice first because it has the full superset |
| **6 — Read & print** | Display PO / Invoice / Sales | Cheap once the document models exist |
| **7 — Reports** | Sales Report, Payment Report, Payments | Two already return JSON. The user-visible change is enabling paging |
| **8 — Dashboard** | Dashboard | Composes waves 2-5 components. Do it last |
| **Never** | 6 print views, legacy Invoice List | Keep print server-rendered; delete the duplicate |

---

## 10. A reframing worth putting to the client

Because the MVC tier is a pure HTTP proxy, the realistic project is **not** "port
31 Razor screens to React."

It is: **"harden and properly expose the existing API, then delete the MVC tier and
build a new client against it."**

That framing matters commercially, because it means waves 0-2 deliver genuine
engineering value — a secure, paginated, correctly-authorised API — **that pays off
even if the React work is later descoped or deferred.**
