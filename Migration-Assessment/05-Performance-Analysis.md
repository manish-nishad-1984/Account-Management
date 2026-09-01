# 05 — Performance Analysis

> **The central conclusion of this document:** the reported slowness is **not
> caused by SQL Server**, and moving to PostgreSQL will not fix it. It is caused
> by application-level patterns that would be equally slow on any database.
>
> Most of it is fixable in the existing .NET application in weeks.

---

## 1. Method and its limits

Findings below are derived from reading all 10,304 lines of the repository layer,
the 12 MVC controllers and the 17 JavaScript modules. Each cites file and line.

**What is missing, and what it means:**

There is **no logging, no telemetry, and no APM anywhere in the solution**. No
DMV or Query Store output was available. Therefore:

- Every finding here is a **structural** problem — provably present in the code.
- **None of them is currently sized.** "This query returns every invoice" is a
  fact; whether that is 400 rows or 400,000 is **UNKNOWN — requires live DB**.
- Ranking below is by expected impact given the code shape. It should be
  **re-ranked against the DMV output** from
  [`tools/02-extract-perf-dmv.sql`](tools/02-extract-perf-dmv.sql) before work starts.

> **The first task in any performance effort is to add logging**, not to fix a
> query. Without it, nobody can prove which fix worked.

---

## 2. Existing problems vs architecture-caused problems

The brief asked for this distinction explicitly. It matters, because it determines
whether a migration is the right remedy.

### 2a. Problems that are BUGS — fixable now, in .NET, cheaply

These have nothing to do with the choice of stack. They would be equally wrong in Node.

| # | Problem | Fix effort |
|---|---|---|
| P1 | No pagination anywhere | ~1 week |
| P2 | Bulk approve loads and rewrites entire tables (6 sites) | ~1 day |
| P3 | 6 N+1 query loops | ~3 days |
| P4 | Zero `AsNoTracking()` on 72 read queries | **~1 hour** (one global setting) |
| P5 | Dead `query.FirstOrDefault().GetType()` costing a query per report call | **~5 minutes** |
| P6 | `.ToList().Count > 0` used as an existence test in 6 places | ~2 hours |
| P7 | No caching of reference data | ~2 days |
| P8 | 253 synchronous DB calls inside `async` methods | ~1 week (mechanical) |
| P9 | Search fires on every keystroke with no debounce | ~1 day |
| P10 | No response compression, no JS bundling | ~1 day |

**Subtotal: roughly 3-4 weeks of work that addresses the large majority of the
reported slowness, in the existing application.**

### 2b. Problems that ARE architectural — a migration genuinely helps

| # | Problem | Why the architecture causes it |
|---|---|---|
| A1 | Every list request crosses **two** network hops (Browser → MVC → API → DB) and back, with the payload serialised and deserialised twice | The MVC-as-proxy design |
| A2 | Filtering happens in the MVC tier in memory, after the full set has crossed both hops | No filter parameters exist on the API contract |
| A3 | 36 endpoints return rendered HTML, so the server re-renders every row on every keystroke | Razor-partial-over-AJAX |
| A4 | `new HttpClient()` per call — socket exhaustion under load | No `IHttpClientFactory` |
| A5 | 511 KB of unbundled JS, three of the largest modules loaded together on one screen | No module system, no build step |
| A6 | `User.SiteId` as a CSV string forces a full `Users` table scan to answer "who is on this site" | Schema design |
| A7 | No transaction boundary exists anywhere to attach a unit of work to | No service layer |

### 2c. Problems a migration will NOT fix, and may make worse

| Problem | Note |
|---|---|
| Missing indexes | **UNKNOWN**, but if the DB has none today, PostgreSQL with none will be no faster. Indexes must be designed deliberately in the target |
| The money arithmetic | Porting JS `double` + `.toFixed(2)` to server-side `decimal` **will change some historical totals by ±0.01** |
| Race conditions in numbering | Only fixed if deliberately redesigned onto sequences |
| Absence of observability | Must be built; it does not come free with Node |

---

## 3. Ranked findings

### CRITICAL

---

**PERF-C1 — Bulk approve loads and rewrites entire tables**

