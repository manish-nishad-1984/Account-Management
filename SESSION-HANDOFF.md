# Session handoff — AccountManagement → Node.js/React migration

**Written:** 1 September 2026 (supersedes the earlier handoff of the same name).
Read this first, then `README.md`, then `Migration-Assessment/01-Executive-Summary.md`
and `18-GO-NO-GO-Assessment.md`.

---

## 1. What this project is

`AccountManagement` ("Account Book", live at `avfast.in`, API at `api.avfast.in`) is a
multi-company, multi-site procurement and accounting system for an Indian
construction business — purchase requests → purchase orders → inward challans →
inventory → supplier/sales invoices → payments, plus reports.

**Current stack:** ASP.NET Core MVC (Razor) → ASP.NET Core Web API → repository
layer → EF Core 7 → SQL Server.
**Target stack:** React 19 + Vite + **Tailwind** → NestJS 11 (Fastify) → Drizzle →
PostgreSQL 17.

A full 18-document assessment already exists in `Migration-Assessment/`. It is
evidence-based — every finding cites a file and line. **Do not re-derive it.**

---

## 2. Decisions already made (do not relitigate)

| Decision | Note |
|---|---|
| Migrate to Node.js/React | Confirmed twice. The assessment's "stabilise first" advice was raised and overridden — proceed. |
| **Tailwind CSS, not Mantine** | User's explicit choice, overriding `16-Technology-Stack.md`. Date/number inputs and the line-item grid must be hand-built. |
| React Hook Form + Zod | Matches `11-UI-to-React-Mapping.md` §2. |
| Keyset (cursor) pagination, not offset | `.Skip()`/`.Take()` appear 0× in the existing code. |
| NestJS 11 (not 12) | `@nestjs/testing` defaults to 12 — pin it to `^11`. |
| TanStack Table **v8** | v9 has a breaking API. |
| `@node-rs/argon2`, not `argon2` | Prebuilt binaries; node-gyp is unreliable on Windows. |
| `main` is the trunk | There is no `master` branch. `origin` and `upstream` both use `main`. |

---

## 3. Where the code is

```
AC/
├── AccountManagement.sln          .NET — all 4 projects on net8.0
├── AccountManagement.Tests/       xUnit (12 tests)
├── AccountManegment.Repo/Domain/FinancialYear.cs
├── .github/workflows/ci.yml       build + test + gitleaks + node job
├── Migration-Assessment/          the 18-doc assessment + tools/ + db-extract/
└── node/                          npm workspaces
    ├── packages/domain/           shared business rules (12 tests)
    ├── packages/contracts/        Zod schemas shared by API and web
    └── apps/
        ├── api/                   NestJS + Fastify + Drizzle (95 tests)
        └── web/                   React 19 + Vite + Tailwind (37 tests)
```

**156 tests pass** (12 .NET + 12 domain + 95 API + 37 web).

### Verify everything

```bash
cd node && npm install && npm run build && npm run typecheck && npm test
cd .. && dotnet build AccountManagement.sln && dotnet test AccountManagement.sln
```

### Run it locally

```bash
cd node && npm run --workspace @accountmanagement/api build
cd apps/api && NODE_ENV=development PORT=3000 node dist/main.js
# separate terminal:
cd node/apps/web && npx vite --port 5180 --strictPort
```

Open **http://localhost:5180/**, sign in as **`devuser` / `DevPassword1`**.

With no `DATABASE_URL`, development starts an **embedded in-memory PostgreSQL**
(PGlite) and applies the real migration SQL, then seeds 41 users, 30 companies,
45 sites and 12 site groups. Data is lost on restart. Port 5173 is occupied by
another of the user's apps (ShreeHari Solar) — use 5180, and do not kill 5173.

**Stale dev servers are a recurring nuisance.** Check ports 3000 and 5180 before
starting; a previous session's process often still holds them and serves stale
code. `Get-NetTCPConnection -LocalPort 3000 -State Listen` finds the owner.

---

## 4. Repository state

Branch **`main`**. HEAD builds and all 156 tests pass.

