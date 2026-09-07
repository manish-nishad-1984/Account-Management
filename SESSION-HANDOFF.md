# Session handoff — AccountManagement → Node.js/React migration

**Written:** 2 September 2026, after the unblocking session; extended 3 September
2026 with the deployment session (§5e). Supersedes all earlier handoffs of the
same name.
Read this first, then `README.md`, then `Migration-Assessment/01-Executive-Summary.md`
and `18-GO-NO-GO-Assessment.md`.

**The new app is live at https://avfast.in** with real master data — read §5e
before touching nginx or the server. The live ASP.NET app now answers on
**https://www.avfast.in**, and it is **broken for reasons that predate this
work** (§5e, "The live MVC app is down").

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
        ├── api/                   NestJS + Fastify + Drizzle (188 tests)
        └── web/                   React 19 + Vite + Tailwind (91 tests)
```

**310 tests pass** (19 .NET + 12 domain + 188 API + 91 web).

### Verify everything

```bash
cd node && npm install && npm run build && npm run typecheck && npm test
cd .. && dotnet build AccountManagement.sln && dotnet test AccountManagement.sln
```

### Run it locally

**Use the `/run-local` slash command** — `.claude/skills/run-local/SKILL.md`. It
frees the ports, builds, boots both, verifies they actually serve, and prints the
sign-in details. `/run-local stop`, `restart` and `status` also work. It is
project-scoped on purpose: a global `/run-local` typed in the user's OTHER project
would boot this app by mistake.

By hand, if you need to:

```bash
cd node && npm run --workspace @accountmanagement/api build
cd apps/api && NODE_ENV=development PORT=3000 node dist/main.js
# separate terminal:
cd node/apps/web && npx vite --port 5180 --strictPort
```

Open **http://localhost:5180/**, sign in as **`devuser` / `DevPassword1`**.

With no `DATABASE_URL`, development starts an **embedded in-memory PostgreSQL**
(PGlite) and applies the real migration SQL, then seeds 41 users, 30 companies,
45 sites, 12 site groups, 30 suppliers, 50 items and 12 units. Data is lost on
restart. Port 5173 is occupied by another of the user's apps (ShreeHari Solar) —
use 5180, and do not kill 5173.

**Stale dev servers are a recurring nuisance.** Check ports 3000 and 5180 before
starting; a previous session's process often still holds them and serves stale
code. `Get-NetTCPConnection -LocalPort 3000 -State Listen` finds the owner.

---

## 4. Repository state

Branch **`main`**. HEAD builds and all **310 tests pass**
(19 .NET + 12 domain + 188 API + 91 web).

- `b8d03922` completed the broken commit `6cefc164` (see §5).
- `f0f69f95` merged `newNode` into `main`, resolving 3 conflicts.
- `566b28ab` committed the Companies / Sites / Site Groups work of §6.
- `410e3198` deployed to the VPS and added `/deploy`. The §5c work went in with
  it, so it is no longer uncommitted.
- The domain move, the systemd PEM fix and the real-data import followed (§5e).
- **`main` is pushed to `origin/main`** and the working tree is clean.
- `gitleaks` in CI will fail on the push, correctly — see §8. The `sa`
  credential is in the HISTORY, not the working tree. Rotation is the fix.

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

## 5b. The CRUD session (committed)

Write endpoints and forms for every master, two new masters, and the permission
matrix. Node tests went 144 → 255.

- **Companies, Sites, Users** — full CRUD. The create/edit dialog fetches the
  full record because the list withholds bank details; `PATCH` is partial;
  delete is soft.
- **Suppliers, Items, Units** — new masters, end to end (schema, migration
  `0003`, contracts, API module, web feature, nav).
- **Permissions matrix** at `/permissions`, replacing
  `/User/UserwisePermission`. Roles are absent and the screen says why.
- Shared code: API `common/{base.repository,db-errors,actor}.ts`; web
  `lib/{crud,use-master-screen,format,form-values}.ts`,
  `components/ui/{Modal,FormDialog,ConfirmDialog,fields}.tsx`,
  `components/DataGrid/RowActions.tsx`, `test/render.tsx`.

### Decisions worth knowing
1. **Supplier edit and delete are guarded here, though the source guards
   neither.** `SupplierController.UpdateSupplierDetails` (line 108) and
   `DeleteSupplierDetails` (line 130) carry no `[FormPermissionAttribute]` at
   all — finding C-6 again, not a business rule. The convention that ported
   rules keep their defects covers BUSINESS rules; it does not extend to
   reproducing a missing authorization check. **This changes who can edit
   suppliers on day one — whoever does it today needs the Edit box ticked.**
2. **GST is stored, never computed.** `gstAmount` is entered and persisted as
   given. Deriving it would silently pick a winner among the three disagreeing
   jQuery calculators of finding B-2, in a master screen, months before the
   business decides. A test asserts the value is sent unchanged.
3. **Money is a decimal string end to end** — `numeric` in PostgreSQL, string
   through Drizzle, string on the wire, string in the input (never
   `type="number"`, which returns a float). Displayed with Indian digit
   grouping: 12,34,567.89, not 1,234,567.89.
4. **Deletes are refused, not cascaded.** A company with users, a site with
   users or group memberships, a unit with items: 409 naming the count. A soft
   delete fires no `on delete cascade`, so the assignments would otherwise
   survive pointing at a hidden row. Suppliers and items have NO such check yet,
   because the tables that would reference them are not migrated and a count
   against an empty table passes every time while looking like a guard. Both
   `remove` methods say so; add the checks with purchase orders.
5. **Units have no soft delete and no nav entry.** No `unit` permission exists
   anywhere in the .NET solution, so units are guarded by the ITEM rights and
   managed from a dialog on the Items screen. A unit in use is refused outright,
   which beats hiding a row that items still point at.
6. `AuthContext` is exported so `test/render.tsx` can supply a signed-in user.
   Screens gate UI on `usePermission`, which was untestable before — every such
   test silently asserted against a logged-out, read-only page.

### Two real bugs the tests caught
- **Editing a user was impossible without changing their password.** An
  untouched password input submits `""`, not `undefined`, so
  `passwordSchema.optional()` ran the 12-character policy against the empty
  string and failed on a field nobody touched. `optionalPassword` in
  `contracts/users.ts` normalises `""` to absent first.
- **A validation error on an array ELEMENT rendered nowhere.** `siteIds.0`
  failing the uuid check leaves `errors.siteIds.message` undefined, so Save did
  nothing with no message anywhere on screen. `unshownValidationMessage` in
  `lib/crud.ts` is the backstop, passed as `handleSubmit`'s onInvalid by every
  dialog.

### The API suite was not flaky — it was oversubscribed
Two or three arbitrary tests failed per run with assertion-shaped output, and
re-running appeared to fix it. The cause was memory: vitest sizes its pool from
the core count (16 here) and every worker holds its own PGlite, a whole
PostgreSQL compiled to WASM. Workers were OOM-killed — `Worker exited
unexpectedly`, `[vitest-worker]: Timeout calling "resolveId"`.
`apps/api/vitest.config.ts` now pins `pool: "forks"` with `maxForks: 4`. The
suite went green **and got faster**: 241s → 147s.

**The trap:** configuring `poolOptions.threads` does nothing. Vitest 2's default
pool is `forks`, so the threads settings are accepted and silently ignored, and
the only clue is `ChildProcess` in the stack of a pool that should be threads.
`pool` is now named explicitly so the config cannot miss again.

---

## 5c. The unblocking session (2 Sep 2026, UNCOMMITTED)

The user's three top blockers were all on them, not on code. This session did the
work that shrinks those blockers, then took the .NET reliability wins that no
blocker touches. **The user's standing instruction here was "I do not want orphan
entries" — treat that as a decision: the target keeps real foreign keys and the
ETL refuses orphans rather than carrying them.**

### The census is now one command
`Migration-Assessment/tools/run-db-extract.ps1` runs all three extraction scripts
via `sqlcmd` and writes `01-schema.txt`, `02-perf.txt`, `03-census.txt` into
`db-extract/`. This replaces the manual SSMS ritual (Results-to-Text, the
8192-character setting, Save Results As, three times over) that was costing about
a day.

- The password is passed through `SQLCMDPASSWORD`, never on the command line, and
  is cleared in a `finally`. It prompts if `$env:ACC_DB_PASSWORD` is unset.
- `-Only schema,perf,census` runs a subset. Run `perf` on its own at the END of a
  working day — its DMV counters reset when SQL Server restarts.
- It prints an **orphan summary** at the end, and **reports failed sections first,
  in red**. That matters more than it sounds: a section that errored reports no
  orphans because it never looked, and a partial census that reads as clean is the
  one genuinely dangerous outcome of the whole exercise.
- `03-census.txt` is written **pipe-delimited** so it parses; 01 and 02 keep the
  space-aligned layout because they carry DDL and query text.
- **Still not run.** It needs the rotated credential. Nothing about it has touched
  the live server.

### The business questions are now sendable
`Migration-Assessment/19-Business-Decisions-Required.md` — the 10 questions from
`07-Business-Rule-Inventory.md` plus the supplier-permission decision, rewritten in
plain English for a business reader: what was found, why it matters, the options
with consequences, a recommendation, and a decision box. No rule IDs in the
reader-facing text; there is a technical cross-reference table at the end.

Question 2 (Create Invoice may be dropping TDS and round-off) asks for a ten-minute
check against the live system, because it may be affecting data being created now.

Also published as a private, shareable page so it can actually be forwarded — a
markdown file in a git repo cannot be sent to a business owner:
<https://claude.ai/code/artifact/764e0b14-2c69-4e36-bbb2-614bb42e1ad7>
The markdown file is the source of record; if one changes, change both.

### .NET reliability fixes (finding P2 and P5)
**P2 — seven bulk-approve methods rewrote their entire table.** Not six; there are
seven, because `ItemInwardRepo.cs` and `ItemInWordRepo.cs` are near-identical
duplicate files that both carry the bug. Each loaded every row in the table and
called `Update()` on all of them — note the `Update()` sat *outside* the
`TryGetValue`, so approving one purchase order issued an UPDATE against every row,
every column, clobbering any concurrent edit. All seven now load only the requested
ids.

**P5 — two dead `query.FirstOrDefault().GetType()` calls** removed
(`SupplierInvoiceRepo.cs`, `SalesRepo.cs`). They were never read, cost a round-trip
per sorted report, and threw `NullReferenceException` when the report matched no
rows — so this was a latent crash, not just waste.

`AccountManagement.Tests/BulkApprovalTests.cs` (7 new tests, .NET 12 → 19).
`Microsoft.EntityFrameworkCore.InMemory` 7.0.17 was added to the test project.

> **The one thing to understand about these tests.** Asserting on the final
> `IsApproved` values passes against the OLD code too — the old code did reach the
> right values, it just rewrote the whole table to get there. So the assertions are
> on **how many rows were loaded and tracked**
> (`ctx.ChangeTracker.Entries<T>().Count()`). This was verified by temporarily
> reintroducing the full-table load: the three row-count tests failed and the two
> value tests still passed. A value-only test here would be false confidence.

### A real bug in the web money formatter
`formatPercent` used `value.replace(/\.?0+$/, "")`, which strips trailing zeros off
whole numbers too: `"10"` rendered as **`1%`** and `"100"` as `1%`. It stayed
invisible because the API serialises `numeric` as `"18.00"`, so the regex matches
the `".00"` instead — the bug only appears the day a value arrives without a
decimal point. Fixed to guard on the decimal point being present.

This is **new code, not a ported rule**, so the "ported rules keep their defects"
convention did not apply.

`apps/web/src/lib/format.test.ts` is new — 14 tests, the first tests in
`src/lib/` at all. Before this, every money and tax value the user sees was
rendered by an untested function, and because no seeded amount reaches 100,000 the
**lakh-grouping branch had never executed once**, in a test or a browser. Web 77 → 91.

---

## 5d. The UI has now been looked at

§10 used to say nobody had ever seen the app render. That is no longer true.
`patchright` is installed and the browser-automation skill works.

**Nothing was broken.** Login, all seven master screens, the sidebar and a CRUD
dialog were driven in a real headless Chromium: 0 console errors, 25 rows on every
list, correct headers, working row actions.

Every deliberate decision in §5b and §6 was confirmed to hold in the rendered DOM:
no bank account or IFSC in the Companies grid, no Company column on Sites, Site
Groups read-only with its banner and no row actions, and the user edit dialog saves
with the password untouched (the §5b regression, verified live).

Three things worth knowing for the next person who does this:

1. **`page.goto` signs you out.** The token is in memory only by design, so every
   full navigation returns the login page. Navigate by clicking nav links, not by
   `goto`, or you will "discover" that all seven screens render a login form.
2. **`ERR_ABORTED` on every list request is correct, not a bug.** React
   `StrictMode` double-mounts in dev and `list-query.ts` forwards TanStack Query's
   abort signal to `fetch`, so the first request is cancelled and the second
   succeeds. The aborts are evidence the cancellation works. Dev-only.
3. **The default headless viewport is 764×429**, below the sidebar's breakpoint, so
   the nav sits off-canvas at `x: -244` and clicks time out with "element is
   outside of the viewport". Call `page.setViewportSize({width: 1440, height: 900})`
   first. The responsive drawer itself is fine — there is a properly aria-labelled
   "Open navigation" button.

Run scripts live in the scratchpad, not the repo. `patchright` had to be installed
into a directory the runner could resolve it from; it is NOT in the repo.

---

## 5e. The deployment session (3 Sep 2026) — it is live on the domain

**https://avfast.in now serves the new React app, with real master data.**
Use `/deploy`; the skill at `.claude/skills/deploy/SKILL.md` carries the full
procedure and every trap below.

### The hostname split

| Hostname | Goes to |
|---|---|
| `avfast.in` | **the new React app** — static build + `/api/` → `127.0.0.1:3101` |
| `www.avfast.in` | the live ASP.NET MVC app → `127.0.0.1:8080`. `default_server`. |
| `api.avfast.in` | the live ASP.NET API → `127.0.0.1:7251`, untouched |

The user chose to replace the root (asked, answered "Replace avfast.in itself"),
knowing the new app is **masters only**. The live system was moved to `www`
rather than left unreachable, because that hostname was **already in DNS and
already on the certificate** — nothing to add, nothing to re-issue.

There is **no wildcard DNS** and no DNS tool on the MCP connection: a brand new
hostname needs the user to add an A record in hPanel by hand.

Port **8090** still serves the same app on its own vhost, for checking a release
without going through the domain.

### The live MVC app is down, and it is not our doing

Every Razor view throws `System.BadImageFormatException: Could not load file or
assembly '<Unknown>'. Index not found.`, so every page 302-loops to
`/Authentication/UserLogin?ReturnUrl=%2FHome%2FError`. Static files still serve.

- failing since **28 Aug 2026 14:28**, five days before this session
- reproduces against `127.0.0.1:8080` **directly**, with the original
  `Host: avfast.in` — so it is not nginx and not the hostname move
- `AllowedHosts` is `*`, so it is not host filtering
- **70 files** in `/opt/avfast/web` have mtime **26 Aug 14:51**; the process
  started **26 Aug 12:47**. A deployment replaced the assemblies underneath the
  running process.

`systemctl restart avfast-web` is very likely the whole fix. It is the user's
production service — **ask first.**

### A PEM cannot travel in a systemd environment variable

This was the session's real bug, and it took two wrong fixes to find. Login
returned **500 while a wrong password still correctly returned 401** — the
credential path was fine, token *signing* was not.

- `EnvironmentFile` reads **one line per variable**, so a real multi-line PEM
  arrives as just `-----BEGIN PRIVATE KEY-----` → jose:
  `asn1 encoding routines::not enough data`
- escaping the newlines does **not** help: in an unquoted value systemd treats a
  backslash as an escape and **removes** it, so the process gets
  `-----BEGIN PRIVATE KEY-----nMIIEv…` with no line breaks → jose:
  `asn1 encoding routines::too long`

Neither fails at boot. The fix is `JWT_PRIVATE_KEY_FILE` / `JWT_PUBLIC_KEY_FILE`
holding **paths**, which also keeps the signing key out of `/proc/<pid>/environ`.
`env.ts` still decodes escaped newlines for containers and CI, and now **refuses
to boot** on either broken shape, naming the variable and the cause. 19 tests in
`apps/api/src/config/env.test.ts` — the first tests that file has ever had.

`/proc/<pid>/environ` is what settled it. When an env var "looks right" in the
file but the app disagrees, read what the *process* actually got.

### Real data is in, and one figure is worth knowing

82 units, 3 companies, 13 sites, 171 suppliers, 758 items, 35 site groups,
3 users, 21 forms, 63 permissions. Passwords are **never** copied — every
imported user has `DevPassword1`. Users: `ckalathiya`, `ac`, `chintanauro`.

The dry run confirmed the earlier census: **0 real referential corruption**, 111
orphans all debris from soft-deleted users, 9 suppliers refused for duplicate GST
numbers (one GST literally `"00"`), 4 site groups carrying trailing CRLF.

### Other traps, briefly

- **`npm test` before every ship**, and a healthy `/health` is not enough — it
  never touches the signing key. Always also check a real login.
- Workspace `file:` deps must be **real copies** on the server, not symlinks:
  Node resolves a symlinked package from its real path and never sees
  `api/node_modules`, so `zod` goes missing from inside `contracts/dist`.
- `/opt/accountbook-next` must be **755**; at 700 `www-data` cannot traverse it
  and every page is a 500.
- `tar` on this machine reads `C:/…` as a remote host — use `--force-local`.
- `HOST=127.0.0.1` in the release env, or the API is reachable directly on 3101
  and nginx is decoration.

---

---

## 5f. Purchase Requests — the first transaction module (7 Sep 2026)

Phase 3 of the roadmap. Chosen deliberately as the first transaction wave
because it carries **no money arithmetic**, so the team builds the transactional
UI patterns before the GST question (B-2) has to be answered.

Live at **https://avfast.in/purchase-requests** with the 3 real requests from
production. Test count **337 Node + 19 .NET = 356**.

### The document-numbering defect, confirmed in the data

`PurchaseRequestRepo.CheckPRNo()` parses the sequence with
`int.Parse(LastPr.PrNo.Substring(11))`. `"PR/25-26/001"` is twelve characters, so
index 11 is the **last character only**. From `"009"` it reads `"9"` and
correctly produces `"010"`; from `"010"` it reads `"0"` and produces `"001"`
again.

This is not theoretical. `PurchaseRequest` holds **28 rows carrying 12 distinct
numbers**: the sequence runs 001-010, restarts at 001, runs to 010 again,
restarts once more and reaches 006. Ten numbers have been issued to more than one
document. Only three rows are live and those three happen not to collide, so the
import is clean — but the defect has been firing since the 24-25 financial year.

It is also racy: read-then-write with no lock and no unique index.

**Replaced by `document_counters`**, one row per (document type, financial year),
incremented with `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` inside the same
transaction as the insert. The FORMAT is unchanged — those strings are on paper.
The importer seeds `next_value` from the highest number already issued per year,
so the new system cannot reissue an old number (25-26 resumes at 009, 24-25 at
011).

### Two deliberate departures from the source, both flagged for sign-off

1. **The list LEFT JOINs items.** The source INNER JOINs `ItemMaster`, so a
   request raised with free text and no `ItemId` sits in the table and is
   invisible in the application. Here it lists, labelled by its free text. The
   foreign key means `item_id` is either a real item or NULL, so nothing is
   invented.
2. **No `sites.is_active` filter.** The source adds `c.IsActive == true`, so
   deactivating a site erases its request history from the list rather than
   hiding the site.

Both are correctness fixes rather than rule changes, but both change what a user
sees, so they are recorded here rather than buried.

### Also fixed on the way

- **Approval states the value instead of toggling it.** `PurchaseRequestIsApproved`
  reads the row and writes the opposite, so two approvers racing land wherever
  ordering puts them, and the API cannot express "approve this" at all.
- **`prNo` cannot be reassigned.** `UpdatePurchaseRequestDetails` reassigns
  `PrNo` from the posted body, so a client could renumber one request over
  another. It is absent from the update contract by construction.
- **`updated_by` / `updated_at` are stamped.** The source leaves them null on
  every update path.
- **Bulk approval is ONE statement** — `UPDATE ... WHERE id = ANY(...)` — and
  reports how many rows actually changed.

### `nav.ts` had the wrong permission subject on six screens

The subject is derived from `Form.FormName`, and the real rows are
`"Purchase Request"`, `"Purchase Order"`, `"Inward Challan"`, `"Inventory
Inward"`, `"Purchase  Invoice"` (two spaces), `"Sales Invoice"`, `"Sales
Report"`, `"Details Report"`. `nav.ts` carried `purchaserequest`,
`purchaseorder`, `iteminword`, `inventory`, `invoice`, `sales`, `report` — none
of which any migrated `Form` row grants. They were inert while those screens were
placeholders; the first one to go live would have 403'd on every call. All
corrected against the production `forms` table.

