# 15 — Performance Targets

> **"PostgreSQL will be faster" is not a target.** This document defines
> measurable numbers, how to establish the baseline they are measured against,
> and how to prove they were met.

---

## 1. There is no baseline today, and that is the first problem

The solution contains **no logging, no telemetry, no APM and no metrics of any
kind**. Nobody currently knows:

- how long any page takes
- how long any API call takes
- which query is slowest
- how many concurrent users the system supports
- what the error rate is
- how large any table is

**Every target below is provisional until a baseline exists.** Establishing it is
the first task of Phase 0, and it takes about a week.

---

## 2. How to establish the baseline

### Step 1 — Instrument the existing .NET app (week 1 of Phase 0)

| Layer | Tool | Captures |
|---|---|---|
| API | Serilog + Seq, or Application Insights | Request duration, status, route, user, correlation id |
| Web | Same | Page render time, downstream API call time |
| EF Core | Command logging with a `>200 ms` threshold | Slow queries with parameters |
| SQL Server | **Enable Query Store** | Per-query duration, CPU, reads, plan history |
| Browser | Real User Monitoring — Sentry, or `web-vitals` to a log endpoint | TTFB, FCP, LCP, INP per screen |

### Step 2 — Run the DMV extraction

[`tools/02-extract-perf-dmv.sql`](tools/02-extract-perf-dmv.sql) after a full
working day of normal load. This gives the measured cost of every query and — from
section 8b — the answer to whether the database has any secondary indexes at all.

### Step 3 — Record the baseline table

After one week of production data, fill this in. **Nothing here can be filled in
today.**

| Metric | p50 | p95 | p99 | Max |
|---|---|---|---|---|
| Login | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Dashboard load | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Supplier invoice list | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| PO list | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Item list | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Search keystroke | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Create invoice (save) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Ledger report | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Excel export | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Excel import (1,000 rows) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |

Also record: **peak concurrent users**, **requests/second at peak**, **DB CPU at
peak**, **DB memory**, **error rate**, **row counts for the 10 largest tables**.

---

## 3. Targets

Two columns matter. **Phase 0** is what the *existing .NET app* should achieve after
stabilisation — this is the number that determines whether the migration is urgent.
**Target** is the end state.

### API response time (server-side, excluding network)

| Endpoint class | Phase 0 (p95) | Target (p95) | Target (p99) |
|---|---|---|---|
| Auth — login | < 500 ms | **< 300 ms** | < 600 ms |
| Reference data (cached) | < 100 ms | **< 20 ms** | < 50 ms |
| Simple read by id | < 300 ms | **< 150 ms** | < 300 ms |
| **Paginated list (50 rows)** | < 800 ms | **< 250 ms** | < 500 ms |
| Search (debounced, paginated) | < 800 ms | **< 300 ms** | < 600 ms |
| Create/update document | < 1,000 ms | **< 500 ms** | < 1,000 ms |
| Bulk approve (50 items) | < 1,500 ms | **< 400 ms** | < 800 ms |
| Report, paginated | < 2,000 ms | **< 800 ms** | < 1,500 ms |
| Dashboard (consolidated) | < 2,000 ms | **< 600 ms** | < 1,200 ms |
| Export (async job) | n/a | **< 2 s to enqueue**, < 60 s to complete | |

### Database query time

| Query class | Target (p95) |
|---|---|
| Indexed single-row lookup | **< 5 ms** |
| Paginated list with joins | **< 50 ms** |
| Aggregate report over 1 FY | **< 200 ms** |
| Dashboard aggregate | **< 150 ms** |
| **Any query** | **< 1,000 ms** — anything slower is logged and investigated |
| **Full table scans on tables > 10,000 rows** | **ZERO** |

### Frontend

| Metric | Phase 0 | Target |
|---|---|---|
| First Contentful Paint | < 2.0 s | **< 1.0 s** |
| Largest Contentful Paint | < 3.5 s | **< 2.0 s** |
| Time to Interactive | < 4.0 s | **< 2.5 s** |
| Interaction to Next Paint | < 300 ms | **< 200 ms** |
| **Initial JS bundle (gzipped)** | < 400 KB | **< 200 KB** |
| Total JS on the heaviest screen | < 600 KB | **< 350 KB** |
| Route transition (cached) | n/a | **< 100 ms** |
| Grid re-render on filter | < 500 ms | **< 150 ms** |

For reference, the current heaviest screen (Create Invoice) loads **210 KB of
application JavaScript alone**, unbundled and uncompressed, on top of jQuery,
Bootstrap, DataTables, Select2, ApexCharts, Chart.js, moment, CKEditor and three
separate notification libraries.

### Capacity

| Metric | Target |
|---|---|
| Concurrent users | **≥ 200** (verify against the measured baseline; likely well above current need) |
| Sustained requests/second | **≥ 100** |
| Peak burst | **≥ 300 rps for 60 s** |
| API instances required at target load | ≤ 2 |
| DB CPU at sustained peak | **< 50%** |
| DB connections in use | **< 60%** of the PgBouncer pool |
| API memory per instance | **< 512 MB** steady state |
| **Error rate (5xx)** | **< 0.1%** |
| Availability | **≥ 99.5%** business hours |