**Location:** `SupplierInvoiceRepo.cs:1346-1358`, `PurchaseOrderRepo.cs:862-874`,
`ItemMasterRepo.cs:547-559`, `SupplierMasterRepo.cs:489-501`,
`PurchaseRequestRepo.cs:329-341`, `ItemInwardRepo.cs:410-422`

**Current implementation:**
```csharp
var allInvoices = await Context.SupplierInvoices.ToListAsync();
foreach (var invoice in allInvoices)
{
    if (approvalDict.TryGetValue(invoice.Id, out var isApproved))
    {
        invoice.IsApproved = isApproved;
        ...
    }
    Context.SupplierInvoices.Update(invoice);   // ← every row, not just the matches
}
```

**Why it is slow:** approving one invoice loads **every invoice ever created** into
EF's change tracker and issues an `UPDATE` statement for **every row in the table**.

**Expected impact:** at 200,000 invoices this is a multi-minute request and an
enormous transaction-log write. Worse than slow — it **silently overwrites
concurrent edits to unrelated invoices with stale values**. This is a
data-corruption vector, not merely a performance problem.

**Recommended fix:** `Where(i => ids.Contains(i.Id))` and delete the `.Update()`
calls entirely — EF change tracking handles it.

**Fix belongs in:** API (repository layer) · **Priority: immediate, pre-migration**

---

**PERF-C2 — Zero pagination across 19 list and report endpoints**

**Location:** `.Skip()` / `.Take()` appear **0 times** in the entire repository
project. Affected: `GetSupplierInvoiceList` (`:602`), `GetSalesList` (`:162`),
`GetPurchaseOrderList` (`:378`), `GetSiteList` (`:158`), `GetItemList` (`:173`),
`GetUsersList` (`:262`), `GetSupplierList` (`:216`), `GetPurchaseRequestList`
(`:171`), `GetItemInWordList` (`:92`), `GetAllCompany` (`:110`), and 9 more.

**Current implementation:** `DataTableRequstModel.cs:17-18` defines `skip` and
`pageSize`. **No repository ever reads them.**

**Why it is slow:** every list endpoint returns every row. Combined with PERF-C3,
the payload is also multiplied by line-item count.

**Expected impact:** the dominant scaling risk. Degrades linearly and without
limit as data grows. At realistic volumes this becomes a multi-second,
multi-hundred-megabyte response that will exhaust application memory before it
times out.

**Recommended fix:** honour `skip`/`pageSize` after ordering, before materialising.
In PostgreSQL, prefer **keyset (cursor) pagination** over `OFFSET` for the large
tables — `OFFSET 50000` still scans 50,000 rows.

**Fix belongs in:** API + PostgreSQL + frontend · **Priority: immediate**
**This is the single highest-leverage change available in the codebase.**

---

**PERF-C3 — Row-multiplying joins materialised in full, then regrouped in memory**

**Location:** `SupplierInvoiceRepo.cs:606-611` + `:676-694`;
`SalesRepo.cs:166-172` + `:252-270`; `ItemMasterRepo.cs:577-582` + `:627-644`

**Current implementation:** a six-table join including the detail table, fully
materialised, then regrouped:
```csharp
var supplierDataQuery = from a in Context.SupplierInvoices
                        join e in Context.SupplierInvoiceDetails on a.Id equals e.RefInvoiceId
                        join b in Context.SupplierMasters ...
                        join c in Context.Companies ...
var supplierData = await supplierDataQuery.ToListAsync();
... .GroupBy(x => x.Item.RefInvoiceId).ToDictionary(...)
```

**Why it is slow:** every header field — including full billing and shipping
addresses — is transmitted **once per line item**. An invoice with 40 lines ships
its header 40 times.

**Expected impact:** combined with PERF-C2 (no paging), roughly **40× the necessary
bytes** on a list request.

**Recommended fix:** two queries — one for paged headers, one for the details of
the visible header IDs only.

**Fix belongs in:** API · **Priority: immediate**

---

**PERF-C4 — N+1 query loop in the invoice PDF export**

**Location:** `SupplierInvoiceRepo.cs:1726-1745`

```csharp
foreach (var invoice in supplierInvoiceData)
{
    var itemList = await (from a in Context.SupplierInvoiceDetails
                          join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId into unitJoin
                          from b in unitJoin.DefaultIfEmpty()
                          join i in Context.ItemMasters on a.ItemId equals i.ItemId
                          where a.RefInvoiceId == invoice.Id
                          ...).ToListAsync();
}
```