**When adding a screen, read the subject off `forms`, do not guess it.**

### `migrate.mjs` was silently skipping migrations

It replayed the journal from the beginning on every run, hit "relation already
exists" on migration 0000, and stopped — printing *"Already migrated. Nothing to
do."* while every migration added since the last deploy was skipped. The deploy
looked clean and the new tables were simply absent.

It now records applied tags in `applied_migrations`, one transaction per
migration. On the FIRST run against a database that predates the tracking table
it adopts what is already there, matching by SQLSTATE rather than message text —
an already-applied migration fails differently depending on what it did
(`42P07` duplicate table, `42703` undefined column for a DROP, `42701` duplicate
column). After that first run any such error is a real failure and is not
swallowed.

### `npm run dev` is broken for the API, and it is not new

`tsx` compiles with esbuild, which **does not implement `emitDecoratorMetadata`**.
Any Nest constructor parameter typed by class rather than by an `@Inject` token
resolves to `undefined`. `DevSeed` fails first, and behind it `AuthGuard`
(`Reflector`, `TokenService`) and every controller that injects its repository by
type — so `/api/v1/health` returns 500 with `this.reflector` undefined.

`npm run build && node dist/main.js` works, because tsc does emit the metadata,
and that is what `/run-local` and the deploy both do. **Fixing this properly means
adding `@Inject` tokens across every controller and guard — a separate job.** It
was left alone rather than half-fixed.


