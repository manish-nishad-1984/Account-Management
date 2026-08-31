# 07 — Business Rule Inventory

> **This is the most important document in the pack for migration safety.**
>
> These rules are the system's actual behaviour. Several are wrong. Several exist
> only in browser JavaScript. Two screens implement the same rule differently.
> None of them is tested.
>
> **A rule marked ⚠️ is a defect, not a specification.** For each one, the business
> must decide whether the migration preserves the existing behaviour (bug included)
> or corrects it. That decision cannot be made by the development team alone.

---

## Group D1 — Document numbering

### RULE D1 — Supplier Invoice number
| | |
|---|---|
| **Location** | `SupplierInvoiceRepo.cs:879-929` |
| **Trigger** | UI requests a number before rendering the create-invoice form |
| **Input** | `Guid? CompanyId` |
| **Output** | `{Company.InvoicePef}/{YY}-{YY}/{NNN}` — e.g. `ABC/24-25/001` |
| **Processing** | Find the most recent invoice for the company ordered by `CreatedOn`; take the segment after the last `/`; `Regex.Match(@"\d+$")`; `+1`; format `D3` |
| **Exclusions** | Rows where `InvoiceNo` is `"PayOut"` or `"Opening Balance"` are skipped |
| **Validation** | Company must exist; the last number must end in digits |
| **DB dependency** | `SupplierInvoice`, `Company.InvoicePef` |
| **Error behaviour** | ⚠️ **Both exceptions are caught and the literal string `"Error generating supplier invoice number."` is returned as the invoice number, with HTTP 200** (`:923-928`) |

### RULE D2 — Sales Invoice number
`SalesRepo.cs:26-76`. Same format. Excludes `SalesInvoiceNo != "PayIn"` (`:38`).
Error string `"Error generating sales invoice number."` (`:73`).

### RULE D3 — Purchase Order number
`PurchaseOrderRepo.cs:71-119`. Format `{InvoicePef}/PO/{YY}-{YY}/{NNN}` — note the
extra `/PO/` segment. Scoped per `ToCompanyId`.

### RULE D4 — Purchase Request number
`PurchaseRequestRepo.cs:27-74`. Format `PR/{YY}-{YY}/{NNN}` — **no company prefix,
global sequence.** Increment uses a **fixed offset**, not a regex:
```csharp
if (LastPr.PrNo.Length >= 12)
{
    int PrNumber = int.Parse(LastPr.PrNo.Substring(11)) + 1;
```
`Substring(11)` assumes the format is *exactly* `PR/YY-YY/NNN`. Any format drift
produces wrong numbers or throws. Unlike D1-D3 this one **rethrows** rather than
returning an error string — an inconsistent contract.

### ⚠️ Defects shared by all four numbering rules

| # | Defect | Consequence |
|---|---|---|
| **1** | **Race condition.** Read-max-then-increment with no lock, no transaction, no unique index | Two concurrent users receive the **same GST invoice number** — a statutory compliance failure in India |
| **2** | **Ordered by `CreatedOn`, not by sequence** | A back-dated or clock-skewed row returns the wrong "last" invoice; the sequence can go backwards or repeat |
| **3** | **Wraps at 999.** `{n:D3}` — the 1,000th document becomes `1000`, breaking downstream string-length assumptions | |
| **4** | **Financial-year boundary is off by one month.** `currentDate.Month > 4` **excludes April** | The Indian FY starts 1 April. Every April is stamped with the previous year's FY label. All four sites share this |
| **5** | **Errors returned as data** (D1-D3) | An invoice can be saved with the number `"Error generating supplier invoice number."` |

**Migration decision required:** existing April-dated documents in production carry
the wrong FY label. Does the migration preserve them as-is (correct — they are
historical records) and fix the rule going forward, or correct them retrospectively?
**This is a business decision.**

**Recommended target:** a PostgreSQL sequence or a `document_counter` table updated
inside the same transaction as the insert, plus `UNIQUE (company_id, invoice_no)`.

---

## Group D2 — Tax, discount and totals

