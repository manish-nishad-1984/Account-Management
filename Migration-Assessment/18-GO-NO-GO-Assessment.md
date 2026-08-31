# 18 — GO / NO-GO Assessment

---

# VERDICT: **CONDITIONAL GO**

**The application is a sound migration candidate. It is not ready to begin today.**

Eight items must be resolved first. Six of them are answered by running scripts and
asking questions — not by writing code — and can be completed in **4-6 weeks**.

---

## Why "conditional GO" and not "GO"

The system is a **good** migration candidate:

| Factor | Assessment |
|---|---|
| Domain complexity | **Low-Medium** — conventional procure-to-pay, 24 tables |
| **External integrations** | **NONE** — no email, SMS, payment gateway, GST portal or third-party API anywhere. This removes an entire category of risk that usually dominates such projects |
| **Background jobs** | **NONE** — nothing to keep consistent across two systems |
| Architectural seam | **Already exists** — the MVC tier is a pure HTTP proxy, so a strangler-fig gateway needs no code change |
| Data volume | Likely modest (**UNKNOWN**, but 24 tables in a single-tenant business system) |
| Data types | **Clean** — all money is `numeric`, all dates are date types. No float money, no string dates |
| Target stack fit | **Good** — nothing here needs .NET specifically |
| Team | Capable, though new to the target stack |

**But it is not ready**, for one dominant reason and several supporting ones.

> **The dominant reason: there is no specification.**
>
> The business rules this system runs on are undocumented, untested, live partly in
> browser JavaScript, are implemented **differently on different screens**, and
> several of them are **provably wrong**. You cannot migrate a system whose correct
> behaviour nobody can state.

---

## The eight blockers

Each has an acceptance criterion. **All eight must be met before Phase 1 begins.**

---

### BLOCKER 1 — Live security exposures 🔴 **Days, not weeks**

Plaintext passwords · the API returns them over HTTP to any authenticated user ·
production `sa` credentials and the JWT signing key committed to source control (and
present in five copies of a checked-in publish folder) · **two unauthenticated
endpoints that grant administrator rights** · no per-endpoint authorization at all.

> This is not a migration blocker. It is a **live exposure today**, and it does not
> become less urgent if the migration is deferred.

**Acceptance criteria**
- [ ] `sa` password, both commented-out credential sets, and the JWT key **rotated**
- [ ] Secrets **purged from git history**; `Publish/` removed from source control; `gitleaks` in CI
- [ ] `[Authorize]` added to `FormPermissionMasterController`
- [ ] `Password` removed from the `GetUserById` response
- [ ] The "Remember me" password cookie deleted
- [ ] HTTPS redirection enabled; cookies marked `Secure`
- [ ] Swagger gated behind non-production
- [ ] Port 1433 firewalled to the application subnet

---

### BLOCKER 2 — No specification for the business rules 🔴 **The single biggest blocker**

[07-Business-Rule-Inventory.md](07-Business-Rule-Inventory.md) lists 10 questions
that only the business can answer. Five of them concern arithmetic that is currently
**wrong**:

1. The financial-year boundary excludes April — every April is stamped with the wrong FY
2. **Purchase Returns are ADDED to supplier balances instead of subtracted**
3. Create Invoice appears to **silently drop TDS and round-off**
4. Two report exports return **empty results for every year query**, and report it as a legitimate empty period
5. Server-side `decimal` will differ from browser `double` by ±0.01 on some historical rows

**Acceptance criteria**
- [ ] All 10 questions answered **in writing**, signed off by a business owner
- [ ] For each defect: preserve, or correct? And what happens to historical data?
- [ ] The money rounding order documented as an explicit behavioural contract
- [ ] A named business owner available for the project's duration

---

### BLOCKER 3 — No measured baseline 🔴

No logging, no telemetry, no APM, no metrics anywhere in the solution. **Nobody
currently knows how slow anything is.**

Consequences: the client's complaint cannot be quantified; no fix can be verified;
the migration cannot demonstrate success; and the DMV output that should rank the
performance work does not exist.

**Acceptance criteria**
- [ ] Structured logging + APM live in production for **at least one week**
- [ ] SQL Server Query Store enabled and collecting
- [ ] [`tools/02-extract-perf-dmv.sql`](tools/02-extract-perf-dmv.sql) run and reviewed
- [ ] The baseline table in [15-Performance-Targets.md](15-Performance-Targets.md) filled in — no `UNKNOWN` rows
- [ ] The top 20 slowest queries identified **by measurement**, not by inspection

