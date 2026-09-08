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

## 5h. The site scope is now in the shell (7 Sep 2026)

Gap 1 of section 5g is closed. The site is chosen ONCE, in the header, and every
site-scoped screen follows it — as `drpSiteName` does in `Main_Layout.cshtml`.

- `contexts/SiteScopeContext.tsx` — the provider, mounted in `App.tsx` below
  `RequireAuth` and keyed by user id.
- `components/SiteScopePicker.tsx` — the header control.
- `GET /api/v1/sites/assignable` — `SitesRepository.scopeFor()`.

**The rule, taken from the source and reproduced deliberately.** A user with rows
in `user_sites` picks among those and is offered no "All sites"; a user with none
sees every active site and defaults to all of them. That is `UserSession.SiteData`
versus the `GetSiteNameList` fallback. It is PRESENTATION, not authorisation, and
it was not authorisation in the source either — the .NET endpoints never checked
the session's site against the row being read or written. Narrowing a dropdown
does not stop a request for another site's data. Real per-site authorisation is a
separate decision; it belongs with finding C-6.

### The new endpoint carries no `@Permissions`, on purpose

`GET /sites` requires `site.view` — the right that guards the Site MASTER screen.
The purchase-request form was reading that endpoint to fill its site dropdown, so
**a clerk who may raise requests but not administer sites got a 403 and an empty
dropdown they could not save past.** `/sites/assignable` needs no right, returns
two columns, and is scoped to the sites that user actually works on. `useAllSites`
is gone; both the form and the filter read the scope.

### Four defects in the source version, not reproduced

1. `<option value="@site.SiteId" isSelected>` is missing the `@`, so `isSelected`
   is emitted as a literal attribute on every option and the computed selection
   is never applied. The header and the server session can disagree about which
   site is in scope, silently.
2. Changing site calls `/Home/PurchaseRequestList` for its session side effect,
   writes the returned partial into `#tbPndingApproval`, then `location.reload()`s
   — discarding the HTML it just fetched and reloading the page it just updated.
3. The choice lives in `sessionStorage`, so it dies with the tab. Ours is
   `localStorage`, keyed per user because a site office shares a keyboard. A site
   id is a display preference, not a credential — which is why this persists when
   `AuthContext` deliberately persists nothing.
4. An unassigned user's dropdown is populated asynchronously with no placeholder.

### A stored site that is no longer on offer is discarded

Somebody removed from a site would otherwise keep filtering by it and see an
empty application, with every screen agreeing — which looks like the data is gone
rather than the filter is wrong.

### A scoped list must not fetch before the scope resolves

`useListResource` now takes `{ enabled }`. An assigned user's default is their
FIRST SITE, not everything, so a request sent early returns another site's rows
and is then replaced — which reads as a bug in the data rather than a loading
state. `PurchaseRequestsPage` also overrides `isLoading` for the same window, or
the grid announces "no purchase requests" for a site it has not asked about yet.
`usePurchaseRequestList` is the worked example; each scoped module copies it.

### An assigned site that was deactivated is still offered

`GetSiteNameList` filters on `IsActive` and `UserSession.SiteData` does not. The
asymmetry is kept: dropping a deactivated site the user is assigned to would hide
their own documents from the only person responsible for them. Soft-deleted sites
are dropped either way.

### Fastify prefers the static route, whatever the declaration order

`sites/assignable` and `sites/:id` are siblings in the radix tree — verified with
`printRoutes()`. `users/options` and `purchase-requests/approvals` already rely on
this. Declaration order is a readability choice here, not a correctness one.

Tests: 361 Node (12 domain + 221 API + 128 web) + 19 .NET. Up 24.

---

## 5i. Inventory Inward, and a paging bug it uncovered (7 Sep 2026)

The second transaction module, and the first built against the site scope from
the start. `/Sales/CreateInventory` in the source — five methods buried in
`SalesRepo.cs`, sharing nothing with sales invoices but the file.

Schema, migration `0005`, contract, API module, web feature, dev seed, importer.

### The paging bug — it was live in NINE list endpoints

Sorting any list by `createdAt` and asking for the SECOND page threw
`value.toISOString is not a function`. A cursor is produced as
`${sortColumn}::text`, so it comes back a string, and `gt(timestampColumn, "…")`
handed that string to Drizzle's timestamp mapper.

Every repository offers `createdAt` as a sortable field. None had ever paged past
page one in a test, and page one always worked — so nothing looked wrong. Found
only because inventory inward makes `createdAt` its DEFAULT sort.

