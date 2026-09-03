# import-masters

Loads the **master tables** from the live SQL Server into a local PostgreSQL, so
the new app can be exercised against real data instead of the generated dev seed.

**Read-only against SQL Server.** Every statement it sends there is a `SELECT`.

This is a **development convenience**, not the production ETL. The real ETL is
still gated on the orphan census (`Migration-Assessment/tools/run-db-extract.ps1`)
— but this import will show you a first, honest count of the orphans in the
master tables, which is a useful down payment on the same question.

## What it moves

`UnitMaster`, `Company`, `Site`, `SupplierMaster`, `ItemMaster`, `GroupMaster`,
`User`, `Form`, `UserwiseFormPermission` — and the two junction tables that
replace the CSV `User.SiteId` / `User.CompanyId` columns.

Transactions (purchase orders, invoices, payments) are **not** included. Those
tables are not migrated yet.

## Three things it deliberately does

1. **It never copies a password.** The source `User` table stores them in
   plaintext (finding C-1). Every imported user is given the same known
   development password — **`DevPassword1`** — so real credentials never leave
   the SQL Server.

2. **It imports only what the app shows today** (`IsDeleted = 0`). A row where
   the flag `IS NULL` is invisible in the current application, and backfilling
   `NULL → false` would make it *appear* — a visible change that needs business
   sign-off. Those rows are **counted and reported**, never silently included or
   silently dropped.

3. **It refuses to write an orphan, and tells you about every one.** The target
   schema has real foreign keys; the source has roughly 62 reference columns
   with none. This is the first place that gap becomes visible with real numbers.

It also reads with `SELECT *` and matches columns case-insensitively, because EF
remaps several names (`Gstno`→`GSTNo`, `Iffccode`→`IFFCCode`,
`Gstamount`→`GSTAmount`, `IsWithGst`→`IsWithGST`) and the live schema may have
drifted from the model besides.

---

## Setup

### 1. Credentials

Create **`.env.local`** in this folder. It is gitignored — the passwords never
enter the repository, and never need to be pasted into a chat.

```
MSSQL_PASSWORD=<the SQL Server password>
PGURL=postgres://postgres:<your postgres password>@127.0.0.1:5432/accountbook
```

Optional overrides: `MSSQL_SERVER`, `MSSQL_PORT`, `MSSQL_DATABASE`, `MSSQL_USER`
(these default to the production host, 1433, `DBAccManegment` and `sa`).

> **Rotate the `sa` password first if you have not.** It is in git history and
> must be treated as public — see `SESSION-HANDOFF.md` §8.

### 2. Create the local database

```powershell
$bin = "E:\Manish Dhaduk\Postgres\bin"
& "$bin\createdb.exe" -U postgres -h 127.0.0.1 accountbook
```

### 3. Create the schema

The API does **not** migrate a real database for you — `database.module.ts`
applies migrations only on the embedded PGlite path. So do it here:

```bash
npm run migrate
```

### 4. Look before you load

```bash
npm run dry-run
```

Reads everything, prints what would be loaded, the `IsDeleted IS NULL` counts and
every orphan — and **writes nothing**. Read this output before going further.

### 5. Load

```bash
npm run import
```

Repeatable: it truncates the master tables and reloads them, inside one
transaction. It does not touch any table it did not import.

### 6. Point the app at it

```powershell
$env:DATABASE_URL = "postgres://postgres:<pw>@127.0.0.1:5432/accountbook"
```

then start the API. Sign in as any imported user with **`DevPassword1`**.

The dev seed will not fire: `DevSeed.seedDatabase` returns early when any user
row already exists, so real data is never mixed with generated data.

---

## Notes

- **`sites.company_id` is left null.** There is no Company→Site relationship
  anywhere in the source schema. Nothing derives it, so nothing invents it.
- **`GroupMaster` is a cross product** — one row per (site × address) pair, with
  `GroupName` and `GroupId` repeated in each. It is collapsed with a `DISTINCT`
  per side into `site_groups`, `site_group_sites` and `site_group_addresses`.
- **Duplicate usernames are rejected, not merged.** The target has a
  `lower(user_name)` unique index; the source has no such constraint. Any
  duplicate is reported as an orphan-class finding rather than aborting the load.
- **Roles are not imported.** `User.RoleId` is `Guid?` while `UserRole.RoleId` is
  `int` — they cannot join, and role-based permissions have never worked. See
  `SESSION-HANDOFF.md` §9.
- **The data on your disk is real.** Real supplier and customer records. Do not
  commit a dump of this database, and do not point anything public at it.
