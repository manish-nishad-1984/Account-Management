# 16 — Recommended Technology Stack

Every choice below is justified against **this** codebase, not general preference.

---

## 1. Summary

| Layer | Recommendation | Version |
|---|---|---|
| **Runtime** | Node.js LTS | **22.x** |
| **Language** | TypeScript, `strict: true` | **5.x** |
| **Backend framework** | **NestJS** (Fastify adapter) | 11.x |
| **Database** | **PostgreSQL** | **17** |
| **Query layer** | **Drizzle ORM** + `node-postgres` | latest |
| **Migrations** | Drizzle Kit | latest |
| **Validation** | **Zod** — shared client/server | 3.x |
| **Auth** | `jose` (RS256) + argon2 + opaque refresh tokens | |
| **Cache / queue** | **Redis 7** + BullMQ | |
| **Logging** | **Pino** + OpenTelemetry | |
| **Frontend** | **React 19** + TypeScript | |
| **Build** | **Vite** | 7.x |
| **Routing** | React Router | 7.x |
| **Server state** | **TanStack Query** | 5.x |
| **Client state** | **React Context** (no Redux, no Zustand) | — |
| **Forms** | React Hook Form + Zod | |
| **Tables** | TanStack Table | 8.x |
| **UI kit** | **Mantine** | 7.x |
| **Money** | `decimal.js` | |
| **Dates** | `date-fns` | |
| **Charts** | Recharts | |
| **PDF** | Playwright (HTML → PDF) | |
| **Excel** | ExcelJS (streaming) | |
| **Testing** | Vitest · Testing Library · Playwright · Testcontainers · k6 | |
| **Storage** | S3-compatible object storage | |
| **Deploy** | Docker + nginx | |

---

## 2. Backend framework: Express vs Fastify vs NestJS

| Criterion | Express | Fastify | **NestJS** |
|---|---|---|---|
| Time to first endpoint | **Fastest** | Fast | Slower (learning curve) |
| Raw throughput | Baseline | **~2×** | Fastify-based → ~2× |
| **Structure enforced** | None | None | **Modules, DI, layering** |
| **Global default-deny auth** | Manual, per-route | Manual, per-route | **`APP_GUARD` — structural** |
| Transaction / unit-of-work | Manual | Manual | Interceptor-based |
| Validation pipeline | Manual | Schema-based | **Pipes, global** |
| OpenAPI generation | Manual | Plugin | **Built in** |
| Testability | Manual wiring | Manual wiring | **DI makes it trivial** |
| **Maps to the team's .NET model** | Low | Low | **High** |
| Ecosystem | Largest | Growing | Large |

### Recommendation: **NestJS**

**The reasoning is specific to this codebase's failure modes.**

Every serious architectural finding in this assessment has the same shape: **a
cross-cutting concern was optional, and someone forgot it.**

- Two endpoints grant administrator rights **because `[Authorize]` is a decorator
  someone did not write** (C-6).
- There are **zero transactions** in 10,304 lines because nothing required one.
- There is **no server-side validation** because nothing enforced it.
- There is **no logging** because nothing made it structural.
- Permissions are checked in the UI tier only because that was where it was easy.

NestJS's `APP_GUARD` inverts the default: **every route requires authentication and
an explicit permission unless deliberately marked `@Public()`.** Forgetting a
decorator produces a 401, not a security hole. Interceptors do the same for
transactions and logging. That is not a stylistic preference — it is a direct
structural answer to the specific class of defect this system suffers from.

Secondly, the team is coming from ASP.NET Core. NestJS's controller → service →
repository layering, constructor DI, decorators and module registration map almost
one-to-one onto what they already know. That materially reduces migration risk at
the point where risk is highest.

**When Express would be right:** a small greenfield service, or a team already
fluent in Node with strong conventions. **Neither applies here.**

**When Fastify alone would be right:** a performance-critical service with a narrow
surface. This is a 60-endpoint business application; NestJS runs on Fastify anyway,
so the throughput argument is not a trade-off.

---

## 3. Query layer: Prisma vs TypeORM vs Drizzle vs node-postgres

| Criterion | Prisma | TypeORM | **Drizzle** | node-postgres |
|---|---|---|---|---|
| Type safety | Excellent | **Poor** | **Excellent** | None |
| **Complex joins** | Awkward — often forces `$queryRaw` | Workable | **Excellent** | Excellent |
| **Dynamic filters** | Awkward | Workable | **Excellent** | Manual |
| **SQL transparency** | Opaque | Semi | **You write the SQL** | Total |
| Aggregations / window functions | Limited | Limited | **Full SQL** | Full |
| Transactions | Good | Good | **Good** | Manual |
| Migrations | **Excellent** | Adequate | Good (Drizzle Kit) | None |
| Performance overhead | Rust engine, heavy | Medium | **Minimal** | None |
| Cold start | Slow | Medium | **Fast** | Fastest |
| Maturity | **Highest** | High | Newer, stable | Highest |
| Learning curve | Low | Medium | **Low if you know SQL** | Low |