`keysetWhere` now casts the cursor in SQL — `cast(${value} as ${getSQLType()})`
— so the value never passes through the column mapper. The regression test lives
in `sites.repository.test.ts`, not in the inventory tests, because the bug was
never inventory's. **Verified by reverting the fix: both new tests fail, then
pass.**

### `InventoryInward.SiteId` exists and is ALWAYS NULL

Nothing in the .NET application writes it. `InsertInventoryDetails` builds the
entity without it, `UpdateInventoryDetails` does not touch it, and the create
form has six fields, none of them a site.

So a site-scoped list CANNOT be `where site_id = :siteId` — that shows an empty
screen to every user under every scope. The filter is **this site OR no site**,
and the list response carries `unallocated`, a count of live rows with no site,
so the screen can say why rows from nowhere are appearing under a chosen site.
Both go away when the history is backfilled. New rows do carry the scoped site.

The importer reports the same number, so the two can be compared: if it is not
equal to the row count, something does write `SiteId` and this reading is wrong.

### Three more defects in the source, all departed from

1. **`IsApproved = true` is hard-coded on insert.** Every arrival in production
   posted already approved, so the Approve column has never gated anything and
   the pending state has never been seen on this screen. New rows here are
   created unapproved. **Flagged for sign-off** — pre-approved arrivals may be
   what the business wants, but that is a decision to state, not a constant
   inside an insert.
2. **The delete is a HARD delete.** `DeleteInventoryDetails` sets
   `IsDeleted = true` and then calls `Context.InventoryInwards.Remove(...)` on
   the same entity, so the row leaves the table and the flag write goes nowhere.
   The list filters on the flag as though it were a soft delete, which is why
   nobody has noticed that deleting an arrival is unrecoverable. Ours is a real
   soft delete and the confirm dialog says so.
3. **The list and the edit form read different item names.** `GetInventoryList`
   projects `i.ItemName` from the master; `EditInventoryDetails` projects
   `a.Item`, the snapshot taken when the row was keyed. Rename an item and the
   two screens disagree. Here both read the master. The snapshot column is kept
   and written, because the source has one and dropping it would silently pick a
   winner — but nothing reads it.

### Approval is stated, not toggled

`ApproveInventoryDetails` reads the row and writes the opposite, so the API
cannot express "approve this" at all. Same fix as purchase requests, same reason.

Tests: 405 Node (12 domain + 249 API + 144 web) + 19 .NET, up 44.

---

## 5j. Inward Challans — Phase 3 complete, except file upload (7 Sep 2026)

`/ItemInWord/ItemInWord`. Schema `inward_challans` + `inward_challan_documents`,
migration `0006`, contract, API module, screen, seed, importer.

**THE ONE THING NOT DONE IS THE UPLOAD.** Attachments are modelled, imported,
listed and counted; adding a NEW file is not possible yet. It needs three things
that are not a code decision: somewhere to put the bytes (assessment 12 says
object storage; the alternative is the VPS disk, which is what happens today), a
multipart dependency the API does not carry, and a deploy change for the
body-size limit and a writable path. The form says so rather than showing a
disabled control.

### There are TWO repositories for this table, and they disagree

`ItemInwardRepository/ItemInwardRepo.cs` (447 lines) is the one registered in
`Program.cs`. `ItemInWordRepository/ItemInWordRepo.cs` (450 lines) is a
near-identical copy that nothing resolves — **dead code**. Anyone reading the
dead one to understand production is reading the wrong file, and the two behave
differently.

### The live create path silently discards the supplier and the invoice number

`AddItemInWordDetails`, in the registered repository, builds the entity without
`SupplierId` and without `InvoiceNo` — both of which the list it feeds displays.
`InsertMultipleItemInWordDetails`, in the SAME FILE, sets both.

The single-row update has the same split: `UpdateItemInWordDetails` omits
`SiteId`, `SupplierId` and `InvoiceNo` entirely; `UpdatetMultipleItemInWordDetails`
writes them. So the table has two create paths and two update paths, one of each
lossy, and which a challan gets depends on which endpoint the screen called.

One path here, and it writes every field it is given. The list renders a missing
supplier as "Not recorded" rather than blank, because that population is real.

### Three more, all departed from

- **`Date = DateTime.Now` on create** in `AddItemInWordDetails`, discarding the
  date the user typed — a challan keyed a week late is dated today.
