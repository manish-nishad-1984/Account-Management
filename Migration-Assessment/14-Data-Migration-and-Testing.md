# 14 — Data Migration & Testing Strategy

---

# PART A — DATA MIGRATION

## 1. Strategy

**Recommended: rehearsed full migration with an incremental delta at cutover.**

Not CDC, not dual-write, for specific reasons:

| Approach | Verdict for this system |
|---|---|
| **Full migration + delta at cutover** | ✅ **RECOMMENDED.** 24 tables. Structural changes (junction tables, document-type discriminator, PO↔Invoice FK resolution) make CDC's row-for-row model a poor fit. A rehearsed load in a maintenance window is simpler and safer |
| Dual-write | ❌ Requires writing to both engines from application code during transition. Doubles the failure surface, and the structural differences mean the two writes are not symmetric |
| CDC (Debezium) | ⚠️ Consider only if the cutover window proves too short. Adds significant operational complexity for a database of this size |
| Trickle + shared read | ❌ Cross-database joins on relationships that are already fragile string matches |

**Sequence:**

```
  1. REHEARSE (repeatedly, from Phase 1 onward)
     Restore a production snapshot → run the ETL → reconcile → measure the clock
     Target: the full load completes in under 4 hours

  2. PARALLEL RUN (Phase 6, ≥4 weeks)
     Both systems live. Nightly delta sync into PostgreSQL.
     Daily reconciliation reports.

  3. CUTOVER
     Freeze writes on .NET → final delta → reconcile → flip the gateway → unfreeze
     Target window: under 2 hours

  4. .NET remains READ-ONLY for 4 weeks. Rollback stays available.
```

## 2. The ETL harness

Not a script. A **repeatable, idempotent, restartable tool**, built in Phase 1 and
run dozens of times before it matters.

**Requirements:**

| Requirement | Why |
|---|---|
| **Idempotent** | Re-runnable without duplicating. `ON CONFLICT DO NOTHING`/`DO UPDATE` |
| **Restartable** | A 4-hour load that fails at hour 3 must resume, not restart |
| **Table-ordered** | Follows the FK dependency tiers in [04 §7](04-Database-Inventory.md) |
| **Quarantine, never silently drop** | Every rejected row goes to a `_quarantine` table with the reason. **A row that vanishes without explanation is the worst possible outcome** |
| **Reconciliation built in** | Emits the report described in §4 as part of every run |
| **Timed and logged** | Per-table row counts and durations, so the cutover window can be predicted |

## 3. Conversions requiring care

| # | Conversion | Approach | Hazard |
|---|---|---|---|
| 1 | **`User.SiteId`/`CompanyId` CSV → junction tables** | `string_to_array` + `unnest`, guarded by `EXISTS` against the target table | Fragments that are not valid GUIDs are **silently dropped today**. Log them — they are already-broken access grants |
| 2 | **Plaintext passwords → hashes** | Migrate the value into a `legacy_password` column. On first successful login, hash with argon2id and null the legacy column. Force-reset anything unmigrated after one cycle | ⚠️ **Passwords are capped at 20 chars today.** Users may need to set longer ones |
| 3 | **Document-number sentinels → `document_type`** | `'PayOut'`/`'PayIn'`/`'Opening Balance'` become enum values; `invoice_no` set NULL for them | **The unique constraint cannot be created until this is done** |
| 4 | **`SupplierInvoice.POId` text → `purchase_order_id uuid`** | Join on trimmed, upper-cased text | Expect partial matches. **Quarantine and report the unmatched** — those are POs whose invoices the system currently believes are unfulfilled |
| 5 | **`SiteGroup` name text → `group_id`** | Same shape | Fuzzy. Consider deferring to phase 2 |
| 6 | **Nullable `bit` → `boolean NOT NULL`** | Backfill `NULL → false` | ⚠️ **Rows currently hidden from users become visible.** Count before/after; get business sign-off |
| 7 | **Nullable money → `NOT NULL DEFAULT 0`** | Backfill, then **re-run header/line reconciliation** | The NULLs were being skipped by `SUM()`. Totals may not reconcile afterwards |
| 8 | **Identity sequences** | `setval()` after load, for all 10 | **Skipping this breaks the first insert on each table** |
| 9 | **Datetime → timestamptz** | Explicit `AT TIME ZONE 'Asia/Kolkata'` | **Do not let the driver guess.** Business dates stay `date` |
| 10 | **Collation / case sensitivity** | Per-column decision — `citext` or `lower()` indexes | Highest risk on `user_name`, `email`, and document numbers matched by string equality |
| 11 | **Orphan remediation** | Quarantine, repair, or delete before adding FKs | **The schedule's biggest variable** |
| 12 | **`ItemName varchar(50)` → `varchar(100)`** | Widen. Check whether truncation already occurred | Data already lost cannot be recovered |

