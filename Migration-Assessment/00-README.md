# Migration Assessment & Technical Blueprint
## AccountManagement (.NET 6/8 + MSSQL) → React + Node.js/TypeScript + PostgreSQL

**Prepared:** 27 August 2026
**Repository analysed:** `E:\nakul\Chintan Kalathiya\AC`
**Status:** Assessment only. **No code has been written, modified or deleted.**

---

## How to read this pack

Read in this order. Documents 01 and 18 are the ones to read if you only read two.

| # | Document | What it answers |
|---|---|---|
| [01](01-Executive-Summary.md) | Executive Summary | What the system does, what is wrong, what it will cost |
| [02](02-Current-Architecture.md) | Current Architecture | How the four projects actually fit together |
| [03](03-Module-Inventory.md) | Module & Screen Inventory | Every module and every screen, with complexity and priority |
| [04](04-Database-Inventory.md) | Database Inventory | Tables, columns, relationships, integrity gaps |
| [05](05-Performance-Analysis.md) | Performance Analysis | Ranked bottlenecks with code evidence, and where each fix belongs |
| [06](06-API-Inventory.md) | API Inventory | All 138 endpoints, categorised, with redesign notes |
| [07](07-Business-Rule-Inventory.md) | Business Rule Inventory | The rules that must survive migration |
| [08](08-Security-Model-and-Review.md) | Security Model & Review | Auth, permissions, and the security findings |
| [09](09-MSSQL-to-PostgreSQL-Mapping.md) | MSSQL → PostgreSQL | Type mapping, SQL Server specifics, target schema |
| [10](10-DotNet-to-NodeJS-Mapping.md) | .NET → Node.js | Layer-by-layer translation and framework/ORM choice |
| [11](11-UI-to-React-Mapping.md) | UI → React | Screen-by-screen React mapping and architecture |
| [12](12-Target-Architecture.md) | Target Architecture | The recommended end state, with diagrams |
| [13](13-Migration-Strategy-and-Roadmap.md) | Strategy & Roadmap | Option comparison, recommended approach, phased plan |
| [14](14-Data-Migration-and-Testing.md) | Data Migration & Testing | How data moves and how we prove it is correct |
| [15](15-Performance-Targets.md) | Performance Targets | Measurable targets and how to baseline |
| [16](16-Technology-Stack.md) | Technology Stack | Final recommended stack with reasons |
| [17](17-Risk-Register.md) | Risk Register | Risks, likelihood, impact, mitigation |
| [18](18-GO-NO-GO-Assessment.md) | **GO / NO-GO** | **Whether to start, and what must be resolved first** |

---

## Evidence basis

Every finding in this pack cites a file and line number from your own source code.
Nothing has been inferred from what a system like this "usually" does.

**What was read in full:**

| Layer | Files | Volume |
|---|---|---|
| API project | `Program.cs` + 14 controllers | ~110 KB |
| Repository layer | 16 repositories + 15 services + 27 interfaces | ~450 KB / 10,304 lines |
| EF Core model | `DbaccManegmentContext.cs` + 28 entities | ~80 KB |
| MVC Web layer | 12 controllers + 3 helpers + models | ~370 KB |
| Razor views | 93 views and partials | ~900 KB |
| Client JavaScript | 17 custom modules | ~525 KB |

**What could NOT be read, and why it matters:**

The live SQL Server at `srv1925876.hstgr.cloud,1433` is not reachable from this
analysis environment. Everything in this pack about the *database schema* is
derived from the EF Core model, which is a snapshot taken when the model was
last scaffolded and may have drifted.

Specifically **UNKNOWN** until the extraction scripts are run:

- Actual indexes (the EF model declares **zero** — this is either the root cause of the reported slowness, or a scaffolding artefact)
- Actual foreign keys present in the database
- Check constraints, triggers, stored procedures, views, functions, sequences
- **Row counts and data volumes** — without these, no performance claim can be sized
- The number of pre-existing referential-integrity violations
- Query Store / DMV evidence of which queries are genuinely slow

## → Run these first

Three read-only scripts are in [`tools/`](tools/). They change nothing.

```
tools/01-extract-mssql-schema.sql        → db-extract/01-schema.txt
tools/02-extract-perf-dmv.sql            → db-extract/02-perf.txt
tools/03-orphan-and-duplicate-census.sql → db-extract/03-census.txt
```

Each script has run instructions in its header. Drop the three output files into
a `db-extract` folder next to this one and the assessment can be completed —
in particular documents 04, 05, 09 and 14, and the effort estimates in 13.

Script 03 is the important one. It measures the gap between the ~25 foreign keys
the code declares and the ~62 reference columns that have none. That gap is the
largest single unknown in the schedule.

---

## The one-paragraph version

This is a well-scoped construction/infrastructure accounting system — purchase
requests, purchase orders, supplier invoices, sales invoices, inventory and
payments across multiple sites and companies — with about 31 screens, 138 API
endpoints and 24 database tables. The reported slowness is **not** caused by
SQL Server, and moving to PostgreSQL will not fix it. It is caused by an absence
of pagination (`.Skip`/`.Take` appear zero times in the entire codebase), full-table
loads on routine operations, N+1 query loops, and grids that ship every row to the
browser. Those are all fixable in the existing .NET application in a matter of
weeks, at a fraction of the cost of a rewrite. Separately, the assessment found
security and data-integrity defects serious enough that they need attention
regardless of whether a migration ever happens — plaintext passwords, an
unauthenticated endpoint that grants administrator rights, and all money
arithmetic being performed in browser JavaScript that the server trusts without
verification. The recommendation is a **conditional GO** with a mandatory
stabilisation phase first. The detail is in [18-GO-NO-GO-Assessment.md](18-GO-NO-GO-Assessment.md).