- **`VehicleNumber.ToUpper()`** throws a NullReferenceException when the field is
  blank, and the column is nullable and the form does not require it. The
  upper-casing is kept; it is applied only when there is a value.
- **`DocumentName` is stored twice** — a semicolon-joined string on the parent
  AND one row per file in `ItemInWordDocument` — reconciled by hand with
  `.Split(';')`, which NREs whenever the parent column is null (it is null on the
  captured row). One representation here; the ETL explodes the parent string to
  fill any gap the child table has, and reports how many it found that way.

### The footer aggregate

The legacy grid totals its Quantity column in a purple footer row — the only
aggregate in the system. The source computes it correctly, over the filtered set,
and then returns it by writing `TotalRows` and `TotalQuantity` onto **`list[0]`**:
the totals ride on the first row and **vanish when the list is empty**, which is
exactly when a `0.00` would tell the user their filter worked rather than that
the screen broke.

`DataGrid` grew a `footer` prop (a real `<tfoot>`, keyed by column id), the
response carries `totalQuantity` as a decimal STRING, and the sum is done in SQL
— `sum(quantity)::text`. Casting it to a float to "make it a number" is how a
total of 70013.25 becomes 70013.249999999.

### The only screen with explicit filtering

Supplier, item, date range and status, applied by a Search button with a Reset —
matching the legacy screen, which is the only one that filters explicitly. The
legacy filters are ids parsed with `Guid.Parse` despite the boxes LOOKING like
free text, so typing a supplier's name there has never matched anything; they are
dropdowns here. The date range is a capability the source has
(`startDate`/`enddate`) and never calls.

`useMasterScreen` grew `resetPaging()` for this: a cursor carried across a filter
change seeks into a sequence that no longer exists, and keyset paging gives no
error for that.

### `document_date` is deliberately NOT sortable

It is nullable, and keyset paging needs a NOT NULL sort column — otherwise every
undated challan silently disappears from the pages. `createdAt` is the source's
own ordering and is the default.

Tests: 451 Node (12 domain + 279 API + 160 web) + 19 .NET, up 46.

---

## 5k. The money rules, run rather than read (7 Sep 2026)

No new screen. This session went at the arithmetic that blocks Phase 4 — and the
important change is that the invoice calculators are no longer something we have
READ. They have been RUN.

`Migration-Assessment/tools/calculator-harness/` loads the three real script
files from `AccountManegments.Web/wwwroot/moduls` into jsdom, in the order
`CreateInvoice.cshtml:896-898` loads them, against a reproduction of that page's
markup, and reads the totals fields back. `node run.mjs`.

### D-JS-1 is confirmed, and it is worse than it was written up

The known part: three files define `updateTotals`, the last wins, and the winner
is the PURCHASE ORDER calculator, which has no TDS and no round-off. Confirmed —
₹500 of TDS moves the total by nothing.

**The part nobody had spotted: the two calculators read DIFFERENT ROWS.**

- `InvoiceMasterScript` iterates `$(".productRow")` and reads fields BY CLASS.
- `PurchaseRequestScript` iterates `$(".product")` and reads them BY ID.
- Rows rendered with the page (`CreateInvoice.cshtml:262`, `:357`) carry
  `productRow`, and every input has both a class and a row-suffixed id.
- Rows added by AJAX (`_DisplayInvoiceItemDetailsPartial.cshtml:11`) carry
  `product`, and the inputs have a bare id and NO class.

Each calculator sees exactly half the table and the halves are disjoint. On a
two-line invoice of 1000.00 + 500.00, correct total 1770.00: the calculator that
runs returns **590.00**, the one it overwrote returns **1180.00**. **No load
order produces 1770.00.**

Practically: a NEW invoice built entirely from the item picker totals correctly
except for the missing TDS. An EXISTING invoice reopened and re-saved has its own
lines invisible to the recalculation.

Still to be confirmed on the LIVE server, which may serve a different build.
Doc 19 question 2 now asks for exactly that, with the steps.

### A business rule nobody had written down

**Every invoice total is rounded to a whole rupee, and exactly .50 rounds DOWN.**

`InvoiceMasterScript.js:1005` and `SalesInvoiceMasterScript.js:381`:

```javascript
var decimal = grandTotal - Math.floor(grandTotal);
grandTotal = (decimal <= 0.5) ? Math.floor(grandTotal) : Math.ceil(grandTotal);
```