> ### ⚠️ **THERE IS NO SERVER-SIDE CALCULATION. AT ALL.**
>
> - `Math.Round` appears **0 times** in the C# codebase.
> - `CGST`, `SGST` and `IGST` appear **0 times** in the C# codebase.
> - The repository layer contains **only property assignments**, never a computation.

`SupplierInvoiceRepo.cs:820-822`:
```csharp
TotalDiscount   = SupplierItemDetails.TotalDiscount,
TotalGstamount  = SupplierItemDetails.TotalGstamount,
TotalAmount     = SupplierItemDetails.TotalAmountInvoice,
```

The actual arithmetic lives in browser JavaScript —
`SalesInvoiceMasterScript.js:267-283`:
```javascript
var AmtWithDisc = hiddenproductPrice - discountprice;
var gst = parseFloat(row.find("#txtSalesgst").val());
var totalGst = (AmtWithDisc * quantity * gst) / 100;
var TotalAmountAfterDiscount = AmtWithDisc * quantity + totalGst;
row.find("#txtSalesgstAmount").val(totalGst.toFixed(2));
```
and the roll-up at `:366-375`:
```javascript
totalSubtotal  += subtotal * totalquantity;
totalGst       += gst;
TotalDiscount  += discountprice * totalquantity;
var Tds = $('#Sales-cart-tds').val();
totalAmount = totalSubtotal + totalGst - Tds;
var dicountRoundOff = parseFloat($('#SalesIDiscountRoundOff').val()) || 0;
totalAmount += dicountRoundOff;
```

### The four consequences

**(a) The server trusts the client completely.** A crafted HTTP request sets
`TotalAmount` to any value. Nothing validates that
`TotalAmount == Σ(lines) + GST − discount − TDS + roundoff`. **Security and audit risk.**

**(b) Precision loss is structural.** All money maths runs in JavaScript IEEE-754
`double` with `.toFixed(2)` string rounding, then is parsed back into SQL `decimal`.
Re-implementing server-side in `decimal` **will produce different values in the
last paisa for some historical rows.** Any reconciliation must expect ±0.01 drift.

**(c) The rounding order matters.** Rounding is applied **per line with `.toFixed(2)`
and then summed** — not sum-then-round. This ordering must be replicated exactly if
historical totals are to reproduce.

**(d) The CGST/SGST vs IGST split is not computed at all.** It is inferred at
*render* time by comparing `CompanyStateCode` against `SupplierStateCode` — both
merely *selected* in the repository (`SalesRepo.cs:310`, `:322`).

### ⚠️ RULE D-JS-1 — The Create Invoice screen silently drops TDS and round-off

`CreateInvoice.cshtml:896-898` loads three JS modules together. All three define
globals named `updateProductTotalAmount`, `updateTotals` and `removeItem`. There is
no module system, so **last one wins** — and `purchaserequestscript.js` loads
*after* `invoicemasterscript.js`.

**The Purchase Order formulas therefore overwrite the Invoice formulas.** PO has no
discount, no TDS and no round-off. The inline `onclick="updateProductTotalAmount(this)"`
at `CreateInvoice.cshtml:262` and `:357` calls the **PO** implementation, and
`#cart-tds` / `#IDiscountRoundOff` are **never read on this screen**.

> **Verify this against production behaviour immediately.** If confirmed, purchase
> invoices have been computed without TDS and round-off, and the scope of affected
> data needs to be established before anything else.

### ⚠️ Two mechanisms for one concept

Sales computes `AmtWithDisc = hidden − discount` inline
(`SalesInvoiceMasterScript.js:273`), while Invoice **pre-mutates the price field**.
Same business concept, two implementations. They must be reconciled into one
calculator during migration.

**Migration requirement:** implement the calculation server-side in `decimal`,
replicating the existing rounding order exactly. Write **characterisation tests
against real production invoices before changing a single operator.**

---

## Group D3 — Status and workflow