**Why it is slow:** the outer set is loaded unpaged at `:1703`, then one 3-table
join query is issued **per invoice**. 5,000 invoices = 5,001 round-trips.

**Expected impact:** at 2 ms network latency, minutes of wall-clock time for a
single export.

**Recommended fix:** one `Where(d => invoiceIds.Contains(d.RefInvoiceId))` query,
then `ToLookup(d => d.RefInvoiceId)` in memory.

**Fix belongs in:** API · **Priority: immediate**

---

### HIGH

---

**PERF-H1 — N+1 in the Excel importers (3 queries per row)**

**Location:** `SupplierMasterRepo.cs:362, 386`; `ItemMasterRepo.cs:367, 379`

```csharp
foreach (var supplierDetails in supplierList)
{
    var stateId = await Context.States.FirstOrDefaultAsync(x => x.StatesName == supplierDetails.StateName);
    var cityId  = await Context.Cities.FirstOrDefaultAsync(x => x.CityName  == supplierDetails.CityName);
    var existing = await Context.SupplierMasters.FirstOrDefaultAsync(x => x.SupplierName == supplierDetails.SupplierName);
```

**Impact:** a 2,000-row supplier import issues **6,000 round-trips**. Both importers
also **abort on the first bad row** (`ItemMasterRepo.cs:376, 401, 410`), so the user
fixes one row at a time. No row limit, no streaming, no batching — a 50,000-row
upload will time out. And these run **synchronously inside the HTTP request**;
there is no background job infrastructure anywhere.

**Fix:** pre-load States/Cities into dictionaries; pre-load existing names with one
`Contains` query; collect per-row errors and report them all; move to a background
job in the target architecture.

**Fix belongs in:** API + infrastructure (job queue) · **Priority: high**

---

**PERF-H2 — 253 synchronous database calls inside `async` methods**

**Location:** every repository. `SupplierInvoiceRepo.cs` alone has 59 synchronous
terminal operators and 3 synchronous `SaveChanges()`. Example: `:91-112` is an
`async Task<ApiResponseModel>` containing **zero `await`s**, using `.FirstOrDefault()`,
`.ToList()` and `Context.SaveChanges()`.

**Why it is slow:** each blocks a thread-pool thread for a full network round-trip.

**Expected impact:** thread-pool starvation under moderate concurrency. The failure
mode **looks like a hang, not high CPU**, which makes it very hard to diagnose —
especially with no logging.

**Fix:** mechanical conversion to `*Async`. Enforce with an analyzer.

**Fix belongs in:** API · **Priority: high**

---

**PERF-H3 — Zero `AsNoTracking()` on 72 read-only query methods**

**Location:** all 16 repositories. `grep -c AsNoTracking` → **0**.

**Impact:** every report row gets a change-tracker snapshot — roughly 2× memory
and measurable CPU. On the large unpaged reports this is the difference between a
slow response and an `OutOfMemoryException`.

**Fix:** one line in `Program.cs`:
```csharp
option.UseSqlServer(...).UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking);
```
then opt into tracking on write paths only.

**Fix belongs in:** API · **Priority: immediate — this is the lowest-effort,
highest-return item in the entire assessment.**

---

**PERF-H4 — No caching of any kind**

**Location:** `MasterListRepo.cs:29/46/65`, `FormMasterRepo.cs:27`,
`ItemMasterRepo.cs:130`, `UserAuthentication.cs:135/212/266`

**Impact:** `Countries`, `States`, `Cities`, `UnitMasters` and `Forms` are
re-queried from SQL Server on **every single request**. On the frontend, the same
six dropdown lists are fetched from ~40 distinct call sites; `fn_autoselect`
(`Main_Layout.cshtml:870-899`) re-fetches on every element it wires — five separate
fetches of two static lists on some pages.

**Fix:** `IMemoryCache` with a long TTL server-side (these change perhaps monthly);
TanStack Query with `staleTime: Infinity` client-side in the target.

**Fix belongs in:** caching layer (both tiers) · **Priority: high — cheapest win available**

---

**PERF-H5 — Whole `Users` table loaded and string-split to count active users**

