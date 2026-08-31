# 12 — Target Architecture

---

## 1. The recommended end state

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                  CLIENTS                                        │
│   Desktop browser · Tablet (site staff) · Mobile browser                        │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ HTTPS
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  CDN / STATIC HOSTING            (Cloudflare, Netlify, Vercel or nginx)          │
│  ─ React SPA build artefact: hashed, immutable, gzip + brotli                   │
│  ─ Solves the current 511 KB unbundled-JS problem outright                      │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ /api/v1/*
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  REVERSE PROXY / API GATEWAY     (nginx or Caddy)                               │
│  ─ TLS termination · HSTS · HTTP/2                                              │
│  ─ Rate limiting (global + per-IP + strict on /auth/login)                       │
│  ─ Request size limits · response compression                                    │
│  ─ ◄── DURING MIGRATION: routes /api/v1/* to Node, everything else to the        │
│         existing .NET app. This is the strangler-fig seam.                       │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  API — Node.js 22 LTS + TypeScript + NestJS          (2+ instances, stateless)   │
│                                                                                 │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │ CROSS-CUTTING (all global — none of this exists today)                   │  │
│   │   JwtAuthGuard  APP_GUARD   ← DEFAULT DENY, @Public() to opt out         │  │
│   │   PermissionGuard           ← @RequirePermission('invoice:approve')      │  │
│   │   SiteScopeInterceptor      ← injects caller's site/company into queries │  │
│   │   ZodValidationPipe         ← every request body                         │  │
│   │   TransactionInterceptor    ← unit of work per command                   │  │
│   │   Pino logger + correlation id · Helmet · CORS allow-list                │  │
│   │   Global exception filter → RFC 9457 Problem Details                     │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│   Controllers (thin)  →  Services (business rules, transactions)                │
│                          →  Repositories (Drizzle queries)                      │
└───────┬──────────────────────┬──────────────────────┬───────────────────────────┘
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐    ┌──────────────────┐    ┌─────────────────────────────┐
│  PostgreSQL   │    │  Redis           │    │  Object storage             │
│  17           │    │  ─ reference     │    │  S3 / MinIO / Spaces        │
│  ─ primary    │    │    data cache    │    │  ─ inward documents         │
│  ─ read       │    │  ─ session/      │    │  ─ Excel uploads            │
│    replica    │    │    refresh store │    │  ─ generated PDFs           │
│    (later)    │    │  ─ BullMQ queue  │    │  ─ served via signed URLs,  │
│               │    │    backing       │    │    NEVER from the web root  │
│  via PgBouncer│    └────────┬─────────┘    └─────────────────────────────┘
└───────────────┘             │
                              ▼
                  ┌──────────────────────────────┐
                  │  WORKER (BullMQ)             │
                  │  ─ Excel import (streamed)   │
                  │  ─ Excel / PDF export        │
                  │  ─ Scheduled reports (future)│
                  │  Same codebase, separate     │
                  │  process. Nothing like this  │
                  │  exists today — imports run  │
                  │  inline in the HTTP request  │
                  └──────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│  OBSERVABILITY  (none of this exists today — build it FIRST)                     │
│   Logs    → Pino JSON → Loki / CloudWatch / Better Stack                         │
│   Traces  → OpenTelemetry → Tempo / Jaeger    (HTTP → service → SQL)             │
│   Metrics → Prometheus → Grafana                                                 │
│   Errors  → Sentry (API and browser)                                             │
│   DB      → pg_stat_statements + auto_explain                                    │
│   Uptime  → /health/live, /health/ready                                          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component-by-component rationale

### React SPA on a CDN
Static, hashed, immutable assets with long cache lifetimes. Directly replaces the
current situation — 29 render-blocking script tags, no bundling, no minification,
no compression, and a ~500 KB editor loading on every screen for one screen's
benefit. This is a large perceived-performance win that costs nothing beyond
adopting a build step.

### Reverse proxy / gateway
During migration this is **the strangler-fig seam**. One nginx config decides which
requests reach the new Node API and which still reach the .NET app. Modules move
across by changing routing rules, and roll back the same way.

Permanently, it provides TLS, HSTS, compression, request limits and the rate
limiting that does not exist anywhere today.

### NestJS API, stateless, ≥2 instances
Stateless matters: the current Web tier keeps `UserId`, `SiteId`, `CompanyId`, the
JWT and the entire permission matrix in **server session**, which prevents
horizontal scaling. Moving that into the token and client state makes the API
freely scalable.

**The global guards are the architectural answer to finding C-6** — the two
unauthenticated endpoints that grant administrator rights. With `APP_GUARD`,
forgetting a decorator produces a **401, not a security hole**.

### PostgreSQL 17 behind PgBouncer
Node's connection model makes a pooler more valuable than it is for .NET. PgBouncer
in **transaction mode** lets many application instances share a small number of
backend connections. Add a **read replica later**, once measurements justify it —
not on day one.

### Redis
Three jobs, none of which has any equivalent today:
1. **Reference-data cache** — `Countries`, `States`, `Cities`, `Units`, `Forms`
   currently hit SQL Server on every request.
2. **Refresh-token store** — enables real revocation, which JWTs alone cannot give.
3. **BullMQ backing** for the job queue.

### BullMQ worker
Excel imports currently run **synchronously inside the HTTP request**, are N+1, and
abort on the first bad row. A 50,000-row upload will time out. Moving them to a
worker with progress reporting and a per-row error report is both a performance and
a usability fix.

### Object storage
User uploads are currently written into `wwwroot/` and **served directly from the
web root** with no validation. Moving them to object storage behind signed URLs
closes finding H-9, and removes local disk as a scaling constraint.

### Observability
**Build this first, before any optimisation.** There is currently no logging, no
tracing, no metrics and no error reporting anywhere in the solution. Without it,
nobody can prove which query is slow, whether a fix worked, or that the migrated
system behaves like the old one.

---

## 3. Request lifecycle

```
  1. Browser        GET /api/v1/purchase-invoices?companyId=…&cursor=…&limit=50
                    Authorization: Bearer <15-min access token>
                          │
  2. Gateway        TLS · rate limit · compression · correlation id
                          │
  3. JwtAuthGuard   verify RS256 · check perm_v · reject on failure   ← DEFAULT DENY
                          │
  4. PermissionGuard  @RequirePermission('purchase-invoice:view')
                          │
  5. ScopeInterceptor injects user.companyIds / user.siteIds into the request ctx
                          │
  6. ZodValidationPipe validates and coerces the query parameters
                          │
  7. Controller     thin — delegates immediately
                          │
  8. Service        cache lookup → repository
                          │
  9. Repository     ONE Drizzle query:
                      · explicit column list (no SELECT *)
                      · filters IN SQL, including the scope
                      · keyset pagination: WHERE (date,id) < cursor ORDER BY … LIMIT 51
                      · a SECOND query for the line items of the returned ids
                          │
 10. PostgreSQL     index seek. pg_stat_statements records it
                          │
 11. Interceptor    { data, meta: { nextCursor, total } }
                          │
 12. Pino           one structured log line: correlation id, user, route, ms, rows
```

Compare with today's path for the same screen: browser → MVC (Razor) → HTTP →
API → repository → **unpaged 6-table join returning every invoice** → back through
two tiers → **four in-memory filter passes in the MVC controller** → Razor renders
every row as HTML → `$('#tbl').html(...)`.

---

## 4. Deployment topology

### Production
```
                        ┌─────────────────┐
       Internet ────────►  CDN (static)   │  React build
                        └─────────────────┘
                        ┌─────────────────┐
       Internet ────────►  nginx / Caddy  │  TLS · rate limit · routing
                        └────────┬────────┘
                     ┌───────────┴───────────┐
                     ▼                       ▼
              ┌─────────────┐         ┌─────────────┐
              │ API node 1  │         │ API node 2  │   Docker, stateless
              └──────┬──────┘         └──────┬──────┘
                     └───────────┬───────────┘
                     ┌───────────┴───────────┐
                     ▼                       ▼
              ┌─────────────┐         ┌─────────────┐
              │  PgBouncer  │         │    Redis    │
              └──────┬──────┘         └──────┬──────┘
                     ▼                       ▼
              ┌─────────────┐         ┌─────────────┐
              │ PostgreSQL  │         │   Worker    │
              │  primary    │         │  (BullMQ)   │
              │      │      │         └─────────────┘
              │      ▼      │
              │  replica    │  ← add later, when measurements justify it
              └─────────────┘
```

### Environments

| | Development | Staging | Production |
|---|---|---|---|
| Frontend | Vite dev server | CDN preview | CDN |
| API | `nest start --watch` | 1 container | 2+ containers |
| Database | Docker PostgreSQL | **A restored production snapshot** | Managed PostgreSQL with PITR |
| Redis | Docker | 1 instance | 1 instance (+ replica later) |
| Storage | MinIO (Docker) | Bucket | Bucket + lifecycle rules |
| Secrets | `.env` (gitignored) | Secret manager | Secret manager |
| Observability | Console | Full stack | Full stack + alerting |

**Staging must run on a restored production snapshot.** Two of the biggest
unknowns in this project — the orphan census and whether server-side `decimal`
reproduces historical totals — can only be answered against real data at real
volume.

---

## 5. Data flow: creating a purchase invoice

Contrast with today at every step.

```
 1. React    LineItemGrid computes a PREVIEW total via packages/domain/invoice-calculator
             (Today: the browser computes the FINAL total and the server stores it verbatim)

 2. Submit   POST /api/v1/purchase-invoices
             Idempotency-Key: <uuid>          (Today: no idempotency — double-submit = duplicate invoice)
             Body: header + lines. NO totals.  (Today: totals are sent and trusted)

 3. Guard    Auth → permission → company/site scope   (Today: any valid JWT can do anything)

 4. Zod      Validate and coerce                       (Today: NO server-side validation exists)

 5. Service  BEGIN TRANSACTION                         (Today: ZERO transactions in the codebase)
               a. allocateNumber() — atomic counter    (Today: read-max+1, racy, can duplicate a GST number)
               b. calculateInvoiceTotals() in decimal  (Today: does not exist server-side)
               c. INSERT header
               d. INSERT lines (one statement)
               e. audit row
             COMMIT                                    (Today: two separate commits; a crash between
                                                        them leaves a header with no line items)

 6. Response { data: { id, invoiceNo, totals } }
             Server-computed totals returned so the client displays the authoritative value

 7. Client   TanStack Query invalidates ['purchaseInvoices']   (Today: location.reload())

 8. Log      One structured line + a trace span
```

---

## 6. What is deliberately NOT in this architecture

| Not included | Why |
|---|---|
| **Microservices** | 24 tables, one bounded context, a small team. A modular monolith is correct. Microservices would add distributed-transaction problems to a system that currently has no transactions at all |
| **Kubernetes** | Two API containers and a worker. Docker Compose or a managed container service is sufficient. Revisit at genuine scale |
| **GraphQL** | Conventional REST access patterns. It would add a layer to solve a problem this system does not have |
| **Event sourcing / CQRS** | Enormous complexity for no current requirement |
| **A message broker beyond Redis** | BullMQ on Redis covers every job this system needs |
| **A read replica on day one** | Add it when measurements justify it. Adding it early hides the query problems instead of fixing them |
| **Materialised views on day one** | Only if the dashboard is still slow after proper indexing and caching. See [15](15-Performance-Targets.md) |
| **PostgreSQL partitioning** | Only if a table genuinely exceeds tens of millions of rows. **UNKNOWN until row counts are measured** |
| **Full-text search (`tsvector`)** | Current search is `LIKE`-style on a few columns. `pg_trgm` indexes will handle it. Revisit if requirements grow |
| **Redux / Zustand** | TanStack Query owns server state; three React contexts cover the rest |

**The principle:** every advanced PostgreSQL and infrastructure feature must be
justified by a measurement, not by availability. The current system's problems are
missing fundamentals — pagination, indexes, caching, transactions — not missing
sophistication.