## 4. Verification: proving MSSQL data = PostgreSQL data

**Five layers. All must pass before cutover.**

### Layer 1 — Row counts

```sql
-- Per table, per soft-delete state. Must match EXACTLY.
SELECT 'supplier_invoice' AS tbl, is_deleted, count(*) FROM supplier_invoice GROUP BY is_deleted;
```
⚠️ Where the NULL-boolean backfill applies, the counts will differ **by a known,
signed-off amount**. Record it explicitly; do not let it hide a real discrepancy.

### Layer 2 — Financial aggregates (the ones that matter most)

```sql
-- Per company, per financial year. These MUST match to the paisa.
SELECT company_id,
       sum(total_amount)     AS total,
       sum(total_gst_amount) AS gst,
       sum(tds)              AS tds,
       count(*)              AS docs
FROM   supplier_invoice
WHERE  is_deleted = false AND document_type = 'invoice'
GROUP  BY company_id;
```

Run the equivalent on SQL Server and diff. **Any difference in a financial
aggregate blocks cutover** until explained.

Repeat for: sales invoices, purchase orders, supplier ledger balances per supplier,
customer balances, inward quantities per item.

### Layer 3 — Row-level checksums

```sql
SELECT md5(string_agg(
         id::text || '|' || coalesce(invoice_no,'') || '|' ||
         total_amount::text || '|' || invoice_date::text, '|'
         ORDER BY id)) AS fingerprint
FROM supplier_invoice WHERE is_deleted = false;
```
Compare against a `HASHBYTES`-based equivalent on SQL Server. A mismatch triggers a
binary-search diff to locate the differing rows.

### Layer 4 — Referential integrity

```sql
-- Must return zero rows for every relationship, on the target.
SELECT count(*) FROM supplier_invoice_detail d
LEFT JOIN supplier_invoice i ON i.id = d.supplier_invoice_id
WHERE i.id IS NULL;
```
Trivially true once the FKs are in place — which is the point. Run it anyway as a
regression check.

### Layer 5 — Business reconciliation (the one that catches real problems)

```sql
-- Header totals vs the sum of their lines.
SELECT count(*) AS mismatched
FROM   supplier_invoice i
CROSS  JOIN LATERAL (SELECT sum(total_amount) t FROM supplier_invoice_detail d
                     WHERE d.supplier_invoice_id = i.id) x
WHERE  abs(i.total_amount - coalesce(x.t,0)) > 0.01;
```

⚠️ **Run this against SQL Server FIRST, before migrating.** Because money is
currently computed in the browser and stored unverified, **there may already be
mismatched rows in production.** If so, that is pre-existing corruption, not a
migration defect — and it must be documented as a known baseline so it is not
mistaken for one.

### The reconciliation report

Every ETL run emits:

