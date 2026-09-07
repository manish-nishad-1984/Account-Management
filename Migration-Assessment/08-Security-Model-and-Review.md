# 08 — Security Model & Review

> **Four findings in this document require action this week, independent of any
> migration decision.** They are marked **ACT NOW**.

---

## Part 1 — The existing security model

### 1.1 Authentication flow, end to end

```
 1. Browser POSTs to Web/Authentication/UserLogin
 2. Web forwards to API  POST api/Authentication/Login          [AllowAnonymous]
 3. UserAuthentication.Login:
       user exists?           → 404 "User not found"
       user.IsActive?         → 403 "Your account is inactive…"
       password matches?      → PLAINTEXT != COMPARISON   ← UserAuthentication.cs:409
 4. GenerateToken(...)  → HS256 JWT, 8 h, key from appsettings.json
 5. Repository also loads: permission matrix, site list, company list
 6. Web tier receives the response and:
       - creates a cookie-auth principal with claims UserId, FullName, …
       - writes token, SiteId, CompanyId and the full permission matrix into SERVER SESSION
       - if "Remember me": writes UserName AND PASSWORD to plain cookies for 7 days
```

### 1.2 Password handling

**Plaintext. No hashing, no salting, no encryption.**

`UserAuthentication.cs:409`:
```csharp
if (tblUser.User.Password != loginRequest.Password)
```
Written plaintext on create (`:123`), overwritten plaintext on update (`:525`),
column is `nvarchar(20)` (`User.cs:20`), and **read back out over the API** (`:236`).

An AES helper does exist — `Web/Models/Common.cs:17-48` (`EncryptStrSALT`,
`RijndaelManaged`) — but it is **never called by anything**, and it is broken anyway:
`GetKeySalt()` reads a `"KeySALT"` setting that **does not exist in appsettings.json**,
so `PasswordDeriveBytes(null, salt)` throws and `catch { return string.Empty; }`
swallows it. The salt derivation is itself meaningless (`Common.cs:31`):
```csharp
byte[] salt = Encoding.ASCII.GetBytes(password.Length.ToString());
```
— the ASCII digits of the key's *length*, a 1-2 byte constant. Dead, broken, and
not on the auth path.

### 1.3 JWT

`UserAuthentication.cs:194-205`:

| Property | Value |
|---|---|
| Claims | **Three only:** `sub` (UserName), `jti` (random Guid), custom `UserName` |
| **Not in the token** | User id · role · permissions · site · company · email |
| Expiry | 8 hours, from **`DateTime.Now`** — local server time, not UTC |
| Algorithm | HS256 (symmetric) |
| Signing key | `appsettings.json:19` — 35 ASCII characters, **committed to source control** |
| Refresh tokens | **NONE** |
| Revocation | **NONE** |

⚠️ **The `DateTime.Now` bug:** `JwtSecurityToken` converts to epoch assuming UTC.
On a server set to IST, tokens are born ~5.5 h "in the past" and expire early.

**Validation** (`Program.cs:113-124`): issuer, audience and lifetime are validated,
and signature checking does happen (`ValidateIssuerSigningKey` defaults to `true`
when a key is supplied). But **`ValidAlgorithms` is not constrained**, `ClockSkew`
is left at the 5-minute default, and there are no `Events` for logging failures.

**Dead code:** `AuthenticationController.cs:34` generates a *second* token that is
never assigned to the response. Do not port this line.

### 1.4 Session and cookies

**Web tier** (`Web/Program.cs:22-38`):

| Setting | Value | Assessment |
|---|---|---|
| Cookie auth scheme | 8 h sliding expiry | Reasonable |
| `HttpOnly` | `true` | Good |
| **`SecurePolicy`** | **`CookieSecurePolicy.None`** | ⚠️ Cookie sent over plain HTTP |
| `SameSite` | Not set (framework default `Lax`) | Acceptable |
| Session idle timeout | 8 h | Long, but consistent |
| `UseHttpsRedirection()` | **Commented out** (`:49`) | ⚠️ |
| `AddSession()` | Called **twice** (`:10` and `:33`) | Harmless; indicates unreviewed config |

Server session holds: `UserId`, `FullName`, `Token`, `SiteId`, `CompanyId`, and the
**entire permission matrix**. About 80 Razor call sites read from it.