---

## 5g. The legacy screens are now documented (7 Sep 2026)

`Migration-Assessment/legacy-screens/` holds a written spec per screen of the
ASP.NET app, taken from screenshots of `avinfraones.co.in`. **Read
`00-shell-and-navigation.md` and `PLAN.md` before building another screen.**

Four gaps in ALREADY-SHIPPED work came out of it, all verified against our code:

1. **No global site selector.** Every legacy screen carries `All Site` in the
   header and scopes everything below it. Our `AppShell` has nothing; Purchase
   Requests grew its own per-screen dropdown that nothing else honours. Build
   this BEFORE the next module, not after.
2. **Master-detail split vs modal.** Legacy lists fill a right-hand pane on row
   click; we open a blocking modal. A real change in how the screen is worked —
   decide it now, while it is one change to `useMasterScreen`.
3. **Item Master has no Excel import/export and no price history.** The clock
   icon in the legacy Action column has no schema behind it here at all.
4. **`companies.landmark` is missing**, and geography renders as ids because the
   census has never run.

Two things the captures add to Phase 4 planning: `document_counters` will need a
**company dimension** (POs are numbered `DHP/PO/24-25/049` — the invoice prefix
leads, and a free-text suffix is appended), and the PO editor needs a **rich text
editor** for three stored Terms and Conditions templates, an unbudgeted
dependency whose stored HTML also needs sanitising.