```
  MIGRATION RECONCILIATION — 2026-08-27 14:22 — run 47
  ══════════════════════════════════════════════════════════════
  Table                    MSSQL      PG    Diff  Checksum  Status
  ──────────────────────────────────────────────────────────────
  company                     14      14       0   MATCH     ✓
  site                       128     128       0   MATCH     ✓
  supplier_master          1,204   1,204       0   MATCH     ✓
  item_master              8,331   8,331       0   MATCH     ✓
  purchase_order          12,441  12,441       0   MATCH     ✓
  supplier_invoice        31,207  31,207       0   MATCH     ✓
  supplier_invoice_detail 198,332 198,201    -131  DIFFER    ⚠ QUARANTINED
  ──────────────────────────────────────────────────────────────
  QUARANTINE
    supplier_invoice_detail  131 rows  reason=orphan_parent  → _q_sid

  FINANCIAL AGGREGATES
    supplier_invoice total    ₹ 48,221,340.55 = ₹ 48,221,340.55   ✓
    sales_invoice total       ₹ 31,008,772.10 = ₹ 31,008,772.10   ✓

  BEHAVIOUR CHANGES (signed off 2026-08-15)
    is_deleted NULL→false: 47 rows now visible (was hidden)
    money NULL→0:          12 rows

  DURATION 2h 41m — within the 4h cutover budget
```

**The quarantine line is the point.** Nothing disappears silently.

## 5. Rollback

| Stage | Rollback |
|---|---|
| Any phase before cutover | Gateway rule reverts. Both systems intact |
| Cutover window | Flip the gateway back. PostgreSQL writes since the flip are discarded (minutes) |
| Post-cutover, ≤4 weeks | .NET is read-only but intact. Reverting requires replaying PostgreSQL writes back to SQL Server — **rehearse this once, on staging, before cutover** |
| After decommission | Restore from the retained snapshot. **Keep it 12 months** |

---

# PART B — TESTING STRATEGY

## 6. Test layers

| Layer | Tool | Coverage target | What it protects |
|---|---|---|---|
| **Unit** | Vitest | **`packages/domain`: 100%** | The money calculator, FY parsing, document numbering. **Non-negotiable** |
| **Integration** | Vitest + Testcontainers | Every repository | Real PostgreSQL, real transactions, real constraints |
| **API contract** | Supertest + Zod | Every endpoint | Request/response shape, status codes, error format |
| **Authorization** | Supertest | **Every endpoint × every role** | **Directly targets finding C-7.** Plus a test that enumerates all routes and fails on any without a permission or `@Public()` |
| **Business rule** | Vitest | Every rule in [07](07-Business-Rule-Inventory.md) | The rules survive |
| **Data migration** | The reconciliation harness | Every table | See Part A |
| **Regression / parallel** | Custom comparison harness | Critical flows | **The primary safety net.** See §8 |
| **UI component** | Testing Library | Shared components | `LineItemGrid` especially |
| **E2E** | Playwright | ~15 critical journeys | Create invoice, approve PO, run report |
| **Performance** | k6 | Top 20 endpoints | Against the [15](15-Performance-Targets.md) targets |
| **Load** | k6 | Peak concurrency ×2 | |
| **Security** | OWASP ZAP, `npm audit`, Semgrep | Whole surface | |
| **UAT** | Manual, by real users | All screens | Parallel run |

## 7. Characterisation tests — start here, in Phase 0

**Before any code is written, capture what the system does today.**

```typescript
// Generated from production invoices, not hand-written.
describe('legacy invoice totals — characterisation', () => {
  test.each(loadProductionSample(5000))(
    'invoice %s reproduces its stored total',
    ({ invoiceNo, lines, tds, roundOff, storedTotal }) => {
      const computed = calculateInvoiceTotals(lines, tds, roundOff);
      expect(computed.total.toNumber()).toBeCloseTo(storedTotal, 2);
    }
  );
});
```

**These are the specification.** The business rules exist nowhere else in writing.

Expect failures — that is the value. Each one is either:
- a **rounding-order difference** → adjust the calculator to match, or
- a **pre-existing data defect** → document it, exclude it, report the count, or
- **the TDS/round-off bug from [07 D-JS-1](07-Business-Rule-Inventory.md)** → confirmed
  with evidence, and the business decides the remediation

**Target: ≥99.5% of a 5,000-invoice sample reproduces within ±0.01, with every
exception categorised.** That number, and the exception list, are what gets signed off.

## 8. Old vs new comparison harness

The most important testing artefact in the project.

