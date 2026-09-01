# 13 — Migration Strategy & Roadmap

---

## 1. Option comparison

| | **A — Big bang** | **B — Strangler Fig** | **C — Module by module** | **D — Backend first** | **E — Frontend first** |
|---|---|---|---|---|---|
| **Approach** | Build everything, cut over once | Gateway routes traffic; modules move across incrementally; both systems run in parallel | Migrate whole vertical slices (UI + API + data) one at a time | Replace the .NET API entirely, keep the MVC UI, then do React | Build React against the *existing* .NET API, then replace the backend |
| **Risk** | **Very high** | **Low** | Medium | Medium | **High** |
| **Dev time** | Shortest in theory | Longest (+20-30%) | Medium | Medium | Medium |
| **Testing effort** | Enormous, all at the end | Continuous, per module | Per module | Backend contract tests | Frontend tests, then all again |
| **Downtime** | Hours to days | **Near zero** | Near zero | One cutover window | One cutover window |
| **Data migration** | One irreversible cutover | Incremental + dual-write, or shared DB during transition | Per module — complex to keep consistent | One cutover | Not addressed until late |
| **Rollback** | **Restore from backup. Effectively none** | **Change a routing rule** | Per module | Per cutover | Difficult |
| **Cost** | Lowest nominal, highest expected | Highest nominal, lowest expected | Medium | Medium | Medium |
| **Business disruption** | **Severe — a freeze on all change for 9-12 months** | Minimal — features can still ship | Low | Low | Medium |
| **Verdict** | ❌ | ✅ **RECOMMENDED** | ⚠️ Viable variant | ⚠️ Good phase-2 shape | ❌ |

### Why not A (big bang)

Three specific reasons drawn from this codebase, not from general principle:

1. **The business rules are not specified.** Ten open questions in
   [07](07-Business-Rule-Inventory.md) have no answer yet, several concerning
   arithmetic that is currently wrong. Building a complete replacement against an
   unknown specification and cutting over in one step is how projects fail.
2. **The orphan census is unmeasured.** ~62 unconstrained reference columns. If
   remediation turns out to be large, a big-bang plan has no way to absorb it.
3. **A 9-12 month feature freeze is not acceptable** for a system in daily
   operational use.

### Why not E (frontend first)

Superficially attractive — the MVC tier is a proxy, so React could talk to
`api.avfast.in` directly. But:

- **36 of the endpoints React needs return HTML, not JSON.**
- **No endpoint supports pagination**, so React would inherit the exact performance
  problem it was brought in to solve.
- **The API has no per-endpoint authorization**, so a React client would expose
  every endpoint to every user with devtools.
- **Money is computed client-side**, so React would have to reimplement three
  divergent JavaScript calculators — cementing the defect rather than removing it.

Building a modern frontend against this API means building it twice.

### Why not C (module by module, full vertical)

Reasonable, and close to what is recommended. The difficulty is **data**: migrating
`SupplierInvoice` to PostgreSQL while `PurchaseOrder` is still in SQL Server means
maintaining a cross-database join for the PO↔Invoice relationship — which is
already a fragile string match. The dependency graph does not decompose cleanly at
the data layer.

**B incorporates C's benefits** while keeping the database migration as one
coordinated event.

### Why B (Strangler Fig) is right for this system

| This codebase's property | Why it favours Strangler Fig |
|---|---|
| The MVC tier is a **pure HTTP proxy** with no business logic | The seam already exists. A gateway can route per-path with no code change |
| The API is **already separate** and already the only data path | The new Node API can serve the *existing* MVC UI while React is built |
| **No external integrations** | Nothing outside the system needs coordinating |
| **No background jobs** | No scheduled work to keep consistent across two systems |
| The client is **already experiencing pain** | Incremental delivery means relief in weeks, not a year |
| The business rules are **undocumented** | Each module is discovered, specified and verified in isolation before the next begins |

---

## 2. Recommended strategy

> **Phase 0 (stabilise the existing app) → Strangler Fig migration, backend-led,
> with a single coordinated database cutover.**

```
  NOW          .NET Web (Razor)  ───►  .NET API  ───►  SQL Server


  PHASE 0      .NET Web (Razor)  ───►  .NET API  ───►  SQL Server
               + observability      + pagination     + indexes
               + bundling           + caching        + security fixes
               ──────────────────────────────────────────────────────
               Client feels the performance improvement WITHIN WEEKS.
               Business-rule specification is produced as a by-product.


  PHASE 1-2                   ┌──►  .NET API  ───►  SQL Server
               .NET Web ──► gateway
                                └──►  Node API ───►  PostgreSQL
                                       ▲
                                 modules move across one at a time
                                 rollback = change a routing rule


  PHASE 3-5    .NET Web ──► gateway ──►  Node API ───►  PostgreSQL
               React SPA ─────┘          (all modules)
                                 React screens land wave by wave


  PHASE 6      React SPA  ───►  Node API  ───►  PostgreSQL
               .NET decommissioned
```

