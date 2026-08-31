# 06 — API Inventory

**138 endpoints across 14 controllers.** All use the route template
`[Route("api/[controller]")]`, so the full route is `api/{Controller}/{ActionRoute}`.

---

## 1. Endpoint count by controller

| Controller | Base route | Endpoints | Class-level `[Authorize]`? |
|---|---|---|---|
| `AuthenticationController` | `api/Authentication` | 7 | No — per-action |
| `CompanyController` | `api/Company` | 6 | No — per-action |
| `FormPermissionMasterController` | `api/FormPermissionMaster` | 3 | ⚠️ **No — and 2 of 3 actions have none either** |
| `ItemInWordController` | `api/ItemInWord` | 9 | No — per-action |
| `ItemMasterController` | `api/ItemMaster` | 14 | Yes (`:18`) |
| `MasterListController` | `api/MasterList` | 3 | ⚠️ **No `[Authorize]` anywhere** |
| `PurchaseOrderController` | `api/PurchaseOrder` | 13 | Yes (`:16`) |
| `PurchaseOrderDetailsController` | `api/PurchaseOrderDetails` | 4 | Yes (`:14`) |
| `PurchaseRequestController` | `api/PurchaseRequest` | 8 | Yes (`:16`) |
| `SalesController` | `api/Sales` | 20 | Yes (`:15`) |
| `SiteMasterController` | `api/SiteMaster` | 16 | Yes (`:17`) |
| `SupplierInvoiceController` | `api/SupplierInvoice` | 20 | Yes (`:19`) |
| `SupplierInvoiceDetailsController` | `api/SupplierInvoiceDetails` | 6 | Yes (`:14`) |
| `SupplierMasterController` | `api/SupplierMaster` | 9 | Yes (`:20`) |

---

## 2. Category breakdown

| Category | Count | Notes |
|---|---:|---|
| **Authentication** | 1 | `Authentication/Login` only |
| **Administration** (users + permissions) | 9 | 6 user endpoints + 3 permission endpoints |
| **Master data** | 48 | MasterList 3, Company 6, ItemMaster 14, SiteMaster 16, SupplierMaster 9 |
| **Transactions** | 70 | PR 8, PO 13, PODetails 4, Inward 9, SupplierInvoice 14, SIDetails 6, Sales 16 |
| **Reports** | 10 | 4 Sales + 6 SupplierInvoice |
| **Dashboard** | **0** | Assembled in the Web tier by `HomeController` calling ordinary list endpoints and filtering in memory |
| **Search** | **0** | No dedicated endpoints. Search is a `searchText`/`searchBy`/`sortBy` query-string triple bolted onto ~15 list endpoints |
| **File operations** | **0** | All `IFormFile` handling is in the Web tier. The Excel endpoints accept parsed JSON arrays, not files |
| **Notifications** | **0** | None exist |
| **Integrations** | **0** | No outbound webhooks, payment gateways, e-invoicing, or email/SMS clients anywhere |

---

## 3. Authentication endpoints (representative detail)

| Method | Route | Action | Auth | Notes |
|---|---|---|---|---|
| POST | `api/Authentication/Login` | `Login` | `[AllowAnonymous]` | ⚠️ **Plaintext password comparison.** Dead second token generated at `:34` and discarded |
| POST | `api/Authentication/GetAllUserList` | `GetAllUserList` | `[Authorize]` | POST that only reads. **Unbounded.** Returns password-bearing views |
| GET | `api/Authentication/GetUserById` | `GetEmployeeById` | `[Authorize]` | ⚠️ **Returns the user's plaintext `Password`** (`UserAuthentication.cs:236`). **IDOR** — no ownership check |
| POST | `api/Authentication/CreateUser` | `CreateUser` | `[Authorize]` | ⚠️ Grants **all rights on all forms** to every new user (`:135-153`) |
| POST | `api/Authentication/UpdateUserDetails` | `UpdateUserDetails` | `[Authorize]` | Writes `Password` straight through (`:525`) |
| POST | `api/Authentication/ActiveDeactiveUsers` | | `[Authorize]` | Blind toggle |
| POST | `api/Authentication/DeleteUserDetails` | | `[Authorize]` | ⚠️ **IDOR** — any authenticated user can delete any user |