### RULE D5 — Payment status determines `IsPayOut`
`SupplierInvoiceRepo.cs:800-808` (and `SalesRepo.cs:83-91`, identical):
```csharp
if (SupplierItemDetails.PaymentStatus == "Unpaid") { PayOut = false; } else { PayOut = true; }
```
Known `PaymentStatus` values (from `SupplierInvoiceDetailsRepo.cs:203, 213`):
`"Unpaid"`, `"Online"`, `"Cheque"`. **Magic strings with no enum, no constraint and
no validation — a typo silently changes behaviour.**

⚠️ **Inconsistency:** `AddSupplierInvoice` (`:70`) hardcodes `IsPayOut = true`
unconditionally, ignoring `PaymentStatus` — contradicting the rule above. Same at
`SalesRepo.cs:903`.

### RULE D6 — Credit vs Debit classification
Drives every ledger and report. `SupplierInvoiceRepo.cs:1206-1216`:
```csharp
var TotalCredit = allData.Where(i => i.InvoiceNo   != "PayOut"
                                  && i.InvoiceType != "Purchase Return"
                                  && i.InvoiceType != "Credit Note").Sum(i => i.TotalAmount);
var TotalDebit  = allData.Where(i => i.InvoiceNo   == "PayOut"
                                  || i.InvoiceType == "Purchase Return"
                                  || i.InvoiceType == "Credit Note").Sum(i => i.TotalAmount);
```
Sales equivalent (`SalesRepo.cs:1102-1112`) uses `"PayIn"` and `"Sales Return"`.

**Magic string set:**
`InvoiceNo ∈ {"PayOut", "Opening Balance", <generated>}`,
`SalesInvoiceNo ∈ {"PayIn", <generated>}`,
`InvoiceType ∈ {"Purchase Return", "Sales Return", "Credit Note", …}`.

⚠️ **Sentinel values are stored in the same column as real document numbers.** The
migration should normalise this into a proper `document_type` discriminator.

⚠️ **This rule is duplicated verbatim in four places** —
`SupplierInvoiceRepo.cs:1507-1517`, `:1863-1873`, `SalesRepo.cs:1448-1458`.

### ⚠️ RULE D7 — Net Amount is WRONG
`SupplierInvoiceRepo.cs:227-229`:
```csharp
PayOutTotalAmount    = group.Where(x => x.s.InvoiceNo == "PayOut" || x.s.InvoiceType == "Purchase Return" || x.s.InvoiceType == "Credit Note").Sum(...),
NonPayOutTotalAmount = group.Where(x => x.s.InvoiceNo != "PayOut" && x.s.InvoiceType != "Purchase Return" && x.s.InvoiceType != "Credit Note").Sum(...),
NetAmount            = group.Sum(x => x.s.InvoiceNo != "PayOut" ? x.s.TotalAmount : -x.s.TotalAmount),
```

`NetAmount` checks **only** `InvoiceNo != "PayOut"`. It **ignores `"Purchase Return"`
and `"Credit Note"`**, which the two lines above it treat as debits.

**A Purchase Return is therefore ADDED to the supplier balance instead of
subtracted.** Supplier outstanding balances on the payout screen are wrong by
**2× the return value** for any supplier with returns. Silent, and it compounds.

Same defect at `SupplierInvoiceRepo.cs:1648`, `SalesRepo.cs:831` and `:1335`.

Also note `:272` — `Where(i => i.NetAmount != 0)` — **fully-settled suppliers are
hidden from the list.**

### RULE D8 — Approval toggles are blind
`ItemMasterRepo.ItemIsApproved` (`:286-320`), `PurchaseRequestRepo` (`:293-323`),
`ItemInwardRepo` (`:234-262`), `SalesRepo.ApproveInventoryDetails` (`:692-728`),
`SupplierMasterRepo.ActiveDeactiveSupplier` (`:28-55`), `PurchaseOrderRepo.ActiveDeactivePO` (`:1038-1065`):

```csharp
if (ItemData.IsApproved == true) { ItemData.IsApproved = false; } else { ItemData.IsApproved = true; }
```

**No target state parameter.** Two concurrent clicks cancel each other out.