**The database cutover is one coordinated event, not incremental.** Attempting to
run half the tables in each engine creates cross-database joins on relationships
that are already fragile string matches. Instead: build the PostgreSQL schema
early, keep it synchronised, and cut over once with a rehearsed, reversible plan.

---

## 3. Roadmap

Effort assumes **3-4 engineers**. All figures are **provisional until the orphan
census and row counts are known.**

---

### PHASE 0 — Stabilise & specify (4-6 weeks) · **Do this regardless**

**Objective:** make the current system fast and safe, and produce the specification
the migration needs.

| Workstream | Tasks |
|---|---|
| **Security (week 1)** | Rotate `sa` + 2 commented credentials + the JWT key. Add `[Authorize]` to `FormPermissionMasterController`. Remove `Password` from the `GetUserById` response. Delete the "Remember me" password cookie. Enable HTTPS redirection + Secure cookies. Gate Swagger behind non-production. Purge secrets from git history; add `gitleaks` |
| **Observability (week 1-2)** | Serilog + Seq or Application Insights. EF Core command logging. Correlation ids. Enable Query Store. Run the three extraction scripts |
| **Performance (week 2-4)** | Global `AsNoTracking`. Delete the two dead `GetType()` queries. Fix the 6 bulk-approve full-table loads. Pagination on the top 5 lists + server-side DataTables. Cache reference data. Batch the 6 N+1 loops. **Create indexes based on the DMV output** |
| **Frontend (week 4-5)** | Bundle and minify. Response compression. `defer` on scripts. Move CKEditor to the one screen that uses it. Debounce search. Remove the `<script>` tag from `_POListPartial.cshtml` |
| **Specification (throughout)** | Answer the 10 open questions in [07](07-Business-Rule-Inventory.md). **Write characterisation tests for the money calculations against production invoices.** Confirm or refute the Create Invoice TDS/round-off bug |

**Completion criteria:**
- Every critical security finding closed
- Structured logs and traces in production; a measured performance baseline exists
- The top 5 list screens are paginated and measurably faster
- The 10 business-rule questions are answered and signed off
- Characterisation tests exist for the money arithmetic and pass against production data

**Risk: Low.** **Value: immediate and independent of the migration decision.**

---

### PHASE 1 — Foundation (6-8 weeks)

**Objective:** target infrastructure exists, the schema is proven, data can move.

| Workstream | Tasks |
|---|---|
| **Schema** | Hand-write the PostgreSQL DDL. Junction tables for `User.SiteId`/`CompanyId`. `document_counter`. Real FKs. Unique constraints. Indexes designed from the DMV output |
| **Orphan remediation** | Run the census. Quarantine or repair every orphan. **This is the schedule's biggest variable** |
| **ETL harness** | Repeatable, idempotent, restartable. Type conversions. `setval()`. Reconciliation reports |
| **Node skeleton** | NestJS + Drizzle + Zod + Pino. Global guards. Transaction interceptor. Exception filter. CI/CD. Staging on a production snapshot |
| **`packages/domain`** | **The money calculator**, built against the Phase 0 characterisation tests |
| **Auth module** | argon2id. RS256 + refresh tokens. Permission model. The plaintext→hash migration path |
| **Gateway** | nginx routing `/api/v1/*` to Node, everything else to .NET |

**Completion criteria:**
- A full production dataset loads into PostgreSQL with **zero reconciliation
  differences** outside the documented ±0.01 money drift
- The money calculator reproduces historical invoice totals within the agreed
  tolerance, with a documented exception list
- Login works against Node for a pilot user group
- The load can be re-run end to end in under 4 hours (the cutover budget)

**Risk: Medium-High** — orphan volume is unknown.

---

### PHASE 2 — Masters (6-8 weeks)

**Modules:** reference data, companies, sites, site groups, suppliers, items, users, permissions.

Includes the React shell, `DataGrid`, `GeoCascade`, `EntityForm`, `PermissionGate`,
and the Excel import moved to a BullMQ worker.

**Completion criteria:** all master screens run on React + Node + PostgreSQL in
production for a pilot group; the .NET master screens are read-only; parallel-run
reconciliation is clean for one week.

**Risk: Low-Medium.** This wave is where the team builds confidence.

---

### PHASE 3 — Simple transactions (8-10 weeks)

**Modules:** Purchase Requests, Inward Challans, Inventory.

File upload to object storage. Repeater form patterns. **No money arithmetic** —
deliberately, so the team exercises the harder UI patterns before the harder domain
logic.

**Risk: Medium.**

---