The full 138-row table is long; the structural findings below matter more than
reproducing every row, and every route is discoverable from the live Swagger
document at `api.avfast.in/swagger` (which is, itself, a finding — see
[08](08-Security-Model-and-Review.md)).

---

## 4. Structural findings

### 4.1 Authorization is authentication-only

**Every `[Authorize]` in all 14 controllers is parameterless.** Verified zero
occurrences of `[Authorize(Roles`, `[Authorize(Policy`, `AddAuthorization`,
`User.Claims`, or `HttpContext.User` in the API or repository projects.

The token itself carries no authorization data (`UserAuthentication.cs:196-199`):

```csharp
var claims = new List<Claim>();
claims.Add(new Claim(JwtRegisteredClaimNames.Sub, model.UserName));
claims.Add(new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()));
claims.Add(new Claim("UserName", model.UserName));
```

No user id. No role. No permissions. No site or company scope.

**Consequence:** a view-only clerk can copy their token out of devtools and call
`PurchaseOrder/PurchaseOrderIsApproved` or `Authentication/DeleteUserDetails`
directly. The `FormPermissionAttribute` that supposedly restricts them runs in a
**different process** and is never consulted by the API.

Segregation of duties does not exist in this system.

### 4.2 Two unauthenticated endpoints control the entire permission model

`FormPermissionMasterController.cs:42-54` — no `[Authorize]` on the action, and
none on the class either:

```csharp
[HttpPost]
[Route("GetUserwiseFormPermissionById")]
public async Task<IActionResult> GetUserwiseFormPermissionById(Guid UserId)

[HttpPost]
[Route("UpdateMultipleUserewiseFormPermission")]
public async Task<IActionResult> UpdateMultipleUserewiseFormPermission(List<UserwiseFormPermissionModel> UserwiseFormPermission)
```

The sibling `GetFormGroupList` at `:31-35` **does** carry `[Authorize]`, which
confirms the omission is an oversight rather than a design decision.

**No credentials are required at all.** Anyone who obtains a `UserId` GUID —
they are returned by `GetAllUserList` and appear in Web-tier URLs and page source —
can read that user's rights matrix and then POST a modified array granting
themselves every right on every form. **Fix this today.**

Likewise `MasterListController` (3 endpoints) has no `[Authorize]` anywhere,
though it exposes only reference data.

### 4.3 Systemic IDOR

Roughly 40 endpoints take an entity `Id` and perform no ownership or scope check.
`GetSupplierInvoiceById(Guid Id)`, `DeleteUserDetails(Guid UserId)`,
`GetPurchaseOrderDetailsById(Guid POId)` and their peers will operate on **any**
row, for any site or company, for any authenticated caller.

The site and company scoping that the UI applies happens **in the MVC tier, in
memory**, after the API has already returned the data.

### 4.4 Mass assignment by construction

~40 endpoints take an entire entity model as input — `CreateUser(UserViewModel)`,
`AddCompany(CompanyModel)`, `AddSiteDetails(SiteMasterModel)`,
`InsertSalesInvoiceDetails(SalesInvoiceMasterModel)`, and so on.

There is **no DTO/command separation, no `[Bind]`, and no explicit allow-list
anywhere.** Combined with the absence of any server-side validation and with all
money arithmetic being client-side, this means a crafted request can set
`TotalAmount`, `IsApproved`, `CreatedBy` or any other field to any value.

### 4.5 Three different response envelopes on one API

| Shape | Used by | Evidence |
|---|---|---|
| `{ code, data, message }` (lowercase) | `ApiResponseModel` | `ApiResponseModel.cs:11-13` |
| `{ Code, Data, Message }` (PascalCase) | `UserResponceModel`, `LoginResponseModel` | `AuthenticationController.cs:36-38` |
| `Ok(new { code = 200, data = ... })` (anonymous) | every list endpoint | throughout |

Every consumer must handle all three.

### 4.6 GET endpoints that mutate state

Three, all in `SalesController`:

```csharp
[HttpGet]
[Route("DeleteSalesInvoiceDetails")]
public async Task<IActionResult> DeleteSalesInvoiceDetails(Guid Id)
```
(`SalesController.cs:90-92`), plus `DeleteInventoryDetails` (`:152-154`) and
`ApproveInventoryDetails` (`:170-172`).

These are CSRF-able by a plain link and may be triggered by browser prefetch,
link scanners or crawlers.