The captures confirm the phase ordering in the roadmap: the purchase invoice line
grid carries PRICE, DIS in both rupees and percent, GST in both, and totals TDS,
Discount and Adjustment. It is the superset. Build `LineItemGrid` against it.

---

## 6. The Companies / Sites / Site Groups session (committed as `566b28ab`)

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
There is **no Python** on this machine, so no `python - <<PY` either.

**A doubled backslash also collapses**, even inside a quoted `<<'EOF'`. Writing
`.replace(/\\n/g, "\n")` lands in the file as `.replace(/\n/g, "\n")` — which
still compiles, still passes review, and is a silent no-op. This cost real time
in the deployment session (§5e): the code meant to decode escaped newlines in a
PEM did nothing at all, and only a `/proc/<pid>/environ` dump showed it.

Where a literal backslash matters, build it from a char code —
`const BACKSLASH = String.fromCharCode(92)` — and use `split`/`join` instead of
a regex, so no ambiguous escape exists in the source. `apps/api/src/config/env.ts`
does exactly this and says why. Or just use the Write/Edit tools, which do not
pass through a shell.

### 7.6 Drizzle wraps every driver error, so read `cause` before `code`
A failed query arrives as a `DrizzleQueryError` — "Failed query: insert into …" —
with the real PostgreSQL error hanging off `.cause`. Reading `error.code` from
the top level finds nothing, so a unique-violation handler falls through and
every constraint violation becomes a 500. `common/db-errors.ts` walks the cause
chain. The constraint NAME also moves: postgres.js calls it `constraint_name`,
PGlite calls it `constraint`, so reading only one gives helpful messages in
exactly the environment that does not need them.

