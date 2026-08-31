# 03 — Module & Screen Inventory

---

## 1. Module inventory

Complexity is rated from lines of code, number of screens, number of endpoints, and
the density of business rules found. Migration priority is the recommended order,
derived from dependency (masters before transactions) and risk (build the hardest
shared component once, against the hardest case).

| # | Module | Repository | LOC | Screens | Endpoints | Key tables | Complexity | Priority |
|---|---|---|---|---|---|---|---|---|
| 1 | **Authentication & Users** | `UserAuthentication.cs` | 550 | 3 | 7 | `User`, `UserwiseFormPermission`, `Form`, `Site`, `Company` | **High** | **P1** |
| 2 | **Permissions** | `FormPermissionMasterRepo.cs` | 114 | 1 | 3 | `UserwiseFormPermission`, `Form` | Medium | **P1** |
| 3 | **Reference data** | `MasterListRepo.cs`, `FormMasterRepo.cs` | 122 | — | 3 | `Country`, `State`, `City`, `Form` | Low | **P1** |
| 4 | **Company** | `CompanyRepo.cs` | 289 | 1 | 6 | `Company`, `City`, `State`, `Country` | Low | **P2** |
| 5 | **Site & Site Group** | `SiteMasterRepo.cs` | 867 | 3 | 16 | `Site`, `SiteAddress`, `GroupMaster` | **High** | **P2** |
| 6 | **Supplier** | `SupplierMasterRepo.cs` | 514 | 1 | 9 | `SupplierMaster`, `City`, `State` | Medium | **P2** |
| 7 | **Item & Unit** | `ItemMasterRepo.cs` | 687 | 1 | 14 | `ItemMaster`, `UnitMaster` | Medium | **P2** |
| 8 | **Purchase Request** | `PurchaseRequestRepo.cs` | 354 | 1 | 8 | `PurchaseRequest` | Medium | **P3** |
| 9 | **Inward Challan** | `ItemInwardRepo.cs` (+ dead duplicate) | 436 | 1 | 9 | `ItemInword`, `ItemInWordDocument` | Medium | **P3** |
| 10 | **Inventory** | (part of `SalesRepo.cs`) | — | 1 | 4 | `InventoryInward` | Low | **P3** |
| 11 | **Purchase Order** | `PurchaseOrderRepo.cs`, `PurchaseOrderDetailsRepo.cs` | 1,221 | 7 | 17 | `PurchaseOrder`, `PurchaseOrderDetail`, `PodeliveryAddress` | **Very High** | **P4** |
| 12 | **Supplier Invoice** | `SupplierInvoiceRepo.cs`, `SupplierInvoiceDetailsRepo.cs` | 2,161 | 6 | 20 | `SupplierInvoice`, `SupplierInvoiceDetail` | **Very High** | **P4** |
| 13 | **Sales Invoice** | `SalesRepo.cs` | 1,478 | 6 | 20 | `SalesInvoice`, `SalesInvoiceDetail` | **Very High** | **P5** |
| 14 | **Payments (payout/payin)** | (within `SupplierInvoiceRepo`/`SalesRepo`) | — | 1 | — | `SupplierInvoice`, `SalesInvoice` (sentinel rows) | **High** | **P5** |
| 15 | **Reports** | (across repos) | — | 2 | 10 | Multiple | **High** | **P6** |
| 16 | **Dashboard** | (Web tier only) | — | 1 | 0 | Multiple | **High** | **P7** |

**Total: 10,304 lines across 16 repositories, 31 screens, 138 endpoints.**

---

## 2. Module dependency graph

```
                          ┌──────────────────┐
                          │  Reference data  │  Country · State · City · Form · Unit
                          └────────┬─────────┘
                                   ▼
                          ┌──────────────────┐
                          │  Users & Perms   │  ← everything depends on this
                          └────────┬─────────┘
                                   ▼
           ┌───────────────┬───────┴───────┬───────────────┐
           ▼               ▼               ▼               ▼
      ┌─────────┐   ┌───────────┐   ┌──────────┐   ┌──────────┐
      │ Company │   │   Site    │   │ Supplier │   │   Item   │
      └────┬────┘   └─────┬─────┘   └────┬─────┘   └────┬─────┘
           │              │              │              │
           └──────┬───────┴──────┬───────┴──────┬───────┘
                  ▼              ▼              ▼
         ┌─────────────────┐  ┌─────────┐  ┌──────────┐
         │ Purchase Request│  │ Inward  │  │Inventory │
         └────────┬────────┘  └─────────┘  └──────────┘
                  │  ⚠ NO LINK EXISTS in the data model
                  ▼
         ┌─────────────────┐
         │ Purchase Order  │
         └────────┬────────┘
                  │  linked only by matching the PO *number string*
                  ▼
         ┌─────────────────┐         ┌─────────────────┐
         │Supplier Invoice │         │  Sales Invoice  │
         └────────┬────────┘         └────────┬────────┘
                  └────────────┬──────────────┘
                               ▼
                    ┌──────────────────┐
                    │ Payments · Reports · Dashboard │
                    └──────────────────┘
```