- `b8d03922` completed the broken commit `6cefc164` (see §5).
- `f0f69f95` merged `newNode` into `main`, resolving 3 conflicts.
- **`main` is 10 commits ahead of `origin/main`. Nothing has been pushed.**
  `git push origin main` was blocked by the permission classifier; the user
  approved pushing, so it still needs doing — either a Bash permission rule for
  `git push`, or the user runs it.
- **The Companies / Sites / Site Groups work of §6 is UNCOMMITTED** in the working
  tree. Commit it before doing anything else.

`SESSION-HANDOFF.md` (this file) is untracked but no longer contains any
credential, so it is safe to commit if wanted.

---

## 5. What was built before this session

### .NET side (hygiene only — no feature work)
- All 4 projects retargeted to **net8.0**.
- Credentials removed from `AccountManegmentAPI/appsettings.json`; moved to
  user-secrets / env vars (`ConnectionStrings__ACCDbconn`, `Jwt__Key`).
  `Program.cs` fails fast with an actionable message if they are missing.
- `appsettings.Development.json` points the Web tier at `https://localhost:7251/api/`
  so development no longer hits production.
- `UseHttpsRedirection()` restored, with `UseForwardedHeaders`.
- The financial-year rule was duplicated at 4 sites; extracted to
  `AccountManegment.Repo/Domain/FinancialYear.cs`. **Behaviour deliberately
  unchanged, defect included.** The produced and corrected rules diverge on
  exactly 90 days across 2024-2026, all in April.

### Node API
- NestJS 11 + Fastify, Pino, Zod-validated env that refuses to boot in production
  without `DATABASE_URL` and an RS256 keypair.
- **Global default-deny `AuthGuard`** via `APP_GUARD`; opting out needs `@Public()`.
- **`PermissionsGuard`** — `@Permissions("user.view")` gives 403 when missing.
- Auth: argon2id, RS256 via `jose`, opaque rotating refresh tokens (only the
  SHA-256 is stored), transparent plaintext-to-hash migration on first login.
- Drizzle schema with **real foreign keys**, junction tables replacing the CSV
  `User.SiteId`/`CompanyId`, and a `lower(user_name)` unique index.
- `src/common/keyset.ts` — the pagination helper every list endpoint uses.

### Web
- React 19 + Vite + Tailwind v4 + Inter (self-hosted) + lucide-react.
- Sidebar built from the real 17-screen module tree in `src/navigation/nav.ts`.
  Unmigrated screens show a "soon" chip and route to `PlaceholderPage`.
- Token held **in memory only** — never `localStorage`. Refresh = signed out.

### The .gitignore trap (fixed, but know it happened)
Commit `6cefc164` shipped tests without their code and an app without its
packages. The cause was `.gitignore`, not carelessness: `/AccountManegment.Repo`
(and 3 sibling lines) ignored **entire .NET source projects**, and the NuGet rule
from the Visual Studio template also matched `node/packages/`. Both are now
narrowed to build output only. If a new file mysteriously does not appear in
`git status`, suspect `.gitignore` first and run `git check-ignore -v <path>`.

---

## 6. What this session built (UNCOMMITTED)

**Companies, Sites and Site Groups master screens**, end to end:
schema, migration, contracts, API module, web feature, nav.

- `apps/api/src/db/schema/users.ts` — `companies` and `sites` expanded from
  5-column stubs to the real source columns (20 and 22).
- `apps/api/src/db/schema/site-groups.ts` — **new**, three tables.
- `drizzle/0001_masters_expand.sql`, `drizzle/0002_companies_drop_is_active.sql`.
- `packages/contracts/src/{companies,sites,site-groups}.ts`.
- `apps/api/src/modules/{companies,sites,site-groups}/` — repository, controller,
  module and tests each.
- `apps/web/src/features/{companies,sites,site-groups}/` — page, api and tests each.
- `apps/web/src/lib/list-query.ts` — **shared** `useListResource` hook; the Users
  screen was refactored onto it too.