### 7.7 A Zod schema has TWO types, and forms need both
`z.input` is what the form holds — strings, including `""`. `z.output` is what
the API receives — nulls where a field was blank. Type the form as
`useForm<z.input<S>, unknown, z.output<S>>` and `handleSubmit` hands over the
transformed value with no casts anywhere. Getting this wrong shows up as a wall
of `as unknown as` and, eventually, `null` reaching an input and React quietly
switching it to uncontrolled.

Two specific traps, both of which shipped bugs before being caught:
- `passwordSchema.optional()` does NOT make a password optional on a form. An
  untouched input submits `""`, not `undefined`, so the policy runs against the
  empty string and the save is refused on a field nobody touched. Normalise
  `""` to `undefined` first.
- A validation error on an array ELEMENT (`siteIds.0`) renders NOWHERE, because
  the field only reads `errors.siteIds.message`. The form silently refuses to
  submit. `unshownValidationMessage` in `web/src/lib/crud.ts` is the backstop;
  pass it as `handleSubmit`'s second argument on every new form.

### 7.8 Cap the vitest pool — PGlite is a whole database per worker
See §5b. `pool: "forks"` with `maxForks: 4` in `apps/api/vitest.config.ts`.
Raising it brings back OOM-killed workers that look exactly like flaky tests.
Configuring `poolOptions.threads` does nothing, because the default pool is
forks — the setting is accepted and ignored.