```
  ┌──────────────┐   same request    ┌──────────────┐
  │  .NET API    │◄──────┬──────────►│  Node API    │
  │  SQL Server  │       │           │  PostgreSQL  │
  └──────┬───────┘       │           └───────┬──────┘
         │      ┌────────┴────────┐          │
         └─────►│   COMPARATOR    │◄─────────┘
                │  normalise      │
                │  (key order,    │
                │   casing, tz,   │
                │   nulls)        │
                │  deep diff      │
                │  money: ±0.01   │
                └────────┬────────┘
                         ▼
                  differences report
```

**Two modes:**

**Read comparison (automated, continuous from Phase 2).** Replay production read
traffic against both systems nightly; diff the responses. Any unexplained
difference is a bug in the new system.

**Write comparison (Phase 4, for invoicing).** Create the same document in both
systems from the same input; compare the persisted rows and the computed totals.

**Cutover gate:** *every invoice created in the new system for four consecutive
weeks reconciles exactly against the same document created in the old system, or
every difference is documented and signed off.*

## 9. Priority test scenarios

Derived from the business-rule inventory. Each targets a known defect.

| # | Scenario | Targets |
|---|---|---|
| 1 | Two users request an invoice number **simultaneously** | D1-D4 race → must get distinct numbers |
| 2 | Create an invoice **on 15 April** | The FY off-by-one → must be the new FY |
| 3 | Create the **1,000th invoice** of a year | The `D3` wrap |
| 4 | Kill the process **between header and line writes** | The two-commit gap → must roll back atomically |
| 5 | Post a **Purchase Return**, then read the supplier balance | D7 → must be **subtracted** |
| 6 | POST an invoice with a **tampered `TotalAmount`** | Must be **rejected**, not stored |
| 7 | Invoice with **discount + TDS + round-off** | The Create Invoice global-collision bug → all three must apply |
| 8 | PO containing the **same item twice at the same quantity** | D10 grouping → ordered quantity must be correct |
| 9 | **Over-invoice** a PO | Negative pending → decide: block or warn |
| 10 | A **view-only user** calls an approve endpoint directly | C-7 → must be **403** |
| 11 | An **unauthenticated** call to the permission endpoints | C-6 → must be **401** |
| 12 | A user requests an entity **outside their site scope** | H-1 IDOR → must be **403/404** |
| 13 | **"Between year" report** for `2024-25` | D22a → must return data, not an empty set |
| 14 | **50,000-row Excel import** | Must not time out; must report per-row errors |
| 15 | User with **no permission rows** logs in | D28 → must not silently lose sites and companies |
| 16 | Two users **edit the same invoice** concurrently | No concurrency token today → must detect the conflict |
| 17 | **Re-create a soft-deleted item** | D19 → confirm the agreed behaviour |
| 18 | Delete a site with **active users** | D15 → must be blocked |

## 10. Test data

| Environment | Data |
|---|---|
| Local | Seeded fixtures, ~100 rows/table |
| CI | Same fixtures via Testcontainers |
| **Staging** | **A restored production snapshot** (anonymised: names, phone numbers, GSTINs, addresses). **Real volume is essential** — several risks in this pack are only visible at scale |
| Performance | Staging data, or synthetic data at **2× projected volume** |

⚠️ **Anonymisation must preserve:** row counts, cardinality, date distribution,
**all money values exactly**, and the orphan patterns — otherwise the reconciliation
harness tests something other than reality.

## 11. Definition of done, per module

A module is complete when **all** hold:

- [ ] Unit tests pass; `packages/domain` at 100%
- [ ] Integration tests pass against real PostgreSQL
- [ ] **Every endpoint has an authorization test for every role**
- [ ] Every relevant business rule from [07](07-Business-Rule-Inventory.md) has a passing test
- [ ] The read-comparison harness reports **no unexplained differences** for 7 days
- [ ] Performance targets from [15](15-Performance-Targets.md) are met under load
- [ ] Security scan is clean
- [ ] UAT signed off by a real user of that module
- [ ] Logs, traces and metrics are visible in the observability stack
- [ ] Rollback has been **rehearsed**, not merely documented