### Recommendation: **Drizzle + node-postgres**

**Weighed against the stated criteria:**

**Existing complexity.** 16 repositories, 138 endpoints, moderate domain complexity.
Nothing requires a heavyweight ORM's abstractions.

**SQL complexity — the decisive factor.** The reporting queries are multi-table
joins with dynamic filters, grouping and computed aggregates. `SupplierInvoiceRepo`
alone contains a six-table join with conditional filtering. **In Prisma, a large
fraction of these would end up in `$queryRaw` anyway** — at which point Prisma's
main benefit is gone and its weight remains.

**Reporting requirements.** 10 report endpoints needing aggregates, running
balances and financial-year windows. This calls for window functions and CTEs.
Drizzle exposes SQL directly; Prisma obstructs it.

**PostgreSQL capabilities.** Partial indexes, `ON CONFLICT`, `xmin` concurrency,
keyset pagination — Drizzle expresses all of these naturally.

**Performance.** The whole reason this project exists is that queries were slow and
nobody could see what SQL was being generated. **Drizzle's transparency is a
first-class requirement here, not a preference.** Every query is visible at the
call site.

**Maintainability.** A developer who knows SQL can read Drizzle immediately. It is
also the easiest layer to replace if that judgement turns out wrong — the queries
are already SQL.

**Developer productivity.** Prisma wins slightly on simple CRUD scaffolding. That
advantage is outweighed by the complex-query cost, which is where the real work is.

**Migration risk.** The existing code is LINQ that translates *conceptually* to
SQL. Porting it to explicit SQL with Drizzle is a **reviewable, verifiable step**.
Porting it to Prisma's fluent API means two translations and two chances to change
behaviour silently.

**Rejecting the others:**
- **TypeORM** — type safety is too weak for a financial system. Its decorator-based
  entities also reproduce EF's "the query is invisible" problem, which is exactly
  what caused the current situation.
- **Raw node-postgres alone** — gives up type inference and migrations for no
  benefit Drizzle does not already provide.

---

## 4. PostgreSQL 17

| Reason | Detail |
|---|---|
| Current major version | Supported until late 2029 |
| Improved `VACUUM` | Lower maintenance overhead |
| Better `IN (…)` and B-tree scan performance | Directly relevant — the batched-`Contains` pattern replaces every N+1 loop |
| `gen_random_uuid()` built in | No extension needed |
| Mature partitioning | Available if row counts demand it later |
| `pg_stat_statements`, `auto_explain` | The observability the current system lacks entirely |

**Managed vs self-hosted:** strongly prefer **managed** (RDS, Cloud SQL, Neon,
DigitalOcean). The current SQL Server is self-managed on a VPS with **port 1433
exposed to the internet and the application connecting as `sa`**. Managed hosting
removes an entire category of risk that this system has already demonstrated.

---

## 5. Frontend choices, with reasons

| Choice | Why | Why not the alternative |
|---|---|---|
| **React 19** | Client requirement. Stable, large ecosystem | — |
| **Vite** | Instant HMR, optimal production bundles | Webpack: slower, more configuration |
| **TanStack Query** | **The single highest-value library in this stack.** Caching, deduplication, invalidation and cancellation directly replace ~40 redundant fetches, every `location.reload()`, and the missing search debouncing | Hand-rolled fetch: reproduces the current problems |
| **React Context, no Redux** | Once Query owns server state, what remains is auth, permissions and theme | **Redux Toolkit:** would mean writing slices for data Query already caches correctly. Ceremony without benefit |
| **React Hook Form + Zod** | Uncontrolled inputs — critical for the line-item grids. **Zod schemas shared with the API**, so validation cannot drift between tiers | Formik: heavier, less performant on large forms |
| **TanStack Table** | Headless — full control over the complex line-item grids. Server-side pagination is first-class | AG Grid: excellent but licensed for the features needed |
| **Mantine** | Best-in-class form and input primitives for dense data entry. Neutral visual language — the current UI is generic Bootstrap, so users feel no brand shift. Advanced table features are not behind a paywall | **MUI:** defensible if the team knows it; DataGrid Pro is paid. **Ant Design:** strong visual identity users would notice |
| **decimal.js** | ⚠️ **Non-negotiable.** The current code has a `NaN` bug from `parseFloat` on currency, and all money runs through IEEE-754 doubles | Native `number`: the defect being migrated away from |
| **date-fns** | Tree-shakeable, immutable | moment.js: in maintenance mode, and currently loaded for very little |
| **Recharts** | React-native API, adequate for the dashboard | ApexCharts and Chart.js are **both** loaded today; Chart.js draws nothing |
| **TipTap** | Modern, tree-shakeable | CKEditor 5: ~500 KB blocking first paint on all 31 screens for one screen's benefit |
| Mantine notifications | One library | Today: SweetAlert2 **and** toastr **and** lobibox are all loaded |