> **There is no pending/partial/complete workflow anywhere in this system.** The
> entire state model is a single boolean `IsApproved` per entity. If the business
> needs a richer workflow, that is **new functionality**, not migration.

### RULE D9 — Bulk approval
Six methods, all taking explicit target states via a dictionary (a better contract
than D8) — but all implemented via the full-table load described in
[05, PERF-C1](05-Performance-Analysis.md).

---

## Group D4 — PO ↔ Invoice matching

### ⚠️ RULE D10 — Pending quantity
`PurchaseOrderRepo.cs:980-1010`. Input is `string PRId` — **misleadingly named; it
is matched against `po.Poid`, the PO number string.**

```csharp
join si in Context.SupplierInvoices on po.Poid equals si.Poid into siGroup
...
group sid by new { po.Poid, po.Date, it.ItemName, pod.Quantity } into grouped
select new POPendingData {
    OrderedQuantity       = grouped.Key.Quantity,
    TotalInvoicedQuantity = grouped.Sum(g => g != null ? g.Quantity : 0),
    PendingQuantity       = grouped.Key.Quantity - grouped.Sum(g => g != null ? g.Quantity : 0)
};
```

**Arithmetic:** `PendingQuantity = OrderedQuantity − Σ(InvoicedQuantity)`.
**No clamping — over-invoicing produces a negative pending quantity with no
warning or block.**

⚠️ **Grouping defect:** the group key includes `pod.Quantity`. If a PO contains the
**same item twice at the same quantity**, the two lines **collapse into one group**
and the ordered quantity is **under-reported by half**.

⚠️ **Join defect:** PO↔Invoice is linked by **string equality** on the PO number,
not a foreign key. Any whitespace or case difference silently breaks matching and
reports 100% pending.

### ⚠️ RULE D11 — Invoices raised against a PO
`PurchaseOrderRepo.cs:1012-1036`. `ItemTotal = sid.Price` — assigns **unit price**
to a field named *total*. Either the field is misnamed or the value is wrong.

### ⚠️ RULE D12 — PO → Invoice pre-fill
`PurchaseOrderRepo.GetPODetailsInInvoice` (`:887-978`). Notable mappings:
- `Lrno = a.BuyersPurchaseNo` (`:930`) — the buyer's PO number is carried into the LR number field
- `CompanyFullAddress = c.Address + "-" + c.Area + "," + e.CityName + "," + f.StatesName` (`:936`) — ⚠️ **`e` and `f` are the *supplier's* city and state**, so the company address is built with supplier geography. Compare `SupplierInvoiceRepo.cs:365`, which does it correctly
- Uses an **inner** join to `PodeliveryAddresses` (`:896`), unlike `GetPurchaseOrderDetailsById` which left-joins. **A PO with no delivery address silently returns nothing**, and `.First()` at `:938` throws

### RULE D13 — PR → PO conversion: **NONE FOUND**
There is no method that converts a `PurchaseRequest` into a `PurchaseOrder`.
`PurchaseRequest` has no `POId`; `PurchaseOrder` has no `PRId`. The two entities are
**entirely disconnected in the data model.** If conversion happens in the business,
it is manual re-entry.

> **Clarification required from the business:** is this intentional, or is the link
> missing? It materially affects the target data model.

---

## Group D5 — Deletion and referential guards

### RULE D14 — "Invoice exists" blocks deletion
Repeated in six places with identical semantics but different messages:
`ItemMasterRepo.cs:105`, `CompanyRepo.cs:83`, `SupplierMasterRepo.cs:151`,
`SiteMasterRepo.cs:411` and `:630`, `PurchaseOrderRepo.cs:128`.

All six use `.ToList()` + `.Count > 0` where `.AnyAsync()` would suffice.

### RULE D15 — Site deletion
`SiteMasterRepo.cs:335-383`, `:386-465`. A site must be **inactive before deletion**
(`:452` — `"Active site can't be deleted."`) and must have **zero active users**
(`:448`). Deletion cascades a soft-delete to `PurchaseRequests` and `ItemInwords`
(`:427-437`) but **not** to `SupplierInvoices`, which block deletion instead.