### GroupMaster was normalised — the biggest modelling decision here
The source table is one table doing three jobs. `SiteMasterRepo.cs:524-555` writes
the **cross product**: one row per (site x address) pair, repeating `GroupName` and
`GroupId` in each. 4 sites and 3 addresses is 12 rows, and `Id` (the actual primary
key) is meaningless, so the app addresses rows by `GroupId` — the assessment's
"dual key". Split into `site_groups`, `site_group_sites` and
`site_group_addresses`. The ETL collapses the cross product with a `DISTINCT` per
side; that is lossless in both directions.

**Related finding:** `PurchaseOrder.SiteGroup` and `SupplierInvoice.SiteGroup` are
`nvarchar` columns holding the group's **name**, matched by string equality. The
name is a de facto foreign key — renaming a group silently detaches its documents.
A case-insensitive unique index on the name now backs it.

### Deliberate choices — do not "fix" these without reading why
1. **No company column on the Sites screen.** There is no Company-to-Site
   relationship in the source schema at all. `sites.company_id` exists in Drizzle
   but was invented by an earlier session; nothing derives it from production data,
   so no screen displays it. Confirm with the business before trusting it.
2. **Bank account number and IFSC are not in the Companies list payload.** A grid
   any `company.view` holder can open must not ship every company's bank account.
   A test asserts they stay out.
3. **Site Groups is read-only and says so on the page.** `Group-View` is the *only*
   group permission in the entire .NET solution — no `Group-Add`, `Group-Edit` or
   `Group-Delete` attribute exists, so creating and deleting groups is
   unauthorised in the app today (finding C-6). The seed grants view only, so the
   grid shows no row actions and a banner explains why. Not a half-built screen.
4. **Sortable fields are `name` and `createdAt` only.** See 7.2 below.
5. **Geography stays `integer` with no FK.** Company has 3 orphan geography refs,
   Site has 6. A real FK would refuse rows the ETL must still carry.

---

## 7. Conventions — follow these

1. **Ported rules keep their defects until the business signs off.**
   `packages/domain` reproduces current production behaviour exactly, with tests
   that assert the wrong answer *on purpose* and say so. The matching .NET tests
   must agree case-for-case — that is what makes a port verifiable.
2. **Never fabricate data.** Unbuilt queues say "endpoint pending"; a relationship
   the source does not have does not get a column. A screen that looks populated
   but is not is worse than one that admits it.
3. **Money logic belongs in C#/TypeScript, never in the browser alone.** Today
   `Math.Round`, `CGST`, `SGST` and `IGST` appear 0x in C#.
4. **Every new list endpoint is keyset-paginated** and every new route gets an
   explicit `@Public()` or `@Permissions()`.
5. **Verify by running, not by asserting.** Unit tests here have passed while the
   app could not boot (`app.module.test.ts` exists because of exactly that). Boot
   it and curl it.
6. **Wrap header/detail writes in a transaction** — `BeginTransaction` is 0x in
   10,304 lines of the existing repository layer.
7. **A flaky test is a bug report, not noise.** Do not re-run until green.

### 7.1 Drizzle renders table columns UNQUALIFIED inside `sql` templates
`where ${siteGroupAddresses.groupId} = ${siteGroups.id}` compiles to
`where "group_id" = "id"`, and PostgreSQL binds that `"id"` to the subquery's own
table when it has one. The correlation silently becomes `group_id = id`, returns
nothing, and **raises no error**. Always qualify the OUTER reference as
`${siteGroups}.id`. This cost real debugging time; the note lives in
`site-groups.repository.ts`.

### 7.2 Keyset pagination requires a NOT NULL sort column
`col > cursorValue` is NULL for NULL rows, so they are excluded by the WHERE while
ORDER BY still lists them last: paging by a nullable column silently drops every
row without a value. Supporting one means coalescing identically in **both** the
ORDER BY and the WHERE, which `keyset.ts` does not do yet.

