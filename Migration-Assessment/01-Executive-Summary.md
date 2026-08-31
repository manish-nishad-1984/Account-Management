# 01 — Executive Summary

---

## 1. What the application does

**AccountManagement** (branded *"Account Book"*, deployed at `avfast.in` with its API
at `api.avfast.in`) is a **multi-company, multi-site procurement and accounting
system** for what appears to be an Indian construction / infrastructure business.
The logo assets in the repository (`D H Infra`, `DHPatel`, `AmreliDairy`, `sonoco`)
indicate it serves several trading entities.

The business process it automates, end to end:

```
  Site raises a         Purchase Order        Goods arrive          Supplier
  Purchase Request  →   is issued to a    →   and are booked   →    invoices us
  (what we need)        supplier              in (inward)           (payable)
                                                                        │
  Customer is       ←   Stock is          ←   Inventory is       ←──────┘
  invoiced (sales)      consumed              tracked
                                                                        │
                        Payments in / out are recorded against ─────────┘
                        supplier and customer balances
```

**Functional modules (10):** Masters (company, site, site-group, supplier, item,
unit), Users & Permissions, Purchase Requests, Purchase Orders, Inward Challans,
Inventory, Supplier (purchase) Invoices, Sales Invoices, Payments (payout/payin),
and Reports.

**Scale of the codebase:**

| Measure | Count |
|---|---|
| Visual Studio projects | 4 |
| Screens (Razor views, excluding partials) | 31 |
| Razor views + partials | 93 |
| API endpoints | 138 |
| Database tables (mapped in EF) | 24 |
| Repository classes | 16 |
| Lines in the repository layer | 10,304 |
| Custom client-side JavaScript | ~525 KB across 17 modules |

---

## 2. Current architecture in one picture

```
   Browser (jQuery 3.6 + Bootstrap 5 + DataTables + Select2 + SweetAlert2)
        │  AJAX — but 36 of these calls return rendered HTML, not JSON
        ▼
   AccountManegments.Web        ── ASP.NET Core MVC, .NET 8
   (Razor views, cookie auth,      Renders Razor partials and posts them back
    session state)                 over AJAX. Contains NO business logic.
        │  HttpClient → https://api.avfast.in/api/
        ▼
   AccountManagement.API        ── ASP.NET Core Web API, .NET 8, JWT bearer
   (14 controllers, thin)          Controllers call services 1:1
        ▼
   AccountManagement.Repository ── .NET 6 class library
   (16 repos, 15 services)         The 15 services are 100% pass-through.
                                   ALL logic lives in the 16 repositories.
        ▼
   AccountManagement.DBContext  ── .NET 6, EF Core 7
        ▼
   SQL Server  (srv1925876.hstgr.cloud:1433, database DBAccManegment)
```

**Two observations that shape the whole migration:**

1. **The MVC Web tier is a pure HTTP proxy.** It holds session state and renders
   Razor, but every piece of data comes from `api.avfast.in`. There is no business
   logic in it worth preserving — only presentation and permission-driven UI.
2. **The service layer is empty.** All 15 service classes simply forward to their
   repository. The repositories are the system. This is good news: the surface area
   that must be understood and re-implemented is 16 files, not 46.

---

## 3. The major problems

These are stated plainly because the decision depends on them. Each is
evidenced with file and line references in the detailed documents.

### 3.1 Performance — the reported problem is real, but it is not the database

The client reports slowness. The cause is architectural, and **PostgreSQL will
not fix any of it**:

| Problem | Evidence | Where the fix belongs |
|---|---|---|
| **Zero pagination anywhere** | `.Skip()` / `.Take()` appear **0 times** in the entire repository layer. `DataTableRequstModel` defines `skip` and `pageSize` — no repository ever reads them | API + DB |
| **Grids ship every row to the browser** | 16 of 19 grids render server-side HTML for every row; the 3 that use DataTables set `serverSide: true` *and* `paging: false`, defeating the plumbing that already exists | Frontend + API |
| **Bulk approve loads and rewrites entire tables** | `var allInvoices = await Context.SupplierInvoices.ToListAsync();` then `UPDATE` on every row — 6 sites | API |
| **N+1 query loops** | 6 confirmed. Worst: `SupplierInvoiceRepo.cs:1726` issues one 3-table join per invoice over an unpaged set | API |
| **253 synchronous DB calls inside `async` methods** | Thread-pool starvation under load; presents as a hang, not high CPU | API |
| **Zero `AsNoTracking()`** on 72 read-only queries | ~2× memory on every report | API |
| **No caching of any kind** | `Countries`, `States`, `Cities`, `UnitMasters`, `Forms` re-queried on every request; the same 6 dropdown lists are fetched from ~40 distinct call sites | API + frontend |
| **511 KB of unbundled, unminified JavaScript**, CKEditor (~500 KB) blocking first paint on all 31 screens though used on one | Frontend |