### RULE D16 — User deletion
`UserAuthentication.cs:177` — user must be inactive. Otherwise `"Active user can't delete."`

### ⚠️ RULE D17 — User activation
`UserAuthentication.cs:70-95`. Resolves the comma-separated `SiteId` string, takes
the **first** matching site, and blocks if that site is inactive or missing. **With
multiple sites, only one arbitrary site is checked.**

### RULE D18 — Duplicate-name guards
`SiteMasterRepo.cs:36`, `CompanyRepo.cs:35`, `ItemMasterRepo.cs:35`,
`SupplierMasterRepo.cs:69`, `UserAuthentication.cs:106`, `SiteMasterRepo.cs:515`.
**All are check-then-insert with no unique index — racy.**

### ⚠️ RULE D19 — Soft-deleted records are resurrected on re-create
`ItemMasterRepo.cs:36-56`, `SupplierMasterRepo.cs:70-98`. If a name matches an
existing row with `IsDeleted == true`, the **old row is updated in place and
un-deleted** rather than a new row being created — silently reusing the original
`ItemId`/`SupplierId` and **inheriting all its historical invoice links**.

> This is either a deliberate feature or a serious data-integrity bug depending on
> intent. **Requires business clarification.**

### RULE D20 — Opening Balance uniqueness
`SupplierInvoiceRepo.cs:1371-1394`. One `"Opening Balance"` row per
(`SupplierId`, `CompanyId`). Check-then-act; racy.

### RULE D21 — Supplier invoice number uniqueness
`SupplierInvoiceRepo.cs:1683-1697`. Prevents entering the same supplier's bill
twice per company. **The one correctly-written existence check in the codebase**
(uses `AnyAsync`, not `ToList().Count`).

---

## Group D6 — Report period filters

### RULE D22 — Period definitions
Implemented identically in eight places (`SupplierInvoiceRepo` ×4, `SalesRepo` ×4):

| Period | Definition |
|---|---|
| `currentMonth` | `new DateTime(Now.Year, Now.Month, 1)` → `+1 month −1 day` |
| `currentYear` | Financial year: `new DateTime(currentYear, 4, 1)`, rolled back a year if before that; end = `+1 year −1 day` |
| `tillMonth` | `new DateTime(year, 1, 1)` → `new DateTime(year, month, 1).AddDays(-1)` — ⚠️ **uses the calendar year (1 Jan), inconsistent with the FY logic elsewhere** |
| `betweenYear` | `new DateTime(startYear, 4, 1)` → `new DateTime(endYear, 3, 31)` |

### ⚠️ RULE D22a — Three incompatible parsers for the same input

```csharp
// Variant 1 — SupplierInvoiceRepo.cs:1614-1616, SalesRepo.cs:792-794   (correct-ish)
int endYear = years[1].Length == 2 ? int.Parse(years[1]) + (startYear / 100) * 100 : int.Parse(years[1]);

// Variant 2 — SupplierInvoiceRepo.cs:1149, SalesRepo.cs:1046           (hardcoded century)
int endYear = int.Parse("20" + years[1]);

// Variant 3 — SupplierInvoiceRepo.cs:1458, :1816                       (BROKEN)
int endYear = int.Parse(years[1]);
```

Given `"2024-25"` these produce **`2025`, `2025`, and `25`**.

**Variant 3 generates `new DateTime(25, 3, 31)` — the year 25 AD — and therefore
returns zero rows for every "between year" query.** `GetInvoiceDetailsPdfReport`
and `GetInvoiceDetailsBySupplierExcelReport` are affected, and they **report the
empty result as a legitimately empty period, with no error.** Users conclude there
were no transactions.

Variant 2 breaks in the year 2100. Variants at `:1456-1458` and `:1814-1816` use
`int.Parse` with no `TryParse` and no length guard — malformed input throws.

**Fix:** one shared, tested `FinancialYearRange.parse()` helper. Delete the three copies.

---

## Group D7 — Quantity and stock