### 7.3 Migrations are applied from the journal, in order
`src/db/migrations.ts` reads `drizzle/meta/_journal.json`. The earlier code did
`readdirSync(dir).find(f => f.endsWith(".sql"))` and applied only migration 0000 —
indistinguishable from correct until a second migration existed. Use
`applyMigrations()` or the `src/test/fresh-database.ts` helper; never re-introduce
a directory scan.

### 7.4 `drizzle-kit generate` needs a TTY when a table has both adds and drops
It prompts to disambiguate rename-versus-create-plus-drop and dies with
"Interactive prompts require a TTY". Work around it by generating in two passes:
additive columns first, then the drop as its own migration.

### 7.5 Long heredocs through the Bash tool get truncated
Writing a large file with `cat > file <<EOF` fails with "unexpected EOF" once the
command grows past roughly 150 lines. Split it, or use the Write tool.

---

## 8. Blocked — needs the user, not code

| Blocker | Detail |
|---|---|
| **`Migration-Assessment/db-extract/` is empty** | The 3 read-only scripts in `Migration-Assessment/tools/` have never been run. Until then the orphan volume across ~62 unconstrained FK columns is unknown, and no schema can be *finalised*. About a day in SSMS. **This is the binding constraint.** |
| **10 business-rule questions unanswered** | `07-Business-Rule-Inventory.md`. 2-4 week lead time — the longest pole. The money calculator cannot start without them. |
| **Credentials not rotated** | The `sa` account on `srv1925876.hstgr.cloud` is still live, and its password is still in git history in earlier commits of `appsettings.json`. Removing it from the file did not remove it from history. `gitleaks` in CI will fail on the first push, correctly. **Rotation is the fix, not a history rewrite.** |
| **Which of 3 jQuery money calculators is correct** | Blocks all invoicing work (Phase 4, the risk centre). |
| **`git push origin main`** | The user approved it; the tool call was blocked by the permission classifier. 10 commits are still local. |

---

## 9. Known findings not yet in the assessment

- **Role-based permissions do not work and never have.** `User.RoleId` is `Guid?`
  while `UserRole.RoleId` and `RolewiseFormPermission.RoleId` are `int` — they
  cannot join, and neither table is referenced anywhere in the repository layer.
  Deliberately **not** ported. Worth confirming with the business.
- **Site groups have no write permission at all** (section 6, choice 3) — C-6.
- **Site group to document links are by name string** (section 6).
- `AccountManegments.Web/Models/Common.cs:28` and `:61` use obsolete
  `RijndaelManaged` for encryption.

---

## 10. Environment notes

- Windows 11, PowerShell + Git Bash. Use a real Windows path for temp files.
- **Docker is installed but the daemon is not running**, so there is no real
  PostgreSQL container. PGlite is used instead.
- **No browser automation driver.** The `browser-automation` skill needs
  `patchright`, which is not installed (it pulls a ~150MB Chromium), so **the
  rendered UI has never been looked at by anyone but the user.** All UI work is
  reasoned, not visually verified. If the user says something looks wrong,
  believe them.
- Node v24.15.0 locally; CI pins 22 LTS.
- `git clone` of this repo needs `-c core.longpaths=true` — some
  `AccountManegments.Web/wwwroot` paths exceed MAX_PATH.

---

## 11. Suggested next steps

1. **Commit the section 6 work**, then get `git push origin main` through.
2. **Rotate the SQL Server password.** It is live, it is in git history, and
   pushing to GitHub widens the exposure.
3. **Get the user to run the 3 census scripts** — everything data-shaped is
   blocked on them.
4. Then one of:
   - **More masters** — Suppliers and Items follow exactly the pattern of the
     three just built (`contracts/*.ts`, `api/modules/*`, `web/features/*`), and
     are unblocked; or
   - **Write endpoints** for the masters that actually have Add/Edit/Delete
     permissions (Company and Site do; Group does not); or
   - **The ETL** from SQL Server to PostgreSQL for `users` (will surface orphans); or
   - **.NET Phase 0 performance work** — pagination on the top 5 lists and the 6
     bulk-approve full-table loads. Visible to users next week, on the system they
     actually use today.