**API session:** `AddDistributedMemoryCache()` + `AddSession()` with a 160-minute
idle timeout — but `UseSession()` is **never called** in the API pipeline, so this
is dead configuration.

### 1.5 Authorization model

**Entities:** `User` · `Form` (the screen registry) · `UserwiseFormPermission`
(the live model) · `RolewiseFormPermission` (**designed and abandoned — not mapped**)

**Granular rights per form:** `IsViewAllow`, `IsAddAllow`, `IsEditAllow`,
`IsDeleteAllow`, `IsApproved`.

**Resolution:** at login, the full matrix is loaded into server session
(`UserAuthentication.cs:428-446`), keyed by form name.

**UI enforcement** — `Web/Helper/FormPermission.cs`, applied as
`[FormPermissionAttribute("Supplier Invoice", "view")]` on MVC actions, and read
directly in Razor to show/hide menu items and buttons.

**API enforcement — none.** See §2, C-7.

**Record-level scoping:** `User.SiteId` and `User.CompanyId` are comma-separated
GUID strings. They are resolved into lists at login and used to filter **in the MVC
tier, in memory** — after the API has already returned every row. The API applies
no scoping whatsoever.

---

## Part 2 — Security findings

### CRITICAL

---

#### **C-1 — Passwords stored and compared in plaintext** · **ACT NOW**

**Evidence:** `UserAuthentication.cs:409`, `:123`, `:525`; `User.cs:20`

**Exploit:** any read of the `Users` table — a stolen backup, a leaked `.bak`, an
insider with the `sa` credential from C-3, or the API endpoint in C-2 — yields
every user's cleartext password. Because people reuse passwords, this compromises
their other accounts. It also makes a breach non-deniable and, in most
jurisdictions, individually notifiable.

**Remediation (Node):** `argon2id` (`memoryCost ≥ 19456 KiB, timeCost ≥ 2,
parallelism = 1`), or bcrypt cost ≥ 12. Store as a single PHC-format string.
Compare with the library's constant-time `verify()`.
**Migration path:** add a `password_hash` column; on each successful legacy
plaintext login, hash-and-store then null the legacy column; force-reset any
account not migrated within one cycle.

---

#### **C-2 — The API returns users' plaintext passwords over HTTP** · **ACT NOW**

**Evidence:** `UserAuthentication.cs:229-237` — the projection inside `GetUserById`
includes `Password = user.Password`. Exposed at
`GET api/Authentication/GetUserById?UserId=<guid>`, guarded only by `[Authorize]`.

**Exploit:** a user with the lowest possible privileges logs in, calls
`POST api/Authentication/GetAllUserList` (also `[Authorize]`-only) to enumerate every
`UserId`, then loops `GetUserById` over them. **Full credential dump of the
organisation in under a minute**, including administrator accounts. No permission
check stands between them and it.

**Remediation:** the password must never appear in a response DTO. Define an explicit
`UserPublicDto`; never `res.json(userRow)`. Add a response-shape test that fails if
any key matching `/pass|secret|token|hash/i` appears in a user-facing payload.

---

#### **C-3 — Hardcoded production `sa` credentials in source control** · **ACT NOW**

**Evidence:** `AccountManegmentAPI/appsettings.json:6`
```json
"ACCDbconn": "Data Source=srv1925876.hstgr.cloud,1433;Initial Catalog=DBAccManegment;User ID=sa;Password=…;Encrypt=False"
```
Two further credential sets are commented out immediately above (`:3`, `:5`).

**Three compounding failures:**
1. **`sa` is SQL Server's unrestricted sysadmin.** This connection can `DROP DATABASE`,
   read every other database on the instance, and on many configurations reach the OS.
2. **`Encrypt=False`** — the TDS session, including that password and every row of
   financial data, crosses the network **in cleartext**.
3. **The host is a public FQDN on the default port 1433.** Anyone who obtains this
   file connects from the internet.

⚠️ **Compounding this:** the file is also present in the checked-in
`AccountManegmentAPI/Publish/` folder, **five times over** at nested paths.

**Remediation:**
- **Rotate `sa` and both commented-out passwords today. Treat all three as public.**
- Create a least-privilege application login: `SELECT/INSERT/UPDATE/DELETE` on the
  app schema only, no DDL, no server roles.