No document this system has issued carries paise. And the half goes DOWN, where
commercial rounding takes it up — always in the counterparty's favour, never the
company's. That is now question 5a of doc 19. **The default if nobody answers is
to reproduce it exactly**, because that is what every issued document did.

### Two more, in the Sales roll-up

`updateSalesTotals` computes `total = subtotal + gst - Tds + roundOff` and never
subtracts the discount it displays. That is right ONLY because a separate handler
already overwrote the visible price — per-line GST uses the HIDDEN price minus
discount, the roll-up sums the VISIBLE price. If the overwrite did not happen,
the discount is shown and never taken off. And `Tds` is read with `.val()` and
used unparsed: an empty box coerces to 0 by luck, `"1,000"` makes the total NaN.

### The arithmetic now exists, in decimals, with both versions

`packages/domain/src/money.ts` — fixed-point decimal on BigInt. Money is a string
everywhere else in this system; this is the only place it is arithmetic. Half-up
rounding (`toFixed` rounds 1.005 to "1.00"; this gives 1.01), and
`roundToWholeRupeeAsProduced` for the rule above.

`packages/domain/src/invoice-total.ts` — TWO functions, deliberately:

- `asProduced(lines, charges, calculator)` reproduces each legacy calculator IN
  FLOAT, defects included. Float on purpose: doing it in decimals would give the
  right answer, which is what makes it useless for reconciling history.
- `corrected(lines, charges)` is the arithmetic the business thinks it has.
- `drift(...)` reports the difference per document — the number question 1 asks
  them to accept, now producible for every stored invoice instead of estimated.

Rounding is per line then summed, not sum-then-round, matching the source's
`.toFixed(2)` per line. A total that does not equal the printed lines added up is
a support call every time.

**Nothing in the API uses these yet.** They are the foundation Phase 4 sits on,
and they are provable before a screen is built on them.

Tests: 480 Node (41 domain + 279 API + 160 web) + 19 .NET, up 29.

---

## 5l. File upload for challans — the storage decision, made (7 Sep 2026)

Committed as `53c8a620`. Phase 3 is now complete.

### The decision

**Local disk, behind a `DocumentStorage` interface.**

Assessment 12 wants object storage. The business runs a disk today. This ships
the disk — no new infrastructure, no credentials, no bucket policy to review —
but behind an interface, so S3 is one new class with four methods and one line in
`common/storage/storage.module.ts`. No repository, controller or test changes.

`STORAGE_DIR` is `/opt/accountbook-next/uploads` on the VPS, and the API
**refuses to boot in production without it**. Two reasons, both learned from the
deploy layout:

- It must be outside anything nginx serves. The legacy application writes into
  `wwwroot/Content/InWordDocument/`, which the web server hands to anyone who
  guesses a name.
- It must be outside `releases/`. `current` is a symlink into
  `releases/<timestamp>/` and the deploy prunes to the last five, so uploads
  written under a release are deleted by the fifth deploy after they were made —
  silently, and only noticed when someone asks for a file.

`StorageModule` creates the directory and write-tests it at boot, so a
permissions problem fails the deploy rather than someone's first upload.

### What it closes — findings H-9 and H-10

The legacy single-file handler is four lines and contains every mistake
available (`ItemInWordController.cs:190-193`):

```csharp
var path = Environment.WebRootPath;
var filepath = "Content/InWordDocument/" + ItemInWordDetails.DocumentName.FileName;
var fullpath = Path.Combine(path, filepath);
UploadFile(ItemInWordDetails.DocumentName, fullpath);
```

1. `IFormFile.FileName` is the browser's, unsanitised — separators and `..`
   included — so the destination is caller-controlled. That is an arbitrary file
   **write**, not just a read. **H-10.**
2. `FileMode.Create` truncates. Two suppliers uploading `invoice.pdf` overwrite
   one another and the earlier challan then shows the later one's document.
   `InsertMultipleItemInWordDetail` prefixes a GUID and avoids this;
   `AddItemInWordDetails` does not; **both are live**.
3. Inside `wwwroot`, so every attachment is anonymously downloadable. **H-9.**
4. No extension, size or type check, so an `.html` upload is stored XSS on the
   application's own origin.

Here:

| Legacy | Port |
|---|---|
| Path built from the uploaded name | Key generated (`newStorageKey`); the name is a column, never a path |
| `FileMode.Create` truncates | Written with `wx`; a collision is refused |
| Served from the web root | Outside it; every byte through a token and `inward-challan.view` |
| No checks | Allowlist + 10 MB + signature sniffing |
| Whatever type the server guesses | `attachment` + `nosniff` + the type read from the bytes |

