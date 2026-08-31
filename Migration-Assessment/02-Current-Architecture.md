# 02 — Current Architecture

---

## 1. Solution structure

`AccountManagement.sln` contains four projects:

| Project | Folder | SDK | Target | Role |
|---|---|---|---|---|
| `AccountManagement.API` | `AccountManegmentAPI/` | `Microsoft.NET.Sdk.Web` | **net8.0** | Web API — 14 controllers |
| `AccountManegments.Web` | `AccountManegments.Web/` | `Microsoft.NET.Sdk.Web` | **net8.0** | MVC frontend — Razor + jQuery |
| `AccountManagement.Repository` | `AccountManegment.Repo/` | `Microsoft.NET.Sdk` | **net6.0** | 16 repositories, 15 services, 27 interfaces |
| `AccountManagement.DBContext` | `AccountManegment.DBContext/` | `Microsoft.NET.Sdk` | **net6.0** | EF Core context, 28 entities, view models |

> **Finding — mixed target frameworks.** The two web projects target `net8.0`
> while the two class libraries target `net6.0`. .NET 6 reached end of support in
> November 2024. The libraries also carry `Microsoft.AspNetCore.Authentication.JwtBearer`
> **6.0.5** and `Microsoft.AspNetCore.Http.Features` **5.0.17** — packages several
> major versions behind the host runtime. This works, but it means the solution is
> running unsupported dependencies today.
> *Evidence:* `AccountManagement.API.csproj:4`, `AccountManagement.Repository.csproj:4`,
> `AccountManagement.DBContext.csproj:4`, `:16`.

**Project reference graph:**

```
   AccountManagement.API ──────┬──► AccountManagement.Repository ──► AccountManagement.DBContext
                               └──► AccountManagement.DBContext

   AccountManegments.Web  ─── (no project references — talks over HTTP only)
```

The MVC project is fully decoupled at build time. It reaches the API purely over
HTTP. This is architecturally significant and makes the strangler-fig migration
much easier: **the frontend can be replaced without touching the backend, and vice
versa.**

---

## 2. Runtime topology

```
┌──────────────────────────────────────────────────────────────────────────┐
│  BROWSER                                                                 │
│  jQuery 3.6 · Bootstrap 5 · DataTables · Select2 · SweetAlert2           │
│  ApexCharts · metisMenu · moment.js · CKEditor 5 · toastr                │
│  + 511 KB of custom JS in 17 modules (unbundled, unminified)             │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ AJAX. 36 of these calls receive rendered HTML partials,
                │ not JSON. Mutations receive {Message, Code} then the page
                │ hard-reloads.
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AccountManegments.Web        https://avfast.in                          │
│  ASP.NET Core MVC · net8.0 · IIS in-process                              │
│                                                                          │
│  · Cookie authentication (8 h sliding, HttpOnly, SecurePolicy.None)      │
│  · Server session (8 h idle) holds UserId, SiteId, CompanyId, token,     │
│    and the whole permission matrix                                       │
│  · FormPermissionAttribute — permission checks for the UI                │
│  · Helper/APIServices.cs — the HTTP proxy to the API                     │
│  · 12 controllers, 93 Razor views                                        │
│  · NO business logic, NO database access                                 │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ HttpClient → https://api.avfast.in/api/
                │ Bearer token pulled from session
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AccountManagement.API        https://api.avfast.in                      │
│  ASP.NET Core Web API · net8.0 · IIS in-process · Swagger enabled        │
│                                                                          │
│  · JWT bearer auth (HS256, 8 h, key in appsettings.json)                 │
│  · CORS policy "AllowFrontend" → avfast.in, www.avfast.in                │
│  · 14 controllers, 138 endpoints                                         │
│  · Controllers are 3-6 lines each: call service, wrap in Ok()            │
└───────────────┬──────────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AccountManagement.Repository   ·  net6.0 class library                  │
│                                                                          │
│   Services/ (15 files)  ── 100% pass-through. Zero logic.                │
│         │                    Can be deleted in the migration.            │
│         ▼                                                                │
│   Repository/ (16 files, 10,304 lines)  ── THE ENTIRE SYSTEM             │
│         Business rules · queries · numbering · validation · everything   │
└───────────────┬──────────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  AccountManagement.DBContext  ·  EF Core 7.0.17 · net6.0                 │
│  DbaccManegmentContext — 24 mapped entities                              │
│  No global query filters · no interceptors · no HasIndex                 │
└───────────────┬──────────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  SQL Server                                                              │
│  srv1925876.hstgr.cloud,1433 · DBAccManegment · login: sa · Encrypt=False│
└──────────────────────────────────────────────────────────────────────────┘

  NOT PRESENT ANYWHERE IN THE SOLUTION:
    ✗ Cache (no IMemoryCache, no Redis)        ✗ Email / SMS / WhatsApp
    ✗ Background jobs (no Hangfire/Quartz)     ✗ Payment gateway
    ✗ Message queue                            ✗ GST portal / e-invoicing
    ✗ Logging framework                        ✗ Any third-party API
    ✗ PDF library                              ✗ Health checks / monitoring
```

