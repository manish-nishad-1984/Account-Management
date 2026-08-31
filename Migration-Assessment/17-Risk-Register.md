# 17 — Risk Register

**Scoring:** Likelihood (L) and Impact (I) 1-5. Score = L × I.
**Red ≥ 15 · Amber 8-14 · Green ≤ 7.**

---

## Critical risks (score ≥ 15)

---

### R-01 · Business rules are undocumented and exist only in code — some of it browser JavaScript
**L 5 · I 5 · Score 25 · 🔴**

The tax, discount, TDS and round-off rules the business runs on live in jQuery, are
untested, and **differ between three screens**. `Math.Round` and `CGST`/`SGST`/`IGST`
appear **zero times** in the C# codebase.

**If realised:** the migrated system computes different invoice totals. Discovered
weeks later, in production, on documents already issued to suppliers and customers.

**Mitigation**
- ✅ **Phase 0 gate.** Extract every rule ([07](07-Business-Rule-Inventory.md) is the start) and get written business sign-off on all 10 open questions.
- ✅ **Characterisation tests against ≥5,000 production invoices before any code is written.** Target ≥99.5% reproduction within ±0.01, with every exception categorised.
- ✅ One shared calculator in `packages/domain`, used by both tiers.
- ✅ Parallel-run write comparison for 4 weeks before cutover.

**Owner:** Tech lead + business analyst · **Residual: Medium**

---

### R-02 · Referential-integrity violations are unmeasured and could be extensive
**L 4 · I 5 · Score 20 · 🔴**

~62 reference columns have no FK, including all four master/detail spines, two of
which permit a NULL parent. **PostgreSQL will refuse to create these constraints
until every orphan is resolved.**

**If realised:** Phase 1 overruns by weeks or months. Worse, remediation forces
business decisions about historical records nobody can now explain.

**Mitigation**
- ✅ **Run [`tools/03-orphan-and-duplicate-census.sql`](tools/03-orphan-and-duplicate-census.sql) BEFORE committing to any timeline.** This risk is unpriced until then.
- ✅ Quarantine, never silently drop.
- ✅ Load FKs `NOT VALID`, then `VALIDATE` — so loading is not blocked by validation.
- ✅ Hold 30% schedule contingency in Phase 1 until the census result is known.

**Owner:** Data lead · **Residual: after the census, Low-Medium**

---

### R-03 · Money precision drift — server-side `decimal` will not reproduce every historical total
**L 5 · I 4 · Score 20 · 🔴**

Legacy totals are IEEE-754 doubles with per-line `.toFixed(2)` **then summed** —
not sum-then-round. Any faithful server-side implementation will differ on some rows.

**If realised:** invoices reprint with different totals from the ones issued. In a
GST context that is a compliance and customer-trust problem, not a rounding curiosity.

**Mitigation**
- ✅ **Replicate the rounding ORDER deliberately** — round per line, then sum. Document it as a behavioural contract, comment it in the code so nobody "fixes" it later.
- ✅ Reconcile every historical document; produce a signed-off exception list.
- ✅ **Never recompute historical documents.** Stored totals are immutable records. Only new documents use the new calculator.
- ✅ Business sign-off on the tolerance before Phase 4.

**Owner:** Tech lead + finance · **Residual: Low, with the immutability rule**

---

### R-04 · A live production bug may mean invoices have been computed without TDS and round-off
**L 3 · I 5 · Score 15 · 🔴**

`CreateInvoice.cshtml:896-898` loads three JS modules whose identically-named globals
collide. The PO formulas (no discount, no TDS, no round-off) overwrite the Invoice
formulas.

**If realised:** an unknown volume of historical purchase invoices are wrong. This
is a **current** exposure, not a migration risk.

**Mitigation**
- ✅ **Verify against production behaviour this week.** It takes thirty minutes.
- ✅ If confirmed: quantify the affected range, inform the business immediately, and agree remediation **before** it becomes a migration question.
- ✅ Either way, the shared calculator removes the class of defect permanently.

**Owner:** Tech lead · **Priority: immediate**

---

### R-05 · Critical security exposures are live right now
**L 5 · I 5 · Score 25 · 🔴**

Plaintext passwords · the API returns them over HTTP · `sa` credentials and the JWT
key in source control · two **unauthenticated** endpoints that grant administrator
rights · no per-endpoint authorization at all.