**Location:** `SiteMasterRepo.cs:348-354`, `:401-407`; `UserAuthentication.cs:266-307`

```csharp
var activeUsersCount = Context.Users
    .AsEnumerable()                       // ← SELECT * FROM Users
    .Count(e => e.IsActive && e.SiteId != null &&
                e.SiteId.Split(',')
                    .Select(id => Guid.TryParse(id, out var guid) ? guid : (Guid?)null)
                    .Contains(SiteId));
```

**Why:** forced by `User.SiteId` being a comma-delimited GUID string column.
**This is unfixable in place.** The same defect drives an O(Users × Sites)
in-memory lookup at `UserAuthentication.cs:298-307`.

**Fix:** normalise into junction tables — a schema migration.

**Fix belongs in:** PostgreSQL (schema) · **Priority: scope into the migration now;
it also blocks any indexing strategy**

---

**PERF-H6 — Frontend: 511 KB of unbundled JavaScript, blocking render**

**Location:** `Main_Layout.cshtml`, `CreateInvoice.cshtml:896-898`

| Problem | Evidence |
|---|---|
| **CKEditor 5 (~500 KB) blocks first paint on all 31 screens**, used on one | `Main_Layout.cshtml:30`, no `defer`/`async` |
| **29 `<script src>` tags in the layout, not one uses `defer` or `async`** | `Main_Layout.cshtml:828-864` |
| **Three of the largest modules load together on Create Invoice** — 5,623 LOC / 210 KB on one screen | `CreateInvoice.cshtml:896-898` |
| **~380 lines of inline `<style>` re-sent uncached on every page** | `Main_Layout.cshtml:50-432`, with verbatim duplicate rules |
| **No response compression** | `Program.cs:50` is a bare `app.UseStaticFiles()` |
| **No bundling, no minification, no cache-busting** on global tags | `.csproj` has no build step |
| **Toastr pinned to `latest`** on a CDN — can change under the app without a deploy | `Main_Layout.cshtml:26` |
| **Five external CDN origins are hard dependencies**, none with SRI | jsdelivr, ckeditor, cdnjs, code.jquery, unpkg |
| **Chart.js loaded but no chart is ever initialised** | `:845` |
| No `srcset`, no `loading="lazy"`, no `width`/`height` on any image | all views |

**Fix belongs in:** frontend · **Priority: high — largely solved for free by the Vite build in the target**

---

### MEDIUM

---

**PERF-M1 — Duplicate COUNT queries, and a query executed purely as dead code**

Three report methods run the filtered query **twice** — once for `CountAsync()`,
once for the data — then set `recordsTotal` and `recordsFiltered` to the same value
(`SupplierInvoiceRepo.cs:1177/1180/1221-1222`, `SalesRepo.cs:1074/1077`,
`ItemInwardRepo.cs:163-164` which makes **three** passes: Count, Sum and ToList).

Worse:
```csharp
var queryType = query.FirstOrDefault().GetType();     // SupplierInvoiceRepo.cs:1060, SalesRepo.cs:962
```
`queryType` is **never used again**. This fires a full `SELECT TOP 1` against a
4-table join on every sorted report request, and **throws `NullReferenceException`
when the filtered set is empty**. Delete both lines.

---

**PERF-M2 — `.ToList().Count > 0` used as an existence test (6 sites)**

`ItemMasterRepo.cs:105-112`, `CompanyRepo.cs:83-90`, `SupplierMasterRepo.cs:151-159`,
`SiteMasterRepo.cs:411/630`, `PurchaseOrderRepo.cs:128`.

Each materialises **every matching invoice** just to test whether any exists.
`AnyAsync()` compiles to `SELECT TOP 1` — one row instead of thousands.

(`SupplierInvoiceRepo.cs:1683` is the one place that does it correctly.)

---

**PERF-M3 — Search with no debounce and no request cancellation**

11 confirmed `onkeyup` search bindings. Each keystroke triggers a full round trip
through both tiers and a full Razor re-render. Responses can arrive out of order.

**Fix:** 300 ms debounce + `AbortController` — trivial in the target with TanStack Query.

---

**PERF-M4 — Full-page reloads after every mutation**