### 7.9 Mock `fetch` per route, not with one `mockResolvedValue`
A `Response` body can be read only once. Screens that make two requests — a list
plus a lookup for a dropdown — get the same Response twice, the second read
throws, and the grid shows a generic "could not load" that points nowhere near
the cause. `web/src/test/render.tsx` has `routeFetch`, plus `renderWithAuth` for
the screens whose UI is gated on `usePermission`.

---

## 8. Blocked — needs the user, not code

| Blocker | Detail |
|---|---|
| **`Migration-Assessment/db-extract/` is empty** | The 3 read-only scripts have never been run. Until then the orphan volume across ~62 unconstrained FK columns is unknown, and no schema can be *finalised*. **This is the binding constraint.** No longer a day in SSMS — it is now one command, `tools/run-db-extract.ps1` (§5c). It still needs the rotated credential. |
| **10 business-rule questions unanswered** | 2-4 week lead time — the longest pole. The money calculator cannot start without them. They are now written to be sent: `Migration-Assessment/19-Business-Decisions-Required.md` (§5c). **The clock does not start until someone sends it.** |
| **Credentials not rotated** | The `sa` account on `srv1925876.hstgr.cloud` is still live, and its password is still in git history in earlier commits of `appsettings.json`. Removing it from the file did not remove it from history. `gitleaks` in CI will fail on the first push, correctly. **Rotation is the fix, not a history rewrite.** |
| **Which of 3 jQuery money calculators is correct** | Blocks all invoicing work (Phase 4, the risk centre). The Items screen stores the GST amount as entered rather than deriving it, precisely so this stays an open question rather than being answered by implication. |
| **Supplier edit/delete permission change** | The port guards `supplier.edit` and `supplier.delete`; the source guards neither (§5b decision 1). Whoever edits suppliers today needs those boxes ticked before cutover, or they lose the ability. Needs a decision, not code. |