- Firewall 1433 to the application subnet.
- Read the connection string from `process.env` injected by a secret store.
- Enable TLS (`encrypt: true, trustServerCertificate: false`).
- Add `gitleaks` as a pre-commit hook and **purge the git history**.

---

#### **C-4 — JWT signing key in source control** · **ACT NOW**

**Evidence:** `appsettings.json:19` — `"Key": "abjlkumfk@!!gjnbtgyngpeunhdnc@ghdnd"`

**Exploit:** this is the **sole secret protecting the entire API**. Anyone holding it
forges a token for any username with an arbitrary expiry. Because the API's
authorization is authentication-only (C-7), a forged token is **total compromise of
all 138 endpoints** — read, write, approve, delete. There is no revocation list, so
the forgery cannot be stopped short of rotating the key and invalidating every
real session.

**Remediation:** rotate immediately. Generate ≥256 bits of CSPRNG output. Strongly
prefer **RS256/ES256** with a private key held only by the issuing service and a
public JWKS the API fetches — so a compromised API host cannot mint tokens. Support
two active `kid`s for zero-downtime rotation. In Node use `jose` and pin
`algorithms: ['RS256']` explicitly on verify.

---

#### **C-5 — The user's cleartext password is written to a non-HttpOnly, non-Secure cookie for 7 days**

**Evidence:** `Web/Controllers/AuthenticationController.cs:181-186`
```csharp
if (login.RememberMe)
{
    CookieOptions cookie = new CookieOptions { Expires = DateTime.UtcNow.AddDays(7) };
    Response.Cookies.Append("UserName", login.UserName, cookie);
    Response.Cookies.Append("Password", login.Password, cookie);
}
```
`CookieOptions` sets only `Expires`, so `HttpOnly = false` and `Secure = false`.

**Exploit:** any XSS anywhere on the site reads `document.cookie` and exfiltrates
**the actual reusable credential**, not a session token that expires. On any plain
HTTP request (and `UseHttpsRedirection` is commented out) it crosses the wire in
the clear. **It survives logout.** On a shared machine the next user reads it from
devtools.

**Remediation:** delete this feature. "Remember me" must mean a long-lived **opaque
refresh token** — random 256-bit value, stored server-side hashed, rotated on every
use with reuse detection, delivered as
`HttpOnly; Secure; SameSite=Strict; Path=/auth/refresh`.

---

#### **C-6 — Two unauthenticated endpoints control the entire permission model** · **ACT NOW**

**Evidence:** `FormPermissionMasterController.cs:42-54` — `GetUserwiseFormPermissionById`
and `UpdateMultipleUserewiseFormPermission` have **no `[Authorize]`**, and neither
does the class. The sibling `GetFormGroupList` at `:31-35` does, confirming this is
an oversight.

**Exploit:** **no credentials required at all.** Anyone with a `UserId` GUID — they
are returned by `GetAllUserList` and appear in Web URLs and page source — reads that
user's rights matrix, then POSTs a modified array setting every right true on every
form. The repository writes it without any caller check
(`FormPermissionMasterRepo.cs:73-91`). Combined with C-1/C-2 this is a full
**unauthenticated path to administrator**.

**Remediation:** add `[Authorize]` to the class today. In the target, apply
authorization as **default-deny router-level middleware**, plus a CI test that
enumerates all registered routes and fails the build on any route not in an
explicit public allow-list — so a forgotten decorator **fails closed**.

---

#### **C-7 — The API performs no per-endpoint authorization**

**Evidence:** every `[Authorize]` in all 14 controllers is parameterless. Zero
occurrences of `[Authorize(Roles`, `[Authorize(Policy`, `AddAuthorization`,
`User.Claims`, or `HttpContext.User`. The token carries no authorization data
(`UserAuthentication.cs:196-199`).

**Exploit:** a view-only clerk logs in through the normal UI, opens devtools, copies
the token, and issues `POST .../SupplierInvoice/InvoiceIsApproved` — **approving
their own fraudulent invoices** — then `POST .../Authentication/DeleteUserDetails`
to remove the audit trail. The `FormPermissionAttribute` they were supposedly bound
by runs in a **different process** and is never consulted.

**Segregation of duties does not exist in this system.** For a financial
application, this is the most serious architectural finding in the assessment.