> **Two structural gaps visible in this graph, both confirmed in code:**
>
> **No PR → PO link.** `PurchaseRequest` has no `POId`; `PurchaseOrder` has no `PRId`.
> There is no method anywhere that converts a purchase request into a purchase order.
> If that conversion happens in the business, it is manual re-entry.
> *(Rule D13 — no conversion method found.)*
>
> **PO → Invoice is matched by string.** `PurchaseOrderRepo.cs:990` joins
> `po.Poid equals si.Poid` — a `nvarchar(100)` PO *number*, not a foreign key. Any
> whitespace or case difference silently breaks the match and the PO reports 100%
> pending. This must become a real `purchase_order_id uuid` FK in PostgreSQL, which
> requires a text-matching reconciliation exercise during migration.

---

## 3. Screen inventory

31 screens (non-partial views), plus 62 partials used as AJAX fragments.

**Legend:** C=Create R=Read U=Update D=Delete · Cx = complexity ·
LOC figures are (view LOC / driving JS module LOC).

| # | Screen | Route | Purpose | CRUD | Grid paging | Export | Cx | Pri |
|---|---|---|---|---|---|---|---|---|
| 1 | Login | `/Authentication/UserLogin` | Sign in | — | — | — | Low | P1 |
| 2 | Unauthorised | `/Home/UnAuthorised` | 401 page | — | — | — | Low | P1 |
| 3 | **Dashboard** | `/Home/Index` | 6 pending-approval queues + bulk approve | R,U | none | — | **High** (927/1912) | P7 |
| 4 | Company | `/Company/CreateCompany` | Company master | CRUD | none | — | Med (—/14k) | P2 |
| 5 | Supplier | `/Supplier/SupplierList` | Supplier master + Excel import | CRUD | none | Excel | Med (—/18k) | P2 |
| 6 | Site | `/SiteMaster/SiteListView` | Site master, 2 addresses, contacts | CRUD | none | — | **High** (—/1493) | P2 |
| 7 | Site Group | `/SiteMaster/CreateGroup` | Group of sites | CRUD | none | — | Med | P2 |
| 8 | Item | `/ItemMaster/ItemListView` | Item master, GST, history, Excel import | CRUD | none | Excel ×3 | Med (—/786) | P2 |
| 9 | User | `/User/UserListView` | User admin | CRUD | none | — | Med | P1 |
| 10 | Userwise Permission | `/User/UserwisePermission` | Permission matrix | R,U | none | — | **High** | P1 |
| 11 | Purchase Request | `/PurchaseMaster/PurchaseRequestListView` | PR list + create | CRUD | none | — | Med | P3 |
| 12 | Inward Challan | `/ItemInWord/ItemInWord` | Goods inward + multi-file upload | CRUD | none | — | Med (—/856) | P3 |
| 13 | Inventory | `/Sales/CreateInventory` | Inventory inward | CRUD | none | — | Low | P3 |
| 14 | PO List | `/PurchaseMaster/POListView` | PO list + 2 sub-grids | R,D | none | — | Med | P4 |
| 15 | **Create/Edit PO** | `/PurchaseMaster/CreatePurchaseOrder` | PO editor, line items, terms | C,U | — | — | **Very High** (1023/2377) | P4 |
| 16 | Display PO | `/PurchaseMaster/DisplayPODetails` | PO detail view | R | — | PDF | Med (452) | P4 |
| 17 | PO Print | `/PurchaseMaster/POPrintDetails` | Printable PO | R | — | Print | Med (437) | P6 |
| 18 | PO Print (JK) | `/PurchaseMaster/PrintJKDetails` | Alternate print layout | R | — | Print | Med | P6 |
| 19 | PO Print (Ultra) | `/PurchaseMaster/PurchaseUltraView` | Alternate print layout | R | — | Print | Med | P6 |
| 20 | Supplier Invoice List | `/InvoiceMaster/SupplierInvoiceListView` | Purchase invoice list | R,D | none | Excel, PDF | Med | P4 |
| 21 | Invoice List *(legacy)* | `/InvoiceMaster/InvoiceListView` | **Duplicate of #20** | R | none | — | — | **Delete** |
| 22 | **Create/Edit Purchase Invoice** | `/InvoiceMaster/CreateInvoice` | Invoice editor — the risk centre | C,U | — | — | **Very High** (941/5623) | P4 |
| 23 | Display Invoice | `/InvoiceMaster/DisplayInvoiceDetails` | Invoice detail | R | — | — | Med | P4 |
| 24 | Invoice Print | `/InvoiceMaster/InvoicePrintDetails` | Printable invoice | R | — | Print | Med (512) | P6 |
| 25 | **Payout / Payin** | `/InvoiceMaster/PayOutInvoice` | Supplier & customer payments | CRUD | `serverSide:true`, `paging:false` | Excel | **High** (453/1006) | P5 |
| 26 | Sales List | `/Sales/SalesList` | Sales invoice list | R,D | none | — | Med | P5 |
| 27 | **Create/Edit Sales Invoice** | `/Sales/CreateSalesInvoice` | Sales invoice editor | C,U | — | — | **Very High** (593/1184) | P5 |
| 28 | Display Sales Invoice | `/Sales/DisplaySalesInvoiceDetails` | Sales detail | R | — | — | Med | P5 |
| 29 | Sales Invoice Print | `/Sales/PrintSalesInvoiceDetails` | Printable sales invoice | R | — | Print | Med (488) | P6 |
| 30 | Sales Report | `/Sales/SalesReport` | Sales report | R | `serverSide:true`, `paging:false` | Excel ×4 | Med | P6 |
| 31 | Payment / Details Report | `/Report/ReportDetails` | Ledger with running balance | R,U,D | `serverSide:true`, `paging:false` | Excel | **High** (—/1130) | P6 |