### 4.7 POST endpoints that only read — ~29

`GetAllUserList`, `GetAllCompany`, `GetItemList`, `GetPurchaseOrderList`,
`GetSupplierInvoiceList`, `GetSiteList`, and 23 more. Several take their
parameters on the **query string** despite being POST, so the body is empty and
the Web tier calls them as `PostAsync("", apiUrl)` (`HomeController.cs:40, 125, 154`).

### 4.8 Every list endpoint is unbounded

No `Skip`/`Take` anywhere in the controllers. `DataTableRequstModel` carries
`pageSize`/`skip` but only the 6 report endpoints accept it — and no repository
reads it.

Worst case: `PurchaseOrderDetailsController.GetPurchaseOrderDetailsList()` takes
**no parameters at all** and returns every row (`:26-29`).

### 4.9 Duplicate and overlapping endpoints

| Overlap | Endpoints |
|---|---|
| PO details by id | `PurchaseOrderController.GetPurchaseOrderDetailsById(Guid POId)` **and** `PurchaseOrderDetailsController.GetPurchaseOrderDetailsById(int Id)` |
| PO add/update | Exist in **both** `PurchaseOrderController:42,60` and `PurchaseOrderDetailsController:40,58` with different body types |
| Invoice-number check | `CheckSuppliersInvoiceNo` (GET, `:142`) vs `CheckSupplierInvoiceNo` (POST, `:295`) — one letter apart |
| Single-invoice readers | `GetSupplierInvoiceById` / `GetSupplierInvoiceDetailsById` / `GetInvoiceDetailsById` / `GetPayoutDetailsbyId` — four on one controller |
| Approval pairs | 6 singleton/batch pairs: `ItemIsApproved` vs `MutipleItemsIsApproved`, and the same for Inward, PR, PO, Supplier, Invoice |
| Item lists | `GetItemList` / `GetAllItemDetailsList` / `GetItemNameList` |
| Item by id | `GetItemDetailsById` / `GetItemDetailsListById` / `GetItemDetailsByProductId` |
| Group lists | `GetGroupNameList` (POST) / `GetGroupNamesList` (POST) / `GetGroupNameListBySiteId` (GET) |
| Name lists | `GetAllCompany`/`GetCompanyNameList`, `GetAllSupplierList`/`GetSupplierNameList`, `GetSiteList`/`GetSiteNameList` |

`Program.cs:131` papers over the resulting Swagger collisions:
```csharp
c.ResolveConflictingActions(apiDescriptions => apiDescriptions.First());
```

### 4.10 Naming

- **Typos baked into public routes:** `GetCompnaytById`, `UpdateMultipleUserewiseFormPermission`, `UpdatetMultipleItemInWordDetails`, `MutipleItemsIsApproved`, `GetSalestInvoiceList`, `GetPayoutDetailsbyId`
- **The Inward domain is spelled four ways:** `ItemInWord` (route), `ItemInword` (entity), `ItemInward` (service/repo), `Inword`/`Inward` mixed in parameters
- **Action name ≠ route:** `SupplierMasterController.GetAllUserList` serves route `GetAllSupplierList`; `GetEmployeeById` serves both `GetSupplierById` **and** `GetUserById` on different controllers
- **Id parameter names vary:** `Id`, `POId`, `ItemId`, `UserId`, `InwordId`, `SiteId`, `purchaseId`, `PurchaseId`, `SalesId`, `InventoryId` — and types alternate `Guid`/`int`/`string` for the same conceptual key (`GetPRPendingData(string PRId)`, `GetSupplierInvoiceDetailsById(int InvoiceId)`)

---

## 5. Web → API communication

`Helper/APIServices.cs` is the proxy. Findings:

| Aspect | Current state | Consequence |
|---|---|---|
| **HttpClient lifecycle** | `new HttpClient()` **per call**, inside a `using` | **Socket exhaustion.** Disposed sockets sit in `TIME_WAIT` for ~4 minutes; under load the process runs out of ephemeral ports. `IHttpClientFactory` exists precisely for this and is not used |
| **Timeout** | Default (100 s) | A slow unpaged query holds a Web-tier thread for 100 s |
| **Retry** | **NONE** | |
| **Circuit breaker** | **NONE** | |
| **Error handling** | **Inconsistent between GET and POST** | Different failure shapes reach the caller |
| **Bearer token** | Read from server session, attached per call | Works, but couples every call to session state |
| **Deserialization** | `dynamic` / `JObject` throughout | No compile-time contract. A field rename in the API breaks the Web tier silently at runtime |
| **Base URL** | **Two settings**, `WebAPIBaseUrl` and `WebAPIUrl`, joined inconsistently | Latent bug |