**Remediation:** move authorization into the API. Put stable claims in the token
(`sub` = user id, `permissions` = compact scope array or a permissions-version stamp),
verify on every request, re-check against the database when the stamp is stale. The
Web tier's checks become **UI hints only**, and should be documented as such.

---

### HIGH

| # | Finding | Evidence | Remediation |
|---|---|---|---|
| **H-1** | **Systemic IDOR.** ~40 `*ById` / `Delete*` / `Update*` endpoints take an id and perform no ownership or scope check | throughout | Scope every query by the caller's site/company in the data layer, not the UI |
| **H-2** | **Mass assignment.** ~40 endpoints accept whole entity models with no allow-list, no `[Bind]`, no validation | throughout | Zod-validated command DTOs |
| **H-3** | **The server trusts client-computed money.** Nothing validates `TotalAmount` against line items | `SupplierInvoiceRepo.cs:820-822` | Recompute server-side; reject mismatches |
| **H-4** | **New users are created with all rights on all forms** | `UserAuthentication.cs:135-153` | Default-deny |
| **H-5** | **`UseHttpsRedirection()` commented out** and cookie `SecurePolicy.None` | `Web/Program.cs:26`, `:49` | HSTS + Secure cookies + redirect |
| **H-6** | **Swagger enabled in production**, publishing the entire API surface | `Program.cs:168-169` — no environment guard | Gate behind `IsDevelopment()` or auth |
| **H-7** | **No rate limiting anywhere**, including on login | — | .NET 8 has built-in rate limiting; in Node use `express-rate-limit` + a login-specific lockout |
| **H-8** | **No CSRF protection.** No antiforgery tokens on POSTs, plus 3 GET endpoints that mutate | `SalesController.cs:90, 152, 170` | `SameSite=Strict` + double-submit token; never GET-to-mutate |
| **H-9** | **Unrestricted file upload.** No extension, size, or content-type validation found; files are written into `wwwroot/` and **served directly from the web root** | 8 Web controllers | Validate type and size, store outside the web root, serve through a controlled endpoint, randomise names — **closed in the port for inward challans, 7 Sep 2026** |
| **H-10** | **Path traversal risk** in the inward document handler | `ItemInWordController.cs:181` | Canonicalise and verify the resolved path stays inside the target directory — **closed in the port, 7 Sep 2026** |
| **H-11** | **Username enumeration** — "user not found" and "password incorrect" are distinguishable | `UserAuthentication.cs:388-413` | One generic message for both |
| **H-12** | **`throw ex;` (47 sites) and `ex.Message` leaked to the browser (25+ sites)**, including full exception objects | e.g. `ItemMasterRepo.cs:354` | Generic client message + correlation id; full detail to structured logs only |
| **H-13** | **`System.Linq.Dynamic.Core` used for runtime string-based sorting.** If a sort field name reaches it from user input unvalidated, it permits arbitrary expression evaluation | `AccountManagement.Repository.csproj:14` | Allow-list sortable columns; never pass user strings through |

#### H-9 and H-10 — what the port actually does, 7 Sep 2026

Inward challans are the first module in the port to accept a file, so these two
are answered there first. **They remain open against the LIVE .NET application**,
which is unchanged: the table above describes the system in production.

The legacy single-file handler is four lines and holds every mistake available:

```csharp
var path = Environment.WebRootPath;
var filepath = "Content/InWordDocument/" + ItemInWordDetails.DocumentName.FileName;
var fullpath = Path.Combine(path, filepath);
UploadFile(ItemInWordDetails.DocumentName, fullpath);
```

1. `IFormFile.FileName` is the browser's, unsanitised. It may contain separators
   and `..`, so the destination is caller-controlled — an arbitrary file WRITE
   anywhere the web process can reach. That is H-10, and it is a write, not just
   a read.
2. `FileMode.Create` truncates, so two suppliers uploading `invoice.pdf`
   overwrite one another and the earlier challan then shows the later one's
   document. (`InsertMultipleItemInWordDetail` prefixes a GUID and avoids this.
   `AddItemInWordDetails` does not, and both are live.)
3. The destination is inside `wwwroot`, so every attachment in the business is
   anonymously downloadable by anyone who guesses a file name — no login, no
   permission, no site scope.