---

## 4. Findings from the screen inventory

### 4.1 Pagination — the headline

**16 of 19 grids have no pagination at all.** They are server-rendered Razor
partials containing every row, injected with `$('#tbl').html(result)`.

The 3 grids that *do* use DataTables server-side mode (`Payout`, `Sales Report`,
`Payment Report`) set **`serverSide: true` alongside `paging: false`** — which
requests every row from the server in a single call, defeating the server-side
plumbing that was built. `DataTableRequstModel` carries `skip` and `pageSize`
fields (`DataTableRequstModel.cs:17-18`) that **no repository ever reads.**

This is the single highest-leverage fix available in the entire system.

### 4.2 Search has no debouncing

Every list screen wires search to `onkeyup` (11 confirmed sites, e.g.
`SiteListView.cshtml:51`, `POListView.cshtml:49`, `SalesList.cshtml:48`). Each
keystroke triggers: MVC action → HTTP to the API → full unpaged query →
in-memory filter → Razor render of every row → HTML over the wire → DOM replace.

Typing "cement" issues **six** full list rebuilds. There is no request
cancellation anywhere, so responses can land out of order and show stale data.

Exactly one `debounce` helper exists in the codebase
(`InvoiceMasterScript.js:195`) and it is applied only to money inputs, never to
a search box.

### 4.3 Filtering happens in the wrong tier

Site and company filters are applied **in the MVC controller, in memory**, after
the full result set has already crossed two network hops:

- `InvoiceMasterController.cs:180-218` — four sequential `.Where()` passes plus two dictionary rebuilds
- Also at `PurchaseMasterController.cs:429`, `SalesController.cs:159/175/188/194`, `HomeController.cs:130/161/187/225/278`, `SiteMasterController.cs:304`

The filter is never pushed to the API or the database.

### 4.4 A partial re-injects an 88 KB script on every refresh

`_POListPartial.cshtml:62` contains `<script src="~/moduls/purchaserequestscript.js"></script>`.
This partial is the AJAX response body for the PO list. Every search keystroke
re-injects the tag and re-runs the whole 2,377-line module, **re-registering every
`$(document).on(...)` delegate**. Handlers accumulate: after *N* refreshes, each
click fires *N* times.

### 4.5 A live production bug on Create Invoice

`CreateInvoice.cshtml:896-898` loads three of the largest JS modules together:

```razor
<script src="~/moduls/invoicemasterscript.js" asp-append-version="true"></script>
<script src="~/moduls/purchaserequestscript.js" asp-append-version="true"></script>
<script src="~/moduls/salesinvoicemasterscript.js"></script>
```