| Rule | Location | Detail |
|---|---|---|
| **D23 — Inward quantity** | `ItemInwardRepo.cs:307` | Stored as entered. ⚠️ **No positivity check, no maximum, no unit conversion** |
| **D24 — Inward totals** | `ItemInwardRepo.cs:163-174` | ⚠️ `totalRows` and `totalQty` are computed over the filtered set and then **stuffed into the first row of the result list.** The aggregate silently vanishes when the result is empty |
| **D25 — Vehicle number normalisation** | `ItemInwardRepo.cs:44`, `:310` | `.ToUpper()`. ⚠️ **`NullReferenceException` if the field is omitted** — no null guard. And `UpdateItemInWordDetails` (`:279`) does **not** apply `.ToUpper()`, so create and update disagree on casing |
| **⚠️ D26 — Stock on hand** | — | **NONE FOUND.** No method computes `inward − outward`. `InventoryInwards` and `ItemInwords` are two separate, unreconciled tables |

> **Stock levels are not maintained by this system.** `SalesRepo.InsertSalesInvoiceDetails`
> (`:78`) writes the invoice and its lines but **never touches `InventoryInwards`.**
> There is no automatic stock decrement on sale and no increment on purchase inward.
> Selling and stock are entirely decoupled.
>
> **This is a business-logic gap, not a transaction gap.** If the business believes
> the system tracks stock, that belief needs testing before migration.

---

## Group D8 — Permissions

### ⚠️ RULE D27 — New users get full permissions on every form
`UserAuthentication.cs:135-153`:
```csharp
var Forms = Context.Forms.ToList();
foreach (var form in Forms)
{
    var UserwisePermission = new UserwiseFormPermission()
    {
        UserId = model.Id, FormId = form.FormId,
        IsAddAllow = true, IsViewAllow = true, IsEditAllow = true,
        IsDeleteAllow = true, IsApproved = true,
```

**Every new user is created as a full administrator on every screen** and must be
locked down afterwards. **Fail-open by default.**

### ⚠️ RULE D28 — Login permission load
`UserAuthentication.cs:428-446`. Permissions load only `if (userFormPermissionExists)`;
only `IsActive` forms, ordered by `OrderId`. The **site and company lists (`:448-494`)
are nested inside the same `if`** — so a user with no permission rows gets **no sites
and no companies, silently.**

### RULE D29 — Login sequence
`UserAuthentication.cs:388-413`: user must exist (404) → `IsActive` (403,
`"Your account is inactive. Please contact your administrator."`) → password match
(**plaintext**, and `response.Code` is left at its default — an inconsistent contract).
JWT issued with `expires: DateTime.Now.AddHours(8)`.

⚠️ **Username enumeration:** "user not found" and "password incorrect" are
distinguishable responses.

---

## Summary: rules that must be decided before migration

| # | Question for the business | Rule |
|---|---|---|
| 1 | The FY boundary excludes April. Preserve historical labels and fix going forward, or correct retrospectively? | D1-D4 |
| 2 | Purchase Returns are **added** to supplier balances instead of subtracted. Correct it? What about historical reports already issued? | D7 |
| 3 | Create Invoice appears to **drop TDS and round-off**. Verify against production. If confirmed, what is the remediation scope? | D-JS-1 |
| 4 | Two report exports return **empty results for every year query**. Has anyone relied on them? | D22a |
| 5 | Re-creating a soft-deleted item **resurrects the old row** with its historical invoice links. Intentional? | D19 |
| 6 | There is **no PR → PO link**. Is conversion meant to exist? | D13 |
| 7 | The system does **not track stock on hand**. Is that understood? | D26 |
| 8 | A PO with the same item twice at the same quantity **under-reports ordered quantity by half**. Does this occur in practice? | D10 |
| 9 | Over-invoicing against a PO is **permitted and produces a negative pending quantity**. Should it be blocked? | D10 |
| 10 | Money is computed in the browser with `double` + `.toFixed(2)`. Server-side `decimal` **will differ by ±0.01 on some historical rows**. Acceptable? | D2 |

**Until questions 1-4 and 10 are answered, the migration has no specification to
build against.**