---

## 6. Supporting choices

| Concern | Choice | Reason |
|---|---|---|
| **Password hashing** | **argon2id** (`argon2`) | Winner of the Password Hashing Competition; memory-hard. `memoryCost ≥ 19456 KiB, timeCost ≥ 2`. bcrypt cost ≥ 12 is an acceptable fallback. **Replaces plaintext** |
| **JWT** | **`jose`**, RS256 | Modern, standards-correct, pins algorithms explicitly. RS256 means a compromised API host cannot mint tokens |
| **Refresh tokens** | Opaque random, hashed in Redis, rotated with reuse detection | JWTs alone cannot be revoked. **Replaces the 7-day plaintext-password cookie** |
| **Validation** | **Zod** | One schema → runtime validation + TypeScript types + OpenAPI. **Shared between client and server** |
| **Logging** | **Pino** | Fastest structured logger for Node; JSON by default; built-in redaction |
| **Tracing** | OpenTelemetry | Vendor-neutral; auto-instruments HTTP and `pg` |
| **Errors** | Sentry | Both API and browser |
| **Jobs** | **BullMQ** | Redis-backed; retries, progress, concurrency. **The Excel imports that currently run inline in the HTTP request belong here** |
| **Cache** | Redis | Reference data, refresh tokens, queue backing |
| **PDF** | **Playwright** HTML → PDF | Reuses the existing print views' HTML. **No PDF library exists in the solution today** |
| **Excel** | **ExcelJS**, streaming | Replaces ClosedXML/EPPlus and the Windows-only ACE OLEDB path. Streaming handles the 50,000-row uploads that currently time out |
| **Testing** | Vitest, Testing Library, Playwright, Testcontainers, k6 | Testcontainers gives real PostgreSQL in integration tests — essential when constraints and transactions are the thing being verified |
| **Package manager** | **pnpm** | Efficient, strict, good monorepo support |
| **Monorepo** | pnpm workspaces (+ Turborepo if build times demand) | `packages/domain` **must** be shared between API and web |
| **Lint/format** | ESLint + Prettier, or Biome | |
| **CI/CD** | GitHub Actions | A `.github` folder already exists |
| **Containers** | Docker + Compose | Kubernetes is unwarranted at this scale |
| **Secrets** | Platform secret manager + `gitleaks` in CI | ⚠️ **Directly addresses the `sa` password and JWT key currently in source control** |

---

## 7. Rejected, and why

| Considered | Rejected because |
|---|---|
| Keep .NET, move only the DB and UI | Defensible — and worth putting to the client. But the client has specified Node/React, and the .NET code needs substantial rework regardless |
| Microservices | 24 tables, one bounded context, small team. Would add distributed-transaction problems to a system with **zero transactions today** |
| GraphQL | Conventional REST access patterns; adds a layer for no benefit here |
| Deno / Bun | Ecosystem maturity for a production financial system |
| MongoDB | Relational data with financial integrity requirements. Not a candidate |
| Next.js | This is an authenticated internal application. SSR adds complexity with no SEO or first-paint benefit that a CDN-served SPA does not already provide |
| Kubernetes | Two containers and a worker |
| An automated schema converter (`pgloader` for DDL) | **Would faithfully reproduce every schema defect** — the CSV columns, the missing FKs, the overloaded document-number columns. Only 24 tables; hand-write them |

---

## 8. Version pinning

| Component | Pin to | Review |
|---|---|---|
| Node.js | **22.x LTS** | Move to 24 LTS when it is mature (2026-27) |
| PostgreSQL | **17.x** | Supported to 2029 |
| TypeScript | Latest stable | Quarterly |
| NestJS | Latest major | On major release |
| React | **19.x** | On major release |
| All others | Exact versions in the lockfile | Renovate/Dependabot weekly, with CI gating |

⚠️ **A note on the current state:** the existing solution mixes `net8.0` web
projects with `net6.0` libraries (.NET 6 reached end of support in November 2024),
carries `JwtBearer 6.0.5` and `Http.Features 5.0.17`, and pins a CDN script to
`latest` — an unversioned URL that can change under the application without a
deploy. **The new stack should have a stated, enforced update policy from day one.**