4. No extension, size or content check, so an `.html` upload is stored XSS on the
   application's own origin.

In the port:

| Concern | Where |
|---|---|
| Storage key generated server-side; the uploaded name is a column, never a path | `common/storage/document-storage.ts` |
| Driver re-verifies the resolved path is inside its root, and refuses to overwrite | `common/storage/local-disk.storage.ts` |
| Extension allowlist and a 10 MB cap, shared with the browser | `contracts/attachments.ts` |
| Content sniffed from the file's own signature; a renamed file is refused | `common/storage/file-type.ts` |
| Header built safely — no quote, CR or LF can reach it | `common/storage/content-disposition.ts` |
| Every download behind a token and `inward-challan.view`, `attachment` + `nosniff` | `modules/inward-challans/inward-challans.controller.ts` |
| Bytes outside the web root and outside the pruned release directory | `STORAGE_DIR`, required in production |

`.html`, `.svg` and `.xml` are excluded from the allowlist deliberately: all
three script in a browser, and `.svg` is the one that looks like an image and is
not.

The remaining seven upload sites in the .NET application — supplier, item,
invoice, sales, purchase and report controllers — are untouched. Each becomes a
caller of the same interface as its module is ported.

### MEDIUM

- **No logging of any kind**, so no security event is recorded — no failed-login trail, no audit of permission changes, no way to detect the exploitation of C-6
- **No account lockout** after repeated failures
- **No password policy** — the column is `nvarchar(20)`, so passwords are also capped at 20 characters
- **No session invalidation on password change**
- **CORS `AllowCredentials()` with specific origins** is correct, but the API is reachable directly and the browser is not the only client
- **17+ empty catch blocks** silently swallow errors including on the login path (`UserAuthentication.cs:501-505`)
- **Publish artefacts with production secrets committed to the repository**
- **`.NET 6` libraries are past end of support** — no security patches

---

## Part 3 — Recommended target security architecture

```
   React SPA
     · Access token in memory only  (never localStorage — XSS-readable)
     · Refresh token in HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh
     · Permissions fetched into a PermissionContext, used ONLY to hide UI
        ↓
   API Gateway / reverse proxy
     · TLS termination · HSTS · rate limiting · request size limits
        ↓
   NestJS
     · Global APP_GUARD = JwtAuthGuard        ← DEFAULT DENY
     · @Public() decorator for the few open routes (login, refresh, health)
     · @RequirePermission('invoice:approve')  ← per-route, enforced server-side
     · SiteScopeInterceptor injects the caller's site/company into every query
     · ZodValidationPipe on every request body
     · Helmet, CORS allow-list, CSRF for cookie-based flows
     · Pino structured logs with correlation ids; secrets redacted by default
        ↓
   PostgreSQL
     · Least-privilege application role — no DDL, no superuser
     · TLS required · pgcrypto for at-rest field encryption where needed
     · Row-level security as defence in depth for site scoping (optional)
```

### Token design

| | Access token | Refresh token |
|---|---|---|
| Type | JWT, **RS256** | Opaque 256-bit random |
| Lifetime | **15 minutes** | 7 days, **rotated on every use** |
| Storage | Memory only | HttpOnly cookie, hashed server-side |
| Claims | `sub` (user id), `perm_v` (permissions version), `sites`, `companies`, `jti` | — |
| Revocation | Short lifetime + `perm_v` mismatch forces re-check | Delete the server-side row; reuse detection revokes the whole family |

Putting a **permissions version stamp** rather than the full matrix in the token
keeps it small and means a permission change takes effect within 15 minutes without
a revocation list.

### Non-negotiables for the new build

1. **Default-deny authorization**, enforced by a global guard, with a CI test that
   fails the build on any unlisted public route.
2. **Server-authoritative money.** Every total recomputed on save; client values
   advisory only.
3. **argon2id** password hashing, with a forced migration from the plaintext column.
4. **All secrets from the environment.** `gitleaks` in CI. History purged.
5. **Structured logging with correlation ids**, secrets redacted, retained and
   monitored.
6. **Least-privilege database role.** The application never connects as a superuser.
7. **Uploads stored outside the web root**, validated, served through a controlled,
   authorised endpoint.
8. **Rate limiting and account lockout** on authentication.