---

## 6. Redesign recommendations for the Node API

The brief asked not to reproduce poor API design in Node. Concretely:

### 6.1 Do not port these

| Do not port | Replace with |
|---|---|
| Three response envelopes | One: `{ data, meta }` on success, RFC 9457 Problem Details on error |
| POST-for-read | `GET` with query parameters; `POST /search` only where the filter genuinely exceeds URL limits |
| GET-that-mutates | `DELETE` / `POST` |
| Entity models as request bodies | Explicit Zod-validated command DTOs with allow-lists |
| Six singleton/batch approval pairs | One batch endpoint that accepts one or many |
| Four overlapping single-invoice readers | One `GET /purchase-invoices/:id` with an `?include=` parameter |
| Duplicate PO controllers | One resource, with `/purchase-orders/:id/lines` as a sub-resource |
| Typo'd route names | Correct spelling. This is a clean break — take it |
| `dynamic`/`JObject` | Generated TypeScript client from the OpenAPI spec, shared types |

### 6.2 Add these — none exist today

| Capability | Why |
|---|---|
| **Pagination on every list** | `{ cursor, limit }` → `{ rows, nextCursor, total }`. Keyset for large tables |
| **Filtering and sorting as first-class query parameters** | So filters reach the database instead of being applied in memory two tiers up |
| **Per-endpoint authorization** | `requireAuth` as default-deny router middleware, then `requirePermission('invoice:approve')` per route. Plus a CI test that enumerates all registered routes and fails the build on any route not in an explicit public allow-list — so a forgotten decorator fails closed |
| **Site/company scoping middleware** | Applied in the data layer, not the UI |
| **Server-side validation** | Zod schemas at the boundary. Reject, do not coerce |
| **Server-authoritative money** | Recompute every total server-side on save; treat client values as advisory and reject mismatches |
| **Idempotency keys** on create endpoints | Prevents duplicate invoices from double-submits |
| **Rate limiting** | Especially on `/auth/login` |
| **API versioning** | `/api/v1/` from day one |
| **Structured logging with correlation ids** | |
| **OpenAPI spec as the source of truth** | Generate the TypeScript client from it |

### 6.3 Proposed resource shape

```
POST   /api/v1/auth/login                       → { accessToken, refreshToken, user }
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

GET    /api/v1/companies?cursor=&limit=&q=
GET    /api/v1/sites            /api/v1/suppliers      /api/v1/items
GET    /api/v1/users            /api/v1/users/:id/permissions
PUT    /api/v1/users/:id/permissions

GET    /api/v1/purchase-requests?siteId=&status=&from=&to=&cursor=&limit=
POST   /api/v1/purchase-requests
GET    /api/v1/purchase-requests/:id
POST   /api/v1/purchase-requests/approve          { ids: [...], approved: true }

GET    /api/v1/purchase-orders
POST   /api/v1/purchase-orders
GET    /api/v1/purchase-orders/:id?include=lines,addresses
GET    /api/v1/purchase-orders/:id/pending        ← the PO-vs-invoiced view
GET    /api/v1/purchase-orders/:id/invoices

GET    /api/v1/purchase-invoices
POST   /api/v1/purchase-invoices                  Idempotency-Key: <uuid>
GET    /api/v1/purchase-invoices/:id?include=lines
GET    /api/v1/purchase-invoices/next-number?companyId=   ← from a DB sequence

GET    /api/v1/sales-invoices                     (mirrors purchase-invoices)

GET    /api/v1/payments?direction=out|in
POST   /api/v1/payments

GET    /api/v1/reports/ledger?…                   → paged
GET    /api/v1/reports/sales?…
POST   /api/v1/exports/ledger                     → job id (async, not inline)

GET    /api/v1/dashboard/pending-approvals        ← ONE endpoint, replacing 6 client-side-filtered list calls
```

**Endpoint count drops from 138 to roughly 60** through consolidation, without
losing a single capability.