**If realised:** total compromise. And it is not hypothetical — the credentials are
in a git repository and in five copies of a checked-in publish folder.

**Mitigation**
- ✅ **This week:** rotate `sa` + the two commented-out credentials + the JWT key. Add `[Authorize]` to `FormPermissionMasterController`. Remove `Password` from the `GetUserById` response. Delete the "Remember me" password cookie.
- ✅ Purge secrets from git history; add `gitleaks`; remove `Publish/` from source control.
- ✅ Firewall port 1433 to the application subnet.
- ✅ Target architecture: default-deny guards + a CI route-coverage test.

**Owner:** Tech lead · **Priority: immediate, independent of the migration**

---

## High risks (score 8-14)

---

### R-06 · Scope creep — "while we're rewriting it, can we also…"
**L 5 · I 3 · Score 15 · 🔴**

The assessment surfaced genuinely missing capability: no stock-on-hand tracking, no
PR→PO conversion, no payment-to-invoice allocation, no approval workflow beyond a
single boolean, no e-invoicing. All are reasonable asks. **None is migration.**

**Mitigation**
- ✅ **Written scope: functional parity, plus the defect fixes explicitly agreed in [07](07-Business-Rule-Inventory.md). Nothing else.**
- ✅ Maintain a visible "Phase 2 — new features" backlog so requests are captured, not argued about.
- ✅ Every new-feature request is estimated separately and needs explicit approval.

**Owner:** Project sponsor · **Residual: Medium — requires ongoing discipline**

---

### R-07 · The `LineItemGrid` is built three times instead of once
**L 3 · I 4 · Score 12 · 🟠**

Four screens depend on it. It is where all the money arithmetic lives. The legacy
code already made this mistake — three divergent JS implementations exist today.

**Mitigation**
- ✅ Build it **once**, in Phase 4, against the **hardest** case (Purchase Invoice — the full superset with discount + TDS + round-off), then reuse.
- ✅ Feature flags, not forks, for the PO and Sales variants.
- ✅ Architectural review gate before PO and Sales work begins.

**Owner:** Tech lead · **Residual: Low**

---

### R-08 · Schema drift — the EF model may not match the live database
**L 3 · I 4 · Score 12 · 🟠**

Three clues in `DbaccManegmentContext.cs` (`PK_Users` on table `User`, `PK_Form_1`,
`PK_PODelevryAddress`) indicate the schema has been renamed and recreated over time.
**Sections of [04](04-Database-Inventory.md) and [09](09-MSSQL-to-PostgreSQL-Mapping.md)
depend on the model being accurate.**

**Mitigation**
- ✅ **Re-scaffold against the live DB and diff, as step one of Phase 1.**
- ✅ Run the schema extraction script.
- ✅ Treat any drift as a finding that invalidates the affected analysis and re-do it.

**Owner:** Data lead · **Residual: Low once verified**

---

### R-09 · Team ramp-up on an unfamiliar stack
**L 3 · I 4 · Score 12 · 🟠**

The team's expertise is .NET. NestJS, Drizzle, React and TanStack Query are all new.

**Mitigation**
- ✅ **NestJS chosen partly for this** — DI, decorators and controller/service/repository map directly onto ASP.NET Core.
- ✅ Phases 1-2 are deliberately the lowest-risk modules; treat them as paid learning.
- ✅ Pair programming and mandatory review in Phase 1.
- ✅ Consider a senior Node/React contractor for the first three months.
- ✅ ADRs (architecture decision records) from day one, so decisions are not re-litigated.

**Owner:** Engineering manager · **Residual: Medium**

---

### R-10 · Parallel-run maintenance burden
**L 4 · I 3 · Score 12 · 🟠**

Both systems live for months. Bug fixes may need applying twice; data must stay
synchronised.

**Mitigation**
- ✅ **Freeze feature work on .NET** once its module has migrated; bug fixes only.
- ✅ Once a module is live on Node, the .NET screens for it go **read-only**.
- ✅ Automate the nightly delta sync and the daily reconciliation report.
- ✅ Time-box the parallel run to 4-6 weeks per module.

**Owner:** Tech lead · **Residual: Medium**

---

### R-11 · Users reject the new UI
**L 3 · I 3 · Score 9 · 🟠**

Enabling pagination on the three report grids is a **visible behaviour change** —
users currently see everything on one screen and will notice its absence.