---

### BLOCKER 4 — Unmeasured referential-integrity violations 🔴

~62 reference columns have no foreign key, including all four master/detail spines,
two permitting a NULL parent. **PostgreSQL will refuse to create these constraints
until every orphan is resolved, and the volume is completely unknown.**

**This is the single largest variable in the schedule. It cannot be estimated. It
must be measured.**

**Acceptance criteria**
- [ ] [`tools/03-orphan-and-duplicate-census.sql`](tools/03-orphan-and-duplicate-census.sql) run, results reviewed
- [ ] Orphan count known for every relationship in Parts A-C
- [ ] Duplicate count known for every proposed unique constraint (Part D)
- [ ] A remediation plan for each non-zero result, **with effort estimated**
- [ ] Duplicate GST invoice numbers, if any, escalated to the business as a **compliance** matter

---

### BLOCKER 5 — Schema drift unverified 🟠

Three clues in `DbaccManegmentContext.cs` (`PK_Users` on table `User`, `PK_Form_1`,
`PK_PODelevryAddress`) indicate the schema has been renamed and recreated over time.
The EF model declares **zero indexes**, which is either a severe production problem
or a scaffolding artefact.

**Sections of [04](04-Database-Inventory.md) and [09](09-MSSQL-to-PostgreSQL-Mapping.md)
depend on the model being accurate.**

**Acceptance criteria**
- [ ] EF model re-scaffolded against the live DB and **diffed**
- [ ] [`tools/01-extract-mssql-schema.sql`](tools/01-extract-mssql-schema.sql) run
- [ ] **The index question settled** (script §8, §8b)
- [ ] Triggers, stored procedures, views, functions and check constraints enumerated
- [ ] Any logic found in triggers or procs added to [07](07-Business-Rule-Inventory.md)
- [ ] Row counts known for all 24 tables

---

### BLOCKER 6 — No characterisation tests for the money arithmetic 🔴

The money rules exist only in untested JavaScript, implemented differently on
different screens. **Without tests capturing what the system does today, there is no
way to prove the new system does the same thing.**

**Acceptance criteria**
- [ ] A sample of **≥5,000 production invoices** extracted (purchase and sales)
- [ ] A test harness reproduces stored totals from stored line items
- [ ] **≥99.5% reproduce within ±0.01**
- [ ] Every exception categorised: rounding-order, pre-existing defect, or the TDS/round-off bug
- [ ] Results reviewed and signed off by the business

---

### BLOCKER 7 — The Create Invoice bug is unconfirmed 🟠 **Thirty minutes of work**

`CreateInvoice.cshtml:896-898` loads three JS modules whose identically-named globals
collide. The PO formulas — which have no discount, no TDS and no round-off — appear
to overwrite the Invoice formulas.

**If confirmed, an unknown volume of historical purchase invoices are wrong.** This
is a current exposure, not a migration risk, and it may change the answer to
Blocker 2.

**Acceptance criteria**
- [ ] Behaviour verified in production by a developer with devtools open
- [ ] If confirmed: affected date range quantified, business informed, remediation agreed
- [ ] If refuted: documented, and the analysis corrected

---

### BLOCKER 8 — No agreed scope 🟠

The assessment surfaced genuinely missing capability: **no stock-on-hand tracking**,
no PR→PO conversion, no payment-to-invoice allocation, no approval workflow beyond a
single boolean, no e-invoicing. All are reasonable asks. **None is migration.**

**Acceptance criteria**
- [ ] Written scope: **functional parity plus the specific defect fixes agreed in Blocker 2. Nothing else.**
- [ ] A visible "Phase 2 — new features" backlog exists for everything else
- [ ] The stakeholder understands that **[15](15-Performance-Targets.md) shows most of the performance win is available WITHOUT migrating**
- [ ] Budget and timeline approved with **30% contingency in Phase 1** pending the census

---

## Blocker summary

| # | Blocker | Effort | Type | Blocks |
|---|---|---|---|---|
| 1 | Live security exposures | **Days** | Do | Nothing — **do it now regardless** |
| 2 | No business-rule specification | 2-4 weeks | **Decide** | Everything |
| 3 | No performance baseline | 1-2 weeks | Do | Phase 0 verification |
| 4 | Unmeasured orphan volume | **1 day** | **Measure** | Schedule commitment |
| 5 | Schema drift unverified | **1 day** | **Measure** | Phases 1, 9 |
| 6 | No characterisation tests | 2-3 weeks | Do | Phase 4 |
| 7 | Create Invoice bug unconfirmed | **30 min** | **Measure** | Blocker 2 |
| 8 | No agreed scope | 1 week | **Decide** | Budget |