`.html`, `.svg` and `.xml` are off the allowlist deliberately. All three script
in a browser, and `.svg` is the one that looks like an image and is not.

### The three decisions inside it worth knowing

**Validate everything, then write everything, then record everything.**
Validating as we go would leave three of five files stored and the request
rejected — the user retries and collects duplicates. If a write fails part way,
what was already written is removed: a blob with no row is invisible, and
invisible waste is never reclaimed.

**Delete the row first, then the bytes.** The other order risks a row pointing at
bytes that are gone, which is a broken download for as long as the row lives.
This way a failed blob delete leaves a stray file and nothing else, and it is
logged rather than reported as a failed delete — the user asked for the
attachment to be gone and, from where they sit, it is.

**A download is a `fetch`, not a link.** The access token is held in memory and
never in a cookie, so a browser-initiated navigation carries no credentials and
would 401. The bytes come back through `fetch` and reach the disk as an object
URL, revoked on the next tick. That is a direct consequence of the token
decision, and it is the right way round: the alternative is a cookie the browser
attaches to every request, which is what makes CSRF possible.

### A bug this found in an already-shipped screen

**An inward challan with no supplier could not be saved at all.**

`supplierId: uuidId.nullable().optional()` — an unselected `<select>` submits the
empty string, which fails `.uuid()` with "Not a valid identifier". And no
supplier is the COMMON case here: the source's live create path
(`AddItemInWordDetails`) never records one. The purchase request form had the
same defect on its optional item, which is the whole reason that field is
nullable.

Both now use `optionalUuidId` in `contracts/fields.ts`, which maps `""` to null
BEFORE the uuid check — so "nothing chosen" and "chosen and invalid" stay
different answers. Regression tests in `contracts/attachments.test.ts`.

It was found by a test, not by reading: the form simply never posted, and the
message was attached to a field nobody looked at.

### Verified by running it

Against the local API, not inferred:

| | |
|---|---|
| upload a real PDF | 200, `contentType: application/pdf`, `sizeBytes: 48` |
| download it | bytes **identical**, `attachment`, `nosniff`, `private, no-store` |
| without a token | 401 |
| `.html` | 400 — "`.html` files cannot be attached. Allowed: …" |
| the same file renamed `.pdf` | 400 — "is not a PDF. Its name says one thing and its contents say another." |
| an executable named `.png` | 400 — "is a program, whatever it is named." |
| `../../../../etc/passwd.pdf` | **200** — stored as `passwd.pdf` under the challan's own prefix, nothing written outside the root |
| 11 MB | 413, naming the 10.0 MB limit |
| the same document id via another challan | 404 (not 403 — a 403 confirms the id exists) |
| an ETL row with no bytes | 404 saying the old system kept the file on its own web server |
| delete, then delete again | 204, then 404; the file is gone from disk |

### DEPLOYED — 8 Sep 2026, release `20260908-132107`

Live at **https://avfast.in/**. Three server-side prerequisites had to go in
first, and all three are now done — **do not repeat them**:

1. **`/opt/accountbook-next/write-env.mjs` replaced** with the repo copy. Without
   it the release has no `STORAGE_DIR` and the API refuses to boot in
   production. That guard did its job in the sense that mattered: the deploy
   would have failed loudly rather than writing uploads into a pruned release.
2. **`/opt/accountbook-next/uploads` created, mode 700.** Verified in both
   directions: `www-data` can read the app, and `www-data` CANNOT list the
   uploads. If that second one ever starts passing, the attachments are back
   where the legacy ones were.
3. **`client_max_body_size 12m`** added to the `/api/` location in BOTH
   `avfast.conf` and `accountbook-next.conf` (port 8090) — the only two blocks
   that proxy to 3101; the 8080 and 7251 blocks that serve the live ASP.NET app
   were not touched. Backups at `/root/*.conf.bak.20260908`, `nginx -t` passed
   before the reload.

nginx defaults to **1m** and rejects a larger body itself, with its own 413 HTML,
before the request reaches the API. The symptom would be an attachment well under
the app's 10 MB limit failing with an error the application never wrote and
nothing in its log.

Migration output was `3 applied, 0 adopted, 5 skipped` — 0005, 0006 and 0007, so
`inventory_inward`, `inward_challans` and `inward_challan_documents` are on the
live database for the first time. `0 applied` after shipping a migration is the
thing to be suspicious of.