**Mitigation**
- ✅ Involve real users from Phase 2; do not save UAT for the end.
- ✅ Keep routes and screen names familiar; keep the visual language neutral (Mantine, not a strong brand).
- ✅ **Explain the pagination change early and explicitly**, with the performance benefit stated.
- ✅ Keep "export everything" available as an async job, so the underlying need is still met.

**Owner:** Product owner · **Residual: Low**

---

### R-12 · Cutover window overruns
**L 3 · I 4 · Score 12 · 🟠**

Estimated at under 2 hours; unvalidated until row counts are known.

**Mitigation**
- ✅ **Rehearse on staging with a full production snapshot, repeatedly, from Phase 1.**
- ✅ Measure the load time on every rehearsal; track the trend.
- ✅ Make the ETL restartable, so a failure at hour 3 resumes rather than restarts.
- ✅ Cut over on a weekend with a rehearsed rollback.
- ✅ If the window cannot be met, escalate to CDC — a known, costed fallback.

**Owner:** Data lead · **Residual: Low after rehearsal**

---

### R-13 · Duplicate document numbers already exist in production
**L 3 · I 4 · Score 12 · 🟠**

The numbering is racy and unconstrained. The unique constraints the target needs
**cannot be created until duplicates are resolved.**

**Mitigation**
- ✅ Part D of the census script measures it.
- ✅ Duplicate GST invoice numbers are a **compliance matter** — escalate to the business, do not resolve technically.
- ✅ Seed `document_counter` from `MAX + 1` per (company, kind, FY).
- ✅ **Widen the format from `D3` to `D5`** so it does not wrap at 999.

**Owner:** Data lead + finance · **Residual: depends on the census**

---

## Medium risks (score 5-7)

| # | Risk | L | I | Score | Mitigation |
|---|---|---|---|---|---|
| R-14 | Case-sensitivity change breaks logins and searches | 3 | 2 | 6 | Confirm the source collation; `citext` on `user_name`/`email`; test with mixed-case production data |
| R-15 | Excel import performance regresses at scale | 2 | 3 | 6 | ExcelJS streaming + BullMQ; test at 50,000 rows (the current one times out) |
| R-16 | Print/PDF layouts do not match the originals | 2 | 3 | 6 | Keep print server-rendered; pixel-diff against reference PDFs in CI |
| R-17 | The 4 unmapped entity classes hold live data | 2 | 3 | 6 | Row-count them in the census before deciding to drop |
| R-18 | Stakeholders expect the migration alone to fix performance | 3 | 2 | 6 | **[15](15-Performance-Targets.md) states explicitly that most of the win is available in Phase 0.** Report the Phase 0 improvement prominently |
| R-19 | Timezone handling changes business dates | 2 | 3 | 6 | Business dates stay `date`; only audit columns become `timestamptz` |
| R-20 | Key person dependency | 2 | 3 | 6 | ADRs, pairing, documentation as a definition-of-done item |
| R-21 | The NULL→false boolean backfill surfaces rows users have not seen for years | 3 | 2 | 6 | Count and show them to the business **before** backfilling; get sign-off |

---

## Watch list

| Item | Trigger for escalation |
|---|---|
| Row counts unknown | If any table exceeds ~10 M rows, revisit partitioning, the cutover window and several targets in [15](15-Performance-Targets.md) |
| Index situation unknown | If the DB genuinely has **no** secondary indexes, Phase 0's win is much larger — and the migration becomes less urgent |
| Stored procedures / triggers unknown | If any exist and carry logic, [07](07-Business-Rule-Inventory.md) is incomplete and Phase 0 must extend |
| .NET 6 libraries past end of support | A security advisory would force an urgent upgrade mid-project |
| No CI/CD pipeline found | If deployment is manual VS publish over FTP, that is a release-risk item in its own right |

---

## The five that matter most

If only five things are actively managed, these:

| | Risk | Why |
|---|---|---|
| **1** | **R-05 — live security exposures** | Not a project risk. A **current** one. Days to fix |
| **2** | **R-01 — undocumented business rules** | Without the specification there is nothing to build against |
| **3** | **R-02 — unmeasured orphan volume** | The schedule cannot be committed until this is known. One script |
| **4** | **R-03 — money precision drift** | Determines whether the business trusts the new system |
| **5** | **R-06 — scope creep** | The most common cause of migration failure, and the easiest to prevent with a written scope |

**Three of the five are resolved by running scripts and asking questions**, not by
writing code. That is the strongest argument for the Phase 0 gate.