---

## 3. Dependency map — Frontend → Database

Tracing one real request end to end, the **Supplier Invoice list**:

```
 SupplierInvoiceListView.cshtml
   └─ SupplierInvoiceScript → $.ajax('/InvoiceMaster/SupplierInvoiceListAction')
        └─ Web/InvoiceMasterController.SupplierInvoiceListAction  (:180-218)
             ├─ [FormPermissionAttribute("Supplier Invoice", "view")]
             ├─ APIServices.PostAsync("SupplierInvoice/GetSupplierInvoiceList")
             │    └─ new HttpClient()  ← created per call
             │       └─ POST https://api.avfast.in/api/SupplierInvoice/GetSupplierInvoiceList
             │            └─ API/SupplierInvoiceController  [Authorize]
             │                 └─ ISupplierInvoiceService (pass-through)
             │                      └─ SupplierInvoiceRepo.GetSupplierInvoiceList (:602)
             │                           └─ 6-table LINQ join, NO paging, NO AsNoTracking
             │                                └─ SELECT … FROM SupplierInvoice
             │                                     JOIN SupplierInvoiceDetails
             │                                     JOIN SupplierMaster
             │                                     JOIN Company
             │                                     JOIN Site …
             ├─ 4 sequential in-memory .Where() passes over the full result   (:196-218)
             └─ return PartialView("_SupplierInvoiceListPartial", model)
                  └─ Razor renders every row as HTML
                       └─ $('#tbl').html(result)
```

**Six observations from this single trace, each of which recurs system-wide:**

1. A new `HttpClient` is created per call — socket exhaustion risk under load.
2. The query has no pagination, so every invoice ever created crosses the wire.
3. The join multiplies header rows by line items, so each header field (including
   full addresses) is transmitted once per line.
4. Site and company filtering happens **in the MVC tier, in memory**, after the
   full set has already crossed two network hops.
5. The response is HTML, not JSON. React cannot consume it.
6. The permission check runs in the MVC tier only. The API endpoint accepts any
   valid JWT.

---

## 4. Dependency inventory (NuGet)

**API project** — `AccountManagement.API.csproj`

| Package | Version | Note |
|---|---|---|
| `Microsoft.EntityFrameworkCore` | 7.0.17 | One major version behind the net8 host |
| `Microsoft.EntityFrameworkCore.SqlServer` | 7.0.17 | |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | **6.0.5** | Two major versions behind; EOL |
| `Swashbuckle.AspNetCore` | 6.5.0 | Swagger UI **enabled in production** |
| `Microsoft.Azure.DurableTask.Core` | 2.16.2 | **Referenced but never used** — no Durable Task code exists |
| `Azure.Identity` | 1.11.4 | **Referenced but never used** |
| `System.Text.Json` | 8.0.5 | |

**Repository project**

| Package | Version | Note |
|---|---|---|
| `System.Data.SqlClient` | 4.8.6 | Legacy provider, used by the dead `DbHelper` |
| `System.Linq.Dynamic.Core` | 1.6.0 | Runtime string-based sorting — see the security review |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | 6.0.5 | |

**Web project** additionally references ClosedXML/EPPlus for Excel, plus a large
set of client-side libraries. Several are declared and never loaded — jszip,
pdfmake, dayjs, lordicon, and 57 Select2 locale files.

> **Finding — dead dependencies.** `Microsoft.Azure.DurableTask.Core` (a 400 KB
> orchestration framework) and `Azure.Identity` are referenced but unused, and
> both are deployed. `System.Reactive` and its 2.4 MB XML doc file appear in the
> publish output. Removing unused references would materially reduce the deployment.

---

## 5. Cross-cutting concerns: what exists and what does not