### Data volume assumptions

**All UNKNOWN.** Fill from section 2 of the schema extraction script. Targets above
assume the largest table is in the low millions of rows. **If it is materially
larger, several targets need revision and partitioning enters scope.**

---

## 4. Which targets come from which change

Being explicit, so no one credits PostgreSQL with a win it did not deliver.

| Change | Primary effect | Available in Phase 0? |
|---|---|---|
| **Pagination** | List endpoints go from O(all rows) to O(50). **The single largest win** | ✅ Yes |
| **Indexes** | Seeks instead of scans | ✅ Yes |
| `AsNoTracking` | ~2× less memory and CPU per read | ✅ Yes |
| Fix the 6 bulk-approve full-table loads | Multi-minute → milliseconds | ✅ Yes |
| Batch the 6 N+1 loops | 1+N round-trips → 2 | ✅ Yes |
| Reference-data caching | Removes ~40 redundant fetches per page | ✅ Yes |
| Debounce + request cancellation | 6 requests per search word → 1 | ✅ Yes |
| Bundling, minification, compression | Bundle size, FCP, LCP | ✅ Yes |
| Async all the way down | Removes thread-pool starvation | ✅ Yes |
| **Remove one network hop** (delete the MVC proxy) | ~30-50% of round-trip latency | ❌ Migration only |
| **JSON instead of server-rendered HTML** | No Razor render per keystroke | ❌ Migration only |
| **Filters pushed into SQL** | Removes the in-memory filter passes | ❌ Migration only |
| **SPA route transitions** | Full page loads → client-side navigation | ❌ Migration only |
| Keyset pagination | Deep pages stop degrading | ❌ Migration only |
| Async export jobs | Long exports leave the request path | ❌ Migration only |
| Connection pooling (PgBouncer) | Stable under concurrency | ❌ Migration only |

**The honest summary: the majority of the achievable improvement is available
without migrating.** The migration's performance contribution is real but
secondary — roughly the last 30-40% — and its main justification is
maintainability, security and correctness, not speed.

**This is worth saying plainly to the client**, because it reframes the decision
from "migrate to go faster" to "stabilise to go faster, migrate to stay
maintainable and become secure."

---

## 5. Measurement and enforcement

### Continuous

| What | How |
|---|---|
| API latency by route | OpenTelemetry → Grafana dashboard, p50/p95/p99 |
| DB query performance | `pg_stat_statements`, top 20 by total time, reviewed weekly |
| Slow-query log | `auto_explain` on anything > 500 ms |
| Frontend vitals | RUM per route |
| Error rate | Sentry |

### Gated in CI

```yaml
# Fail the build on regression, not just on failure
- name: k6 performance gate
  run: k6 run --quiet perf/api-smoke.js
  # thresholds:
  #   http_req_duration{route:list}:  ['p(95)<250']
  #   http_req_duration{route:create}:['p(95)<500']
  #   http_req_failed:                ['rate<0.001']

- name: Bundle size gate
  run: npx size-limit    # fails if the main bundle exceeds 200 KB gzipped
```

### Per-release

Full k6 load test at 2× projected peak, against staging loaded with a production
snapshot. Results appended to a trend log so degradation is visible over releases.

---

## 6. Alerting

| Condition | Severity |
|---|---|
| p95 API latency > 2× target for 5 min | **Page** |
| 5xx rate > 1% for 2 min | **Page** |
| DB connections > 80% of pool | **Page** |
| DB CPU > 80% for 10 min | Warn |
| Any query > 5 s | Warn |
| Job queue depth > 100 | Warn |
| Bundle size increased > 10% in a release | Warn |
| p95 latency > 1.5× target for 30 min | Warn |

---

## 7. Reporting to the client

A one-page trend report, monthly, with the same shape throughout the project so
progress is comparable:

```
  PERFORMANCE — month N
  ═══════════════════════════════════════════════════════════
  Screen                Baseline    Now    Target   Status
  ───────────────────────────────────────────────────────────
  Dashboard              UNKNOWN      —    < 2.0 s    —
  Supplier invoice list  UNKNOWN      —    < 1.5 s    —
  Item search            UNKNOWN      —    < 1.0 s    —
  Create invoice save    UNKNOWN      —    < 1.5 s    —
  Ledger report          UNKNOWN      —    < 3.0 s    —
  ───────────────────────────────────────────────────────────
  Error rate             UNKNOWN      —    < 0.1%     —
  Peak concurrent users  UNKNOWN      —      ≥ 200    —
```

**Every row reads UNKNOWN today.** Filling in the Baseline column is the first
deliverable of Phase 0, and it is what makes every subsequent claim of improvement
verifiable rather than asserted.