`Main_Layout.cshtml:955` fetches HTML, sets it, then calls `location.reload()`,
discarding what it just fetched and re-running all nine dashboard calls.
`window.location = '/Home/Index'` appears at 7 further sites, several of which
call all five `GetDashboard*()` functions **immediately before navigating away**.

---

**PERF-M5 — O(N²) DOM work when adding payout rows**

`_PayOutInvoicePartial.cshtml:59-81` — adding row *N* re-fetches the site list and
rebuilds all *N* dropdowns. 20 rows = 20 fetches and 210 dropdown rebuilds.

---

**PERF-M6 — `CommandTimeout = 0` (infinite)**

`DbHelper.cs:22` sets `cmd.CommandTimeout = 0`. A runaway query never times out; it
holds a connection until the process is recycled. (`DbHelper` is currently
unreferenced dead code, but the pattern should not be carried forward.)

Separately, `Program.cs:63-64` configures `UseSqlServer(...)` with **no
`EnableRetryOnFailure()`, no command timeout and no pool tuning.**

---

### LOW

- `SupplierInvoiceRepo.cs:1060` / `SalesRepo.cs:962` dead-code query (also under M1)
- Unused NuGet packages deployed: `Microsoft.Azure.DurableTask.Core` (400 KB), `Azure.Identity`, `System.Reactive` + its 2.4 MB XML doc
- 57 unused Select2 locale files
- `_ReportDetailsPartial.cshtml` — 115 lines, entirely commented out
- ~440 lines of commented-out stored-procedure code in two repositories
- `ItemInWordRepo.cs` — 439 lines of unregistered duplicate

---

## 4. Things that are commonly wrong and are NOT wrong here

Worth recording, so effort is not wasted looking for them:

| Anti-pattern | Status |
|---|---|
| `SELECT *` in raw SQL | **Not found.** Queries use explicit projections |
| Synchronous AJAX (`async: false`) | **Not found** anywhere |
| N+1 AJAX (one request per grid row) | **Not found.** All six bulk-approve flows correctly batch into one request |
| EF `.Include()` cartesian explosion | **Not found** — `.Include()` appears zero times (the equivalent is done manually and is worse, see PERF-C3) |
| SQL injection via string concatenation | **Not found** in the 5 raw-SQL sites; all are parameterised |
| Money stored as `float` or `nvarchar` | **Not found.** All 40 money columns are `numeric(18,2)` |
| Dates stored as strings | **Not found.** All 40 temporal columns are proper date/datetime types |

---

## 5. Where each fix belongs

| Fix | Frontend | Node API | PostgreSQL | Caching | Infra |
|---|:---:|:---:|:---:|:---:|:---:|
| Pagination (keyset) | ● | ● | ● | | |
| Push filters to the query | | ● | ● | | |
| Remove full-table bulk updates | | ● | | | |
| Batch the N+1 loops | | ● | | | |
| `AsNoTracking` → read-only queries | | ● | | | |
| Reference-data cache | ● | ● | | ● | |
| Async all the way down | | ● | | | |
| Indexes | | | ● | | |
| Junction tables for `User.SiteId` | | ● | ● | | |
| Document-number sequences | | ● | ● | | |
| Bundling / minification / compression | ● | | | | ● |
| Debounce + request cancellation | ● | | | | |
| Excel import → background job | | ● | | | ● |
| Connection pooling (PgBouncer) | | | | | ● |
| **Logging and APM** | ● | ● | ● | | ● |

---

## 6. Recommended sequence

1. **Add logging and APM first.** Nothing else can be verified without it.
2. Run the DMV extraction script and re-rank these findings against measured cost.
3. `AsNoTracking()` globally — one line, immediate benefit.
4. Delete the two dead `GetType()` queries — five minutes.
5. Fix the six bulk-approve full-table loads — one day, removes a corruption vector.
6. Add pagination to the top five list endpoints, and switch those grids to
   server-side paging — the largest single win.
7. Cache reference data server-side.
8. Batch the six N+1 loops.
9. Convert the synchronous calls to async.
10. Bundle and compress the frontend assets.

**Steps 1-10 are all achievable in the existing .NET application within roughly
4-6 weeks**, and will resolve the majority of what the client is currently
experiencing. See [13-Migration-Strategy-and-Roadmap.md](13-Migration-Strategy-and-Roadmap.md)
for how this phase relates to the migration.