**Blockers 4, 5 and 7 take about two days in total and remove three of the five
biggest risks in the project.** Start there.

---

## What "GO" looks like

Once the eight blockers close:

```
  ✅ GO — Strangler Fig migration, backend-led,
          with a single coordinated database cutover.

     Phase 0  Stabilise & specify        4-6 weeks   ← the blockers close here
     Phase 1  Foundation                 6-8 weeks
     Phase 2  Masters                    6-8 weeks
     Phase 3  Simple transactions        8-10 weeks
     Phase 4  Invoicing (risk centre)    8-10 weeks
     Phase 5  Reports & dashboard        6-8 weeks
     Phase 6  Cutover & decommission     4-6 weeks
              ────────────────────────────────────
              ~10-12 months, team of 3-4
```

Full detail in [13-Migration-Strategy-and-Roadmap.md](13-Migration-Strategy-and-Roadmap.md).

---

## The decision point that matters most

**At the end of Phase 0, re-ask the question.**

Phase 0 delivers: pagination, indexes, `AsNoTracking`, the six bulk-approve fixes,
the six N+1 fixes, reference-data caching, asset bundling, and every critical
security fix — **in the existing .NET application, in 4-6 weeks.**

[15-Performance-Targets.md §4](15-Performance-Targets.md) sets out which improvements
come from where. The conclusion is uncomfortable but important:

> **The majority of the achievable performance improvement is available without
> migrating.** The migration's performance contribution is real but secondary —
> roughly the last 30-40%.

**It is therefore entirely possible that after Phase 0, the client's problem is
solved.** At that point the migration becomes a strategic choice about
maintainability, security posture, hiring pool and long-term cost — **not an urgent
remedy for slowness.**

That is a legitimate and possibly better outcome, and the plan should leave room for
it. Committing to a 10-12 month rewrite to solve a problem that four weeks of
targeted work would fix is the most expensive mistake available here.

**The honest recommendation:** do Phase 0. Then decide, with real numbers in hand.

---

## If you migrate anyway — the case for it

Phase 0 does not fix everything. These remain, and only a migration addresses them:

| Problem | Why Phase 0 cannot fix it |
|---|---|
| **The API has no per-endpoint authorization**, and the token carries no identity | Retrofitting this into 138 endpoints in the existing design is most of a rewrite |
| **Money is computed in the browser and trusted** | Fixing it properly means a shared calculator and a validated API contract |
| **Zero transactions in 10,304 lines** | There is no service layer to attach a unit of work to |
| **`User.SiteId` is a CSV string** driving authorisation | A schema migration — which is a migration |
| **36 endpoints return HTML** | The MVC-as-proxy architecture |
| **No test coverage at all** | Retrofitting tests onto 10,304 lines with no seams |
| **.NET 6 libraries past end of support** | Requires upgrade work regardless |
| **Three notification libraries, two charting libraries, no build step** | Requires a frontend rebuild regardless |
| Hiring pool and long-term maintainability | Strategic, not technical |

**These are good reasons to migrate.** They are just not "the system is slow" — and
being clear about that with the client is what makes the project succeed on terms
everyone agreed to in advance.

---

## Immediate next steps

**This week — no decision required:**

1. **Rotate the four credential sets.** Treat them as public.
2. **Add `[Authorize]` to `FormPermissionMasterController`.**
3. **Run the three extraction scripts.** ([`tools/`](tools/) — read-only, they change nothing)
4. **Verify the Create Invoice TDS/round-off bug.** Thirty minutes.

**Next two weeks:**

5. Instrument the existing application and start collecting a baseline.
6. Send the 10 business-rule questions from [07](07-Business-Rule-Inventory.md) to the business owner.
7. Review the census results and price Blocker 4.

**Then:** reconvene with real numbers and make the Phase 0 commitment.

---

*This assessment is based entirely on evidence from the source code in
`E:\nakul\Chintan Kalathiya\AC`. Every finding cites a file and line number. Where
the live database was required and unavailable, the finding is marked `UNKNOWN` and
the script that resolves it is named. **No code has been written, modified or
deleted.***