---

## 9. Known findings not yet in the assessment

- **Role-based permissions do not work and never have.** `User.RoleId` is `Guid?`
  while `UserRole.RoleId` and `RolewiseFormPermission.RoleId` are `int` — they
  cannot join, and neither table is referenced anywhere in the repository layer.
  Deliberately **not** ported. Worth confirming with the business.
- **Site groups have no write permission at all** (section 6, choice 3) — C-6.
- **Supplier update and delete have no permission attribute at all** —
  `SupplierController.cs:108` and `:130`, plus `ActiveDeactiveSupplier` at `:150`.
  Anyone who can reach the site can edit or delete any supplier. C-6 again, and
  the port closes it (§5b decision 1).
- **Site group to document links are by name string** (section 6).
- `AccountManegments.Web/Models/Common.cs:28` and `:61` use obsolete
  `RijndaelManaged` for encryption.
- `ItemMasterController.cs` and `SupplierController.cs` use `OleDb` for their
  Excel import, which is Windows-only — the build emits CA1416 for it on every
  compile. It will not run on a Linux container, which matters whenever the .NET
  side is containerised.

---

## 10. Environment notes

- Windows 11, PowerShell + Git Bash. Use a real Windows path for temp files.
- **Docker is installed but the daemon is not running**, so there is no real
  PostgreSQL container. PGlite is used instead.