Verified against the public HTTPS front door, not just localhost:

| | |
|---|---|
| `https://avfast.in/` | 200 |
| `/api/v1/health` | ok, FY 26-27 |
| a real login (`ckalathiya`) | 200 — health alone never touches the signing key |
| `GET /inward-challans` | `{"rows":[],"total":0,"totalQuantity":"0"}` — the footer aggregate is **present** on an empty set, which is exactly where the source loses it |
| upload with no token | 401 |
| **2 MB** multipart body | reached the API and got the app's own 404. Under the old 1m default nginx would have answered 413 itself |
| **11 MB** | 413 carrying the APPLICATION's sentence — "is larger than the 10.0 MB limit" — not nginx's HTML |
| `www.avfast.in` | 302 (the pre-existing MVC fault, unchanged) |
| 8080 / 7251 / 1433 | all still listening |
| 3101 from outside | unreachable, as intended |

No test record was written to the live database: the probes used a non-existent
challan id, so the routes were exercised without leaving junk behind.

The log does contain `asn1 encoding routines::too long` errors — they are from
**3 Sep, release `20260903-195518`**, the historic PEM-in-EnvironmentFile
problem, and nothing from this release.

Tests: **617 Node** (25 contracts + 41 domain + 374 API + 177 web) + 19 .NET,
up 137.

---

## 5m. Both record layouts, so the business can actually answer (8 Sep 2026)

Committed as `028a42a9`. PLAN.md §1.2 said to put the master-detail question to
the business **with both on screen**. Both are now on screen.

The legacy screens fill a right-hand pane when a row is clicked and leave the
list usable. The port opened with a modal that blocks it. That is a real change
to how the screens are worked, and asking about it in prose is a poor way to ask
— so the header carries a two-option switch and every screen has both layouts.

### Three shared files, and NO page changes

| File | Does |
|---|---|
| `contexts/RecordLayoutContext.tsx` | the preference, per user, in localStorage |
| `components/ui/FormDialog.tsx` | renders `Modal` or the new `SidePanel` |
| `lib/use-master-screen.ts` | adds row-click and selection to `gridProps` in split mode |

Every page already spreads `screen.gridProps(query)`, so row-click-to-open and
the selected-row highlight arrived on twelve screens without one of them being
edited. **That is the argument for deciding now rather than later**, and it is
not rhetorical: the machinery is shared today, and each screen built against one
layout is another to re-check against the other.

Outside a provider the context answers `modal` — what every screen shipped with —
so all 177 existing web tests passed unchanged, first run. A context that threw
there would have turned one shared change into 177 test edits, which is how a
reversible experiment stops being reversible.

`SidePanel` is deliberately NOT a modal: no backdrop, no focus trap, no
`aria-modal`, and the body scroll is left alone. A modal that merely looked
docked would be the worst of both — still blocking the list while appearing not
to. Escape closes it, but only when focus is inside it: Escape while the user is
in the list belongs to the list.

### Two things the browser caught that reading could not

**The pane was `complementary`, and so is the nav sidebar.** `<aside>` maps to
that role, so the page had two identically-roled landmarks and a query for one
matched both. It is now a labelled `region`. Found only because the QA script
failed with a strict-mode violation naming both elements.

**The reserved width was silently not applied.** `<main>` had a base `lg:px-8`
and a conditional `sm:pr-[29rem]`; Tailwind emits `sm:` rules before `lg:` ones,
so at desktop width the base won and the padding stayed 32px. The pane sat on top
of 415px of the list — defeating the entire purpose of the layout — and it
**looked correct in a screenshot**. Only measuring the boxes caught it:
`mainPaddingRight: "32px"`, `paneCoversVisibleList: true`. The right padding is
now expressed once, as one class or the other, never as a base plus an override.

### The trade-off, stated rather than hidden

The pane takes ~448px, so on a 1440 screen the last column or two of a wide list
is pushed off and has to be scrolled to. Measured, not guessed: the visible list
area goes from 1118px to 686px. There is no third option that avoids both costs,
and doc 19 Question 12 says so plainly rather than selling the split view.

**When the answer comes back, delete the loser and the switch.** A permanent
toggle is two layouts to test and support, and a question that never closes.

Tests: **635 Node** (25 contracts + 41 domain + 374 API + 195 web) + 19 .NET,
up 18.

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