**The important consequence:** most of this can be fixed **in the existing .NET
application**. See §6.

### 3.2 Correctness and data integrity

| Problem | Evidence |
|---|---|
| **All money arithmetic runs in browser JavaScript; the server persists whatever it is told.** `Math.Round` appears 0 times in C#. `CGST`/`SGST`/`IGST` appear 0 times in C# | `SalesInvoiceMasterScript.js:267-283`, `SupplierInvoiceRepo.cs:820-822` |
| **A live bug: on the Create Invoice screen, three JS modules load together and their identically-named globals collide.** The PO formulas overwrite the Invoice formulas, so **discount, TDS and round-off are silently dropped** from line recalculation | `CreateInvoice.cshtml:896-898` |
| **Document numbering has a race condition.** Read-max-then-increment with no lock, no transaction, no unique constraint. Two concurrent users get the **same GST invoice number** — a statutory compliance failure | 4 sites, e.g. `SupplierInvoiceRepo.cs:890-913` |
| **Number generation returns errors as data.** On exception it returns the literal string `"Error generating supplier invoice number."` *as the invoice number*, with HTTP 200 | `SupplierInvoiceRepo.cs:923-928` |
| **Financial-year boundary is off by one month.** `currentDate.Month > 4` excludes April, so the FY flips on 1 May. Every April is stamped with the wrong FY. All 4 numbering sites share this bug | Same |
| **Zero transactions in the entire codebase.** `BeginTransaction` → 0 matches. Three invoice/PO update paths delete all line items, commit, then re-insert and commit again — a crash between the two leaves a header with a total and **no line items, permanently** | `SupplierInvoiceRepo.cs:751-777` |
| **Purchase Returns and Credit Notes are added to supplier balances instead of subtracted** | `SupplierInvoiceRepo.cs:229` |
| **Two report methods return empty results for every year query** because of a broken financial-year parser — and report it as a legitimately empty period | `SupplierInvoiceRepo.cs:1458`, `:1816` |
| **No logging or telemetry of any kind**, combined with 17+ exception-swallowing catches | Project-wide |

### 3.3 Security

Four findings are severe enough to warrant action **this week**, independent of any migration decision:

| # | Finding | Evidence |
|---|---|---|
| **C-1** | **Passwords stored and compared in plaintext** | `UserAuthentication.cs:409` — `if (tblUser.User.Password != loginRequest.Password)` |
| **C-2** | **The API returns users' plaintext passwords over HTTP.** Any authenticated user can enumerate all users and dump every credential | `UserAuthentication.cs:236` in `GET api/Authentication/GetUserById` |
| **C-3** | **Production `sa` credentials committed to source control**, with `Encrypt=False`, on a public FQDN | `appsettings.json:6` |
| **C-6** | **Two unauthenticated endpoints control the entire permission model.** No credentials required — POST a modified array and grant yourself administrator | `FormPermissionMasterController.cs:42-54` |

Plus: the JWT signing key is committed to source control (`appsettings.json:19`);
the user's cleartext password is written to a non-HttpOnly, non-Secure cookie for
7 days when "Remember me" is ticked (`Web/AuthenticationController.cs:181-186`);
and **the API performs no per-endpoint authorization at all** — every `[Authorize]`
is parameterless and the token carries no user id, role or permission claims, so a
view-only clerk can approve their own invoices by calling the API directly.

> **Action required regardless of the migration decision:** rotate the `sa` password,
> the two commented-out credential sets, and the JWT key. Treat all four as public.
> Then add `[Authorize]` to `FormPermissionMasterController`.

---

## 4. Migration complexity

**Overall: MEDIUM-HIGH.** Not because the domain is complex — it is a
conventional procure-to-pay system — but because of three specific factors.

| Factor | Rating | Why |
|---|---|---|
| Domain complexity | **Low-Medium** | Standard procurement/accounting. 24 tables. No exotic workflows |
| Business logic volume | **Medium** | 10,304 lines of repository code, but much is boilerplate CRUD |
| **Undocumented business rules in JavaScript** | **HIGH** | The tax and totalling rules the business runs on exist only in jQuery, are untested, and differ between three screens |
| **Data integrity unknowns** | **HIGH** | ~62 reference columns with no FK. PostgreSQL will refuse to create those constraints until orphans are cleaned. Volume is unmeasured |
| API redesign | **HIGH** | 36 endpoints return HTML, not JSON. React cannot consume any of them. This is the critical path, and it is larger than the UI work |
| Integrations | **None** | No email, SMS, WhatsApp, payment gateway, GST portal, or third-party API anywhere. Nothing external to re-wire — a significant simplification |
| Background jobs | **None** | Nothing to port |
| Reporting | **Medium** | 10 report endpoints, print views are Razor + `window.print()`. No PDF library exists anywhere in the solution |