- **Browser automation works now.** `patchright` + Chromium are installed. The
  skill's runner resolves `patchright` from the **working directory**, not from a
  global install, so run it from a directory that has it (the scratchpad — it is
  deliberately not in the repo). See §5d for what was found and three traps.
  The user is still the better judge of whether a screen looks *right*; the
  driver only proves it renders.
- Node v24.15.0 locally; CI pins 22 LTS.
- `git clone` of this repo needs `-c core.longpaths=true` — some
  `AccountManegments.Web/wwwroot` paths exceed MAX_PATH.

---

## 11. Suggested next steps

The masters are done and deployed (§5e). Everything below is either blocked on
the business or is the next tranche of build. **The first items are still on the
user — but most are now cheap, which was the point of §5c.**

**Server housekeeping, from the deployment session — do these first:**

0a. **Close port 1433.** SQL Server listens on `0.0.0.0:1433`, reachable from the
    whole internet, while its siblings 1431 and 1434 are correctly on loopback.
    `ufw` is inactive. Check nothing external depends on it, then
    `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw allow 8090 && ufw deny 1433 && ufw enable`.
    **More urgent than anything else in this list.**

0b. **Rotate the VPS root password.** It was pasted into a session transcript.
    The deploy key in `~/.ssh/authorized_keys` means the password is no longer
    needed for any of this. There is also an inert Hostinger public key
    `accountbook-deploy` (id `571616`) that can be deleted — attaching a key
    only takes effect on VM *recreate*, so it never did anything.

0c. **Decide about `avfast-web`.** It has been throwing on every page since
    28 Aug (§5e). A restart is very likely the whole fix, but it is production.

1. **Rotate the SQL Server password.** Still the top item, and now the one that
   gates step 2 as well. It is live, it is in git history, and the repository has
   been pushed to GitHub — the exposure is wider than it was. Rotation is the fix;
   removing it from the working tree already happened and did not help.
2. **Run the census.** `cd Migration-Assessment\tools; .\run-db-extract.ps1` —
   one command now, not a day in SSMS (§5c). Everything data-shaped is blocked on
   it: the orphan volume across ~62 unconstrained FK columns is still unknown, so
   no schema can be finalised and the ETL cannot be written. **This is the binding
   constraint**, and the user has since said they do not want orphan entries at
   all, which makes the count the thing that sizes the remediation.
3. **Send `19-Business-Decisions-Required.md` to the business.** It is written and
   ready. 2-4 week lead time, and the money calculator — the risk centre of the
   whole migration — cannot start without the answers. **Question 2 in it wants a
   ten-minute check first**, because it may be affecting invoices being created
   right now.
4. **Confirm the supplier permission change** (§5b decision 1). It is question 11
   in that same document.

Then, in rough order of value:

- **The ETL for `users`, `companies`, `sites`** — the first real data movement,
  and the thing that will surface the orphans the census counts. Do it after
  step 2, not before. "No orphan entries" means deciding, per relationship,
  whether an orphan is cleaned, quarantined or rejected — that decision needs the
  counts in front of you.
- **Purchase requests and purchase orders** — the next module, and the first
  with header/detail writes. Two conventions become load-bearing there:
  everything in a transaction (§7.6), and the in-use delete checks that
  suppliers and items are currently missing (§5b decision 4) can finally be
  written against real tables. Deliberately NOT started this session: the census
  is what says whether `PurchaseOrderDetails.PORefId` can carry a real FK.
- **More .NET Phase 0 performance work.** P2 and P5 are done (§5c). The remaining
  ranked items are P4 (`AsNoTracking`), P6 (`.ToList().Count` existence tests),
  P3 (six N+1 loops) and P1 (pagination). **Do P1 after the DMV data arrives** —
  "the top five list endpoints" is exactly what script 02 identifies, and guessing
  which five is how a week goes into the wrong ones.
  On P4: the assessment bills it as "one global setting, ~1 hour". Treat that with
  care. There are 61 explicit `.Update(` calls against 35 `SaveChangesAsync`, which
  suggests writes do not lean on change tracking — but a single read-modify-save
  path that omits `.Update()` would start failing silently, and 19 tests is not a
  net for that. Check all 35 save paths first; call it half a day.