All three define global functions with identical names — `updateProductTotalAmount`,
`updateTotals`, `removeItem`, `preventEmptyValue`. There is no module system, so
**last one wins**. Because `purchaserequestscript.js` loads *after*
`invoicemasterscript.js`, the **Purchase Order formulas overwrite the Invoice
formulas** — and PO has no discount, no TDS and no round-off.

The inline `onclick="updateProductTotalAmount(this)"` at `CreateInvoice.cshtml:262`
and `:357` therefore calls the PO implementation. `#cart-tds` and
`#IDiscountRoundOff` are never read on this screen.

**This should be verified against production behaviour immediately** — it is
findable in thirty seconds and, if confirmed, means purchase invoices have been
computed without TDS and round-off.

### 4.6 Redundant reference-data fetches

No caching layer exists. The same six dropdown lists are fetched from ~40 distinct
call sites:

| Endpoint | Distinct call sites |
|---|---|
| `/ItemMaster/GetAllUnitType` | 8 |
| `/ItemMaster/GetItemNameList` | 9 |
| `/SiteMaster/GetSiteNameList` | 8 |
| `/Supplier/GetSupplierNameList` | 6 |
| `/Company/GetCompanyNameList` | 5 |
| `/SiteMaster/GetGroupNameListBySiteId` | 4 |

`fn_autoselect` (`Main_Layout.cshtml:870-899`) re-fetches on *every* element it
wires — `AuthenticationScript.js:1337-1341` calls it five times, producing five
separate fetches of two static lists.

### 4.7 Full-page reloads instead of state updates

Because mutations return only `{Message, Code}`, the app hard-navigates.
`Main_Layout.cshtml:955` sets the HTML and then immediately throws it away:

```js
$("#tbPndingApproval").html(result);
sessionStorage.setItem('SelectedSiteId', selectedSiteId);
location.reload();       // ← discards what was just fetched
```

The reload re-runs all nine top-level dashboard calls.

### 4.8 Dead and duplicated code

- **Screen #21 (`InvoiceListView`) duplicates #20.** Its sort dropdown binds
  `onchange="InvoiceSortTable()"` (`InvoiceListView.cshtml:38`) to a function that
  is **entirely commented out** (`InvoiceMasterScript.js:1094-1112`) — the control
  throws `ReferenceError` when used. Two of its panels are `hidden`. Confirm with
  the business, then delete.
- **`ItemInWordRepo.cs` (439 lines) is an unregistered duplicate** of
  `ItemInwardRepo.cs`. It is not in the DI container. Dead code.
- **`_ReportDetailsPartial.cshtml` is 115 lines entirely inside `@* … *@`.**
- **~440 lines of commented-out `DbHelper` stored-procedure code** in
  `SupplierInvoiceRepo.cs` and `PurchaseOrderRepo.cs`.
- **The entire 15-file service layer is pass-through** and can be deleted.
- Never-loaded packages in `.csproj`: jszip, pdfmake, vfs_fonts, dayjs,
  lordicon, and 57 Select2 locale files. Chart.js is loaded but **no chart is
  initialised anywhere**.

### 4.9 Permission-key mismatches

`CreateInventory.cshtml:32` and `:85` test the permission `"Purchase Request"`
while the server guards the same action with `"Inventory Inward"`
(`SalesController.cs:465`). The Payment Report screen uses **three different
permission-name strings** for one screen. `SalesReport` (`:40`) has **no
`[FormPermissionAttribute]` at all**.

---

## 5. What is genuinely absent

Stated explicitly so the migration does not budget for work that does not exist:

| Capability | Status |
|---|---|
| Email / SMTP | **NONE FOUND** anywhere in the solution |
| SMS | **NONE FOUND** |
| WhatsApp | **NONE FOUND** |
| Payment gateway | **NONE FOUND** |
| GST portal / e-invoicing / IRN | **NONE FOUND** |
| Bank feed | **NONE FOUND** |
| Any third-party API | **NONE FOUND** |
| Background jobs / scheduling | **NONE FOUND** |
| Notifications (in-app or push) | **NONE FOUND** |
| PDF library | **NONE FOUND** — "PDF" screens are Razor views + `window.print()` |
| Stock-on-hand calculation | **NONE FOUND** — no method computes inward − outward |
| PR → PO conversion | **NONE FOUND** |
| Multi-currency | **NONE FOUND** |
| Approval workflow beyond a single boolean | **NONE FOUND** — no pending/partial/complete state model |

> This is genuinely good news for the migration. There are **no external
> integrations to re-establish**, which removes an entire category of risk that
> usually dominates projects of this kind.