### PHASE 4 — Invoicing (8-10 weeks) · **The risk centre**

**Modules:** Purchase Orders, Purchase Invoices, Sales Invoices.

**Order matters: Purchase Invoice FIRST.** It has the full superset — discount, TDS
and round-off. Build `LineItemGrid` once against it, then reuse for PO and Sales.

| Task | Note |
|---|---|
| Server-authoritative totals on all three document types | |
| Document numbering onto `document_counter` | Race conditions closed |
| PO↔Invoice text match → real FK | Requires the reconciliation exercise from [09 §7.5](09-MSSQL-to-PostgreSQL-Mapping.md) |
| Fix D7 (Purchase Returns added instead of subtracted) | **Business sign-off required** |
| Fix D10 (PO grouping under-reports duplicate lines) | |
| Fix the Create Invoice global-collision bug | |
| Transactions on every header/detail write | |

**Completion criteria:** **every invoice created in the new system for four
consecutive weeks reconciles exactly against the same document created in the old
system**, or every difference is explained and signed off.

**Risk: HIGH.** Budget contingency here specifically.

---

### PHASE 5 — Reports, payments, dashboard (6-8 weeks)

Reports with real pagination. Exports as async jobs. PDF via Playwright. The
dashboard consolidated from six client-filtered list calls into one endpoint.

⚠️ **Enabling pagination on the three report grids is a visible behaviour change**
users will notice — they currently see everything on one screen. Manage that
expectation early.

**Risk: Medium.**

---

### PHASE 6 — Cutover & decommission (4-6 weeks)

| Step | Detail |
|---|---|
| Full parallel run | Both systems live, reconciled daily, for **at least 4 weeks** |
| Freeze + final delta | Short window, final incremental data load |
| Cutover | DNS/gateway switch. Old system stays running, read-only |
| Hypercare | 2 weeks, elevated support, rollback plan live |
| Decommission | Only after 4 weeks of clean operation. **Retain a restorable SQL Server snapshot for 12 months** |

**Rollback plan at every stage:** revert the gateway rule. Because the .NET system
remains intact and read-only until decommission, rollback stays available
throughout.

---

## 4. Timeline

```
  Month   1   2   3   4   5   6   7   8   9  10  11  12
  P0     ███████
  P1         ████████████
  P2                 ████████████
  P3                         ████████████████
  P4                                 ████████████████
  P5                                             ████████████
  P6                                                     ████████
```

| Phase | Weeks | Cumulative |
|---|---|---|
| 0 — Stabilise | 4-6 | 6 |
| 1 — Foundation | 6-8 | 14 |
| 2 — Masters | 6-8 | 22 |
| 3 — Simple transactions | 8-10 | 32 |
| 4 — Invoicing | 8-10 | 42 |
| 5 — Reports & dashboard | 6-8 | 50 |
| 6 — Cutover | 4-6 | **56 (~13 months)** |

With **overlap** between phases 2-5 and a team of 4, **10-12 months** is realistic.

**Sensitivity:** the largest variable is the orphan census. A clean census could
save 4 weeks in Phase 1. A bad one could add 8. **This is why the census must be
run before any commitment is made.**

---

## 5. Team

| Role | FTE | Responsibility |
|---|---|---|
| Tech lead / architect | 1.0 | Design, review, the money calculator, cross-cutting decisions |
| Backend (Node/TS) | 1.5 | API modules, data layer |
| Frontend (React/TS) | 1.5 | Screens, shared components |
| **QA / reconciliation** | **1.0** | **Do not economise here.** Parallel-run reconciliation is the primary safety net |
| DevOps | 0.3 | Pipelines, environments, observability |
| **Business analyst / domain owner** | **0.3** | **Essential.** Answers the 10 open rule questions and signs off behaviour changes |

**Two roles are frequently cut and should not be:** the QA/reconciliation engineer
and the business analyst. This migration's dominant risk is a silent behaviour
change in money arithmetic. Both roles exist to catch exactly that.

---

## 6. Decision points

| When | Decision | Inputs |
|---|---|---|
| **End of Phase 0** | **GO / NO-GO for the migration proper** | Did stabilisation resolve the client's pain? Is the rule specification complete? What did the census show? |
| End of Phase 1 | Is the data migration reliable enough to commit? | Reconciliation results, rehearsed load time |
| End of Phase 2 | Is the team's velocity what was assumed? | Actual vs planned |
| End of Phase 4 | Cutover date | Invoice reconciliation over 4 weeks |
| Pre-cutover | Final go | Parallel-run results, rollback rehearsal |

**The Phase 0 gate is the important one.** It is entirely possible that stabilisation
resolves the client's problem well enough that the migration becomes a
strategic choice about maintainability rather than an urgent remedy for
performance. **That would be a good outcome, and the plan should leave room for it.**