| Concern | Status | Evidence |
|---|---|---|
| **Dependency injection** | Present, correct | `Program.cs:66-100` — 30 scoped registrations, interface-based |
| **Middleware** | Minimal | API: CORS → Swagger → MapControllers → HttpsRedirection → Authentication → Authorization. See §6 |
| **Authentication** | JWT (API) + cookie (Web) | Key hardcoded. No refresh tokens |
| **Authorization** | **UI only** | Every `[Authorize]` is parameterless. Token carries no role or permission claims |
| **Validation** | **NONE server-side** | No FluentValidation, no `ModelState` checks, no data annotations enforced. Only ad-hoc null/duplicate guards |
| **Logging** | **NONE** | Zero `ILogger` usage project-wide. `Logging` config in appsettings is unused |
| **Exception handling** | Ad-hoc | 47 × `throw ex;` (destroys stack trace); 17+ empty catches; 25+ catches leaking `ex.Message` to the browser |
| **Transactions** | **NONE** | `BeginTransaction` → 0 matches across the solution |
| **Caching** | **NONE** | Reference data re-queried on every request |
| **Background services** | **NONE** | No `IHostedService`, no `BackgroundService`. Excel imports and bulk approvals run synchronously in the request |
| **Audit trail** | Columns only | `CreatedBy`/`CreatedOn`/`UpdatedBy`/`UpdatedOn` set manually in ~40 places, inconsistently. No interceptor, no history table |
| **Health checks** | **NONE** | |
| **Configuration** | appsettings only | Secrets in plaintext in source control. No environment variables, no Key Vault |
| **Connection resiliency** | **NONE** | `UseSqlServer(...)` with no `EnableRetryOnFailure()`, no command timeout, no pool tuning (`Program.cs:63-64`) |
| **API versioning** | **NONE** | Swagger doc is labelled `v2` but no versioning is implemented |

---

## 6. Middleware pipeline

**API** — `AccountManegmentAPI/Program.cs:166-176`

```csharp
var app = builder.Build();
app.UseCors("AllowFrontend");
app.UseSwagger();
app.UseSwaggerUI(...);
app.MapControllers();          // ← registers endpoints
app.UseHttpsRedirection();     // ← after MapControllers
app.UseAuthentication();       // ← after MapControllers
app.UseAuthorization();
app.Run();
```

**Assessment:** this reads alarmingly but is **not actually a security bug**. In
.NET 6+ minimal hosting, `WebApplication` auto-inserts `UseRouting()` at the start
and `UseEndpoints()` at the very end of the pipeline. `MapControllers()` registers
endpoint *data*, not middleware, so authentication and authorization still execute
before endpoint invocation. It is stylistically wrong and will confuse every
future maintainer, but it works.

`UseHttpsRedirection()` after `MapControllers()` is likewise harmless-but-wrong.

**Genuine issues in this pipeline:**

- **Swagger is enabled unconditionally, including in production.** There is no
  `if (app.Environment.IsDevelopment())` guard. The full API surface, including
  every parameter name and model shape, is published at `api.avfast.in/swagger`.
- **No global exception handler.** Unhandled exceptions surface as raw 500s.
- **No rate limiting** — .NET 8 has built-in rate limiting available and unused.
- **No response compression** — 511 KB of JS transfers uncompressed unless the
  reverse proxy intervenes.

**Web** — `AccountManegments.Web/Program.cs:42-62`

```csharp
if (!app.Environment.IsDevelopment()) { app.UseExceptionHandler("/Home/Error"); app.UseHsts(); }
//app.UseHttpsRedirection();          ← COMMENTED OUT
app.UseStaticFiles();
app.UseRouting();
app.UseSession();
app.UseCookiePolicy();
app.UseAuthentication();
app.UseAuthorization();
```

- `UseHttpsRedirection()` is **commented out**, and the auth cookie is configured
  `CookieSecurePolicy.None` (`Program.cs:26`) — so session cookies are transmitted
  over plain HTTP if a user reaches the site that way.
- `AddSession()` is called **twice** (`:10` and `:33`), which is harmless but
  indicates the configuration was not reviewed.

---

## 7. Deployment (current)

Evidence from `web.config` and the publish profiles:

| Aspect | Current state |
|---|---|
| **Host** | IIS on Windows, `AspNetCoreModuleV2`, `hostingModel="inprocess"` |
| **Deployment method** | Visual Studio publish — FTP and Web Deploy profiles present for `jigneshsatani-001-subsite8` and `subsite46` |
| **CI/CD** | A `.github` folder exists; no pipeline was found in the analysed source. **UNKNOWN** |
| **stdout logging** | `stdoutLogEnabled="false"` — disabled |
| **Database hosting** | Self-managed SQL Server on a Hostinger VPS (`srv1925876.hstgr.cloud`), port 1433 exposed to the internet |
| **File storage** | Local disk under `wwwroot/` — `Content/InWordDocument/`, `Uploads/`, `UploadExcelFile/`. **User-uploaded files are served directly from the web root** |
| **Backups** | **UNKNOWN** |
| **Monitoring** | **NONE FOUND** |
| **SSL** | Present on both public hostnames; not enforced by the application |

> **Finding — publish artefacts committed to the repository.** The
> `AccountManegmentAPI/Publish/` folder is checked in and contains a full
> deployment (469 DLLs, ~180 MB), **including `appsettings.json` with the production
> `sa` credentials**, nested six levels deep (`Publish/Publish/Publish/…`). This
> should be removed from source control and added to `.gitignore`.