**The single biggest risk is not technical — it is that the business rules are
not written down anywhere except in code that two different screens implement
differently.** Any migration must begin by extracting and testing those rules
against production data.

---

## 5. Recommended target architecture

```
  React 19 + TypeScript (Vite)
    React Router · TanStack Query · React Hook Form + Zod · TanStack Table
        │  JSON only, server-side paginated
        ▼
  Node.js 22 LTS + TypeScript + NestJS
    Zod validation · JWT (RS256) + refresh tokens · policy-based authorization
    Pino logging · OpenTelemetry · Redis cache
        ▼
  Drizzle ORM + node-postgres  (SQL-first, typed)
        ▼
  PostgreSQL 17
    Real FKs · unique constraints on document numbers · sequences for numbering
    Keyset pagination · partial indexes · materialised views for dashboards
```

Framework and ORM choices are argued in [16-Technology-Stack.md](16-Technology-Stack.md).
The short version: **NestJS** because this codebase's biggest structural weakness is
the absence of enforced layering and cross-cutting concerns, and NestJS makes
authorization, validation, transactions and logging structural rather than
optional. **Drizzle** because the reporting queries are multi-table joins with
dynamic filters that an ORM abstraction would obstruct, and because the migration
depends on being able to read exactly what SQL is produced.

---

## 6. The recommendation, in short

> **Do not begin the migration yet.** Run a 4-6 week stabilisation phase on the
> existing .NET application first. It will make the current system substantially
> faster, close the critical security holes, and — most importantly — produce the
> tested business-rule specification that the migration cannot safely proceed
> without.

**Why not go straight to the rewrite:**

1. **The performance problem does not need a rewrite.** Pagination,
   `AsNoTracking()`, fixing the 6 bulk-approve full-table loads, and caching the
   reference data are perhaps 3-4 weeks of work in the existing codebase, and
   address the great majority of the reported slowness. A rewrite delivers the
   same benefit 9-12 months later.
2. **There is no observability.** With no logging and no DMV evidence, nobody can
   currently prove which queries are slow, or verify that anything got faster. A
   migration undertaken in this state cannot demonstrate success.
3. **The business rules are not specified.** Porting `.toFixed(2)` JavaScript
   arithmetic to server-side `decimal` **will change historical totals** by ±0.01
   on some rows. That needs characterisation tests against real invoices before a
   line of new code is written.
4. **The security defects are urgent and the migration is not.** Plaintext
   passwords and an unauthenticated permission-granting endpoint are live
   exposures today. Fixing them takes days.

**Then migrate**, using a **Strangler Fig** approach: the new Node API runs
alongside the existing .NET API behind a gateway, modules move across one at a
time, and the React frontend is built against the new API module by module. This
avoids a big-bang cutover, keeps the business running throughout, and allows
rollback at every step. Full comparison of the five options is in
[13-Migration-Strategy-and-Roadmap.md](13-Migration-Strategy-and-Roadmap.md).

**Indicative effort** (to be firmed up once the DB extraction scripts have been run):

| Phase | Duration | Notes |
|---|---|---|
| 0 — Stabilise & instrument the existing app | 4-6 weeks | Delivers most of the performance win immediately |
| 1 — Foundation (PostgreSQL schema, data migration harness, Node skeleton, auth) | 6-8 weeks | |
| 2 — Masters | 6-8 weeks | |
| 3 — Transactions (PR, PO, Inward, Inventory) | 8-10 weeks | |
| 4 — Invoicing (the risk centre) | 8-10 weeks | |
| 5 — Reports, dashboard, payments | 6-8 weeks | |
| 6 — Cutover, parallel run, decommission | 4-6 weeks | |
| **Total** | **~10-12 months** | Assumes a team of 3-4. Highly sensitive to the orphan census result |

---

## 7. GO / NO-GO

**CONDITIONAL GO.** The application is a reasonable migration candidate — the
domain is well-bounded, there are no external integrations to untangle, and the
target architecture is a good fit. But it is **not ready to start today**.

Eight items must be resolved first. They are listed with acceptance criteria in
[18-GO-NO-GO-Assessment.md](18-GO-NO-GO-Assessment.md).
