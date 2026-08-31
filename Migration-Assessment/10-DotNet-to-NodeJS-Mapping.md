# 10 — .NET → Node.js Mapping

---

## 1. Layer mapping

| .NET construct | Node.js / NestJS equivalent | Note |
|---|---|---|
| `Program.cs` (host builder) | `main.ts` + `AppModule` | |
| `builder.Services.AddScoped<I, T>()` | `@Module({ providers: [...] })` | NestJS DI mirrors it closely — the 30 registrations translate directly |
| `[ApiController]` + `[Route("api/[controller]")]` | `@Controller('purchase-invoices')` | Rename to resource-oriented routes at the same time |
| `[HttpPost] [Route("X")]` | `@Post('x')` | |
| Controller action | Controller method | Keep them thin — they already are |
| **`Services/` layer (15 pass-through files)** | **DELETE** | 100% pass-through today. The new service layer does real work: orchestration, transactions, business rules |
| **`Repository/` (16 files, all the logic)** | **Split into `*.service.ts` + `*.repository.ts`** | This is the main intellectual work of the migration |
| `DbaccManegmentContext` | Drizzle schema + `db` client | |
| EF LINQ query | Drizzle query builder / raw SQL | See §3 |
| `ApiResponseModel` | Interceptor producing `{ data, meta }`; exception filter producing RFC 9457 | Replaces three inconsistent envelopes with one |
| `ViewModels/*` | Zod schemas + inferred TypeScript types | **One schema serves validation, typing and OpenAPI** |
| Middleware (`app.UseX()`) | NestJS middleware / guards / interceptors / pipes | |
| `[Authorize]` | `@UseGuards(JwtAuthGuard)` as a **global** `APP_GUARD`, `@Public()` to opt out | **Default-deny** — the opposite of today |
| `FormPermissionAttribute` (Web tier) | `@RequirePermission('invoice:approve')` guard **on the API** | Moves enforcement to where it belongs |
| `UserSession` (server session) | JWT claims + `PermissionContext` in React | Removes server session entirely |
| `IHostedService` / `BackgroundService` | **BullMQ worker** | None exist today; needed for Excel imports and exports |
| `IMemoryCache` | `@nestjs/cache-manager` + Redis | None exists today |
| `ILogger<T>` | **Pino** with request correlation ids | None exists today |
| `try/catch` + `throw ex` | Typed domain errors + a global exception filter | Replaces 47 stack-destroying rethrows |
| `DbHelper` (ADO.NET) | **Delete** | Dead code; will not compile against PostgreSQL anyway |
| `System.Linq.Dynamic.Core` (runtime string sorting) | Allow-listed sort columns | Removes an injection surface |
| `ClosedXML` / `EPPlus` | **ExcelJS** (streaming) | |
| Razor print views | **Playwright** HTML→PDF, or React-PDF | No PDF library exists today |
| `appsettings.json` | `process.env` + Zod-validated config module | Secrets never in source |

---

## 2. Repository-by-repository translation plan

| Current repository | LOC | Becomes | Migration notes |
|---|---:|---|---|
| `UserAuthentication.cs` | 550 | `auth.service.ts`, `users.service.ts`, `users.repository.ts` | **Rewrite, do not port.** Plaintext→argon2id, JWT→RS256 + refresh, CSV site/company→junction tables, default-deny on create |
| `FormPermissionMasterRepo.cs` | 114 | `permissions.service.ts` | Batch the N+1 (`:73`). Add authorization to the endpoints |
| `MasterListRepo.cs`, `FormMasterRepo.cs` | 122 | `reference.service.ts` | **Cache aggressively** — these are the cheapest wins |
| `CompanyRepo.cs` | 289 | `companies.*` | Straightforward. **Good pilot module** |
| `SiteMasterRepo.cs` | 867 | `sites.*`, `site-groups.*` | Remove the full-`Users`-table scans (`:348`, `:401`) — enabled by the junction tables |
| `SupplierMasterRepo.cs` | 514 | `suppliers.*`, `supplier-import.worker.ts` | Fix the 3-per-row N+1; move import to a background job; **fix `UpdateRange(suppliersToAdd)` at `:464` — wrong variable, silent data loss** |
| `ItemMasterRepo.cs` | 687 | `items.*`, `item-import.worker.ts` | Same. Consolidate the GST-inclusive back-calculation (3 JS copies + a divergent C# path) into one server rule |
| `PurchaseRequestRepo.cs` | 354 | `purchase-requests.*` | Numbering → sequence |
| `ItemInwardRepo.cs` | 436 | `inward.*` | ⚠️ Delete `ItemInWordRepo.cs` (unregistered duplicate). Fix the `.ToUpper()` null crash and the create/update casing mismatch |
| `PurchaseOrderRepo.cs` + details | 1,221 | `purchase-orders.*` | **High risk.** Numbering → sequence; PO↔Invoice text match → real FK; fix the D10 grouping defect, the D12 supplier-geography bug, and `ItemTotal = Price`. Wrap the update path in a transaction |
| `SupplierInvoiceRepo.cs` + details | 2,161 | `purchase-invoices.*`, `payments.*`, `reports.*` | **Highest risk — the largest file.** Split it: it currently holds invoices, payouts and four reports. Fix the D7 NetAmount bug and the D22a broken FY parser. Server-side money calculator. Transactions |
| `SalesRepo.cs` | 1,478 | `sales-invoices.*`, `inventory.*`, `payments.*` | Same treatment; reuse the calculator |

**Estimated new backend size:** roughly 12,000-15,000 lines of TypeScript —
larger than the 10,304 lines of C#, because the new code contains the validation,
authorization, transactions, logging and error handling that do not exist today.

---

## 3. Query translation

### 3.1 Simple list with paging

**Before** (`SupplierInvoiceRepo.cs:602`, no paging, no tracking control):
```csharp
var supplierDataQuery = from a in Context.SupplierInvoices
                        join e in Context.SupplierInvoiceDetails on a.Id equals e.RefInvoiceId
                        join b in Context.SupplierMasters on a.SupplierId equals b.SupplierId
                        ...
var supplierData = await supplierDataQuery.ToListAsync();
```

**After** — two queries, keyset-paged, filters pushed to SQL:
```typescript
const headers = await db
  .select({ /* explicit columns only */ })
  .from(supplierInvoice)
  .innerJoin(supplierMaster, eq(supplierInvoice.supplierId, supplierMaster.supplierId))
  .innerJoin(company,        eq(supplierInvoice.companyId,  company.companyId))
  .where(and(
    eq(supplierInvoice.isDeleted, false),
    inArray(supplierInvoice.companyId, ctx.allowedCompanyIds),   // scoping in the DB
    filters.from ? gte(supplierInvoice.invoiceDate, filters.from) : undefined,
    cursor      ? lt(supplierInvoice.invoiceDate, cursor)        : undefined,
  ))
  .orderBy(desc(supplierInvoice.invoiceDate), desc(supplierInvoice.id))
  .limit(pageSize + 1);

const ids   = headers.slice(0, pageSize).map(h => h.id);
const lines = await db.select().from(supplierInvoiceDetail)
                      .where(inArray(supplierInvoiceDetail.supplierInvoiceId, ids));
```

Three defects fixed at once: paging exists, the header is no longer multiplied by
line count, and scoping happens in the database rather than two tiers up in memory.

### 3.2 The N+1 loop

**Before** (`SupplierInvoiceRepo.cs:1726` — 1 + N queries):
```csharp
foreach (var invoice in supplierInvoiceData)
{
    var itemList = await (from a in Context.SupplierInvoiceDetails
                          where a.RefInvoiceId == invoice.Id ...).ToListAsync();
}
```

**After** — one query, grouped in memory:
```typescript
const lines = await db.select().from(supplierInvoiceDetail)
  .where(inArray(supplierInvoiceDetail.supplierInvoiceId, invoiceIds));
const byInvoice = Map.groupBy(lines, l => l.supplierInvoiceId);
```

### 3.3 The bulk approve

**Before** (`SupplierInvoiceRepo.cs:1346` — loads and UPDATEs every row in the table):
```csharp
var allInvoices = await Context.SupplierInvoices.ToListAsync();
foreach (var invoice in allInvoices) { ...; Context.SupplierInvoices.Update(invoice); }
```

**After** — one statement, only the requested rows:
```typescript
await db.update(supplierInvoice)
  .set({ isApproved: true, updatedBy: ctx.userId, updatedOn: new Date() })
  .where(and(
    inArray(supplierInvoice.id, ids),
    inArray(supplierInvoice.companyId, ctx.allowedCompanyIds),   // scoping enforced
  ));
```

### 3.4 The header/detail update — now transactional

**Before** (`SupplierInvoiceRepo.cs:751-777` — **two separate commits**; a crash
between them leaves a header with a total and zero line items, permanently):
```csharp
Context.SupplierInvoiceDetails.RemoveRange(existingItems);
await Context.SaveChangesAsync();          // COMMIT #1 — lines deleted
foreach (var item in ...) { Context.SupplierInvoiceDetails.Add(...); }
await Context.SaveChangesAsync();          // COMMIT #2 — lines re-inserted
```

**After** — one transaction, with the totals recomputed server-side:
```typescript
await db.transaction(async (tx) => {
  const totals = calculateInvoiceTotals(input.lines, input.tds, input.roundOff);  // server-authoritative

  await tx.update(supplierInvoice)
          .set({ ...header, ...totals, updatedBy: ctx.userId, updatedOn: new Date() })
          .where(eq(supplierInvoice.id, id));

  await tx.delete(supplierInvoiceDetail)
          .where(eq(supplierInvoiceDetail.supplierInvoiceId, id));

  await tx.insert(supplierInvoiceDetail).values(input.lines.map(toRow(id)));
});
```

### 3.5 Document numbering — now race-free

**Before** (`SupplierInvoiceRepo.cs:890-913` — read max, increment, no lock):
```csharp
var lastInvoice = Context.SupplierInvoices.Where(...).OrderByDescending(e => e.CreatedOn).FirstOrDefault();
int newInvoiceNumberValue = lastInvoiceNumberValue + 1;
```

**After** — atomic allocation inside the same transaction as the insert:
```typescript
async function allocateNumber(tx, companyId: string, kind: DocKind, fy: string) {
  const [row] = await tx.execute(sql`
    INSERT INTO document_counter (company_id, document_kind, financial_year, next_value)
    VALUES (${companyId}, ${kind}, ${fy}, 2)
    ON CONFLICT (company_id, document_kind, financial_year)
    DO UPDATE SET next_value = document_counter.next_value + 1
    RETURNING next_value - 1 AS allocated
  `);
  return row.allocated;
}
```
Backed by `UNIQUE (company_id, invoice_no)`, duplicates become **impossible**.

---

## 4. The money calculator — the single most important new module

This does not exist today. It must be built, tested against production data, and
used by all three document types.

```typescript
// packages/domain/src/invoice-calculator.ts
import Decimal from 'decimal.js';

export interface LineInput {
  quantity: Decimal; price: Decimal;
  discountPercent: Decimal; gstPercent: Decimal;
}

export function calculateLine(line: LineInput) {
  // NOTE: the legacy JavaScript rounds PER LINE with .toFixed(2), then sums.
  // It does NOT sum-then-round. This ordering is replicated deliberately so
  // that historical documents reproduce. Do not "improve" it without a
  // reconciliation run and business sign-off.
  const gross        = line.price.mul(line.quantity);
  const discountAmt  = gross.mul(line.discountPercent).div(100).toDecimalPlaces(2);
  const net          = gross.minus(discountAmt);
  const gstAmt       = net.mul(line.gstPercent).div(100).toDecimalPlaces(2);
  const total        = net.plus(gstAmt).toDecimalPlaces(2);
  return { gross, discountAmt, net, gstAmt, total };
}

export function calculateInvoiceTotals(lines: LineInput[], tds: Decimal, roundOff: Decimal) {
  const calc     = lines.map(calculateLine);
  const subtotal = calc.reduce((a, l) => a.plus(l.net),    new Decimal(0));
  const gst      = calc.reduce((a, l) => a.plus(l.gstAmt), new Decimal(0));
  const discount = calc.reduce((a, l) => a.plus(l.discountAmt), new Decimal(0));
  const total    = subtotal.plus(gst).minus(tds).plus(roundOff).toDecimalPlaces(2);
  return { subtotal, gst, discount, tds, roundOff, total, lines: calc };
}

// CGST/SGST vs IGST is a PRESENTATION concern today, inferred by comparing
// company and supplier state codes at render time. Make it explicit here.
export function splitGst(gstAmount: Decimal, companyStateCode: string, partyStateCode: string) {
  return companyStateCode === partyStateCode
    ? { cgst: gstAmount.div(2).toDecimalPlaces(2), sgst: gstAmount.div(2).toDecimalPlaces(2), igst: new Decimal(0) }
    : { cgst: new Decimal(0), sgst: new Decimal(0), igst: gstAmount };
}
```

**Rules for this module:**

1. `decimal.js` or integer-paise arithmetic. **Never `parseFloat` on currency.**
2. Live in a **shared package** imported by both the API and the React client — the
   client uses it for live preview, the server for the authoritative value.
3. **The server always recomputes and persists its own result.** Client-supplied
   totals are compared and a mismatch is rejected with a clear error.
4. The rounding order is a **documented behavioural contract**, not an
   implementation detail.
5. It is the **first thing built** and the most heavily tested — characterisation
   tests against a large sample of real production invoices.

---

## 5. Cross-cutting concerns — all new

### Authorization (default-deny)

```typescript
// app.module.ts — every route requires auth unless explicitly marked @Public()
providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard },
            { provide: APP_GUARD, useClass: PermissionGuard }]

@Post(':id/approve')
@RequirePermission('purchase-invoice:approve')
async approve(@Param('id') id: string, @CurrentUser() user: AuthUser) { … }
```

Plus a CI test that enumerates every registered route and fails the build on any
route not carrying either `@Public()` or a permission — so a forgotten decorator
**fails closed**. This directly answers finding C-6.

### Site/company scoping

```typescript
// Every query for scoped entities goes through this. Not optional, not the UI's job.
function scoped(qb, user: AuthUser, table) {
  return qb.where(inArray(table.companyId, user.companyIds));
}
```

### Validation

```typescript
export const CreateInvoiceSchema = z.object({
  supplierId: z.string().uuid(),
  companyId:  z.string().uuid(),
  invoiceDate: z.coerce.date(),
  lines: z.array(z.object({
    itemId:   z.string().uuid(),
    quantity: z.coerce.number().positive(),
    price:    z.coerce.number().nonnegative(),
    gstPercent: z.coerce.number().min(0).max(100),
  })).min(1),
  // NOTE: totalAmount is deliberately NOT accepted. The server computes it.
});
```

### Logging

Pino, JSON, with a correlation id per request, secrets redacted by a
`redact` allow-list, and slow-query logging on the Drizzle client.

### Errors

Typed domain errors (`NotFoundError`, `ValidationError`, `ConflictError`,
`ForbiddenError`) mapped by a global exception filter to RFC 9457 Problem Details.
The client sees a generic message and a correlation id; the full detail goes to logs
only. This replaces 47 `throw ex;` and 25+ `ex.Message` leaks.

---

## 6. Project structure

```
apps/
  api/                      NestJS
    src/
      main.ts
      app.module.ts
      common/               guards · interceptors · filters · decorators · pipes
      config/               Zod-validated env
      db/                   drizzle schema, migrations, client
      modules/
        auth/               login · refresh · argon2 · JWT
        users/              users + permissions
        reference/          countries · states · cities · units · forms  (cached)
        companies/  sites/  suppliers/  items/
        purchase-requests/  purchase-orders/  inward/  inventory/
        purchase-invoices/  sales-invoices/   payments/
        reports/
        dashboard/
      workers/              excel-import · export · (BullMQ)
  web/                      React + Vite
packages/
  domain/                   invoice-calculator · financial-year · document-number
                            ← SHARED between api and web
  contracts/                Zod schemas + inferred types + generated API client
```

**`packages/domain` is the answer to the "same rule implemented differently on two
screens" problem.** There is exactly one implementation, and both tiers import it.

---

## 7. Framework and ORM recommendation

Full comparison in [16-Technology-Stack.md](16-Technology-Stack.md). Summary:

**Framework: NestJS.**

| | Express | Fastify | **NestJS** |
|---|---|---|---|
| Speed to first endpoint | Fastest | Fast | Slower |
| Raw throughput | Baseline | ~2× | Fastify-based, so ~2× |
| **Structure enforced** | None | None | **Modules, DI, layering** |
| **Global default-deny guards** | Manual | Manual | **`APP_GUARD` — structural** |
| Transactions / unit of work | Manual | Manual | Interceptor-based |
| OpenAPI generation | Manual | Plugin | Built-in |
| Team familiarity from .NET | Low | Low | **High — DI, decorators, controller/service/repository all map directly** |

**Why NestJS here:** this codebase's defining weakness is that cross-cutting
concerns are *optional*. Authorization is missing on two endpoints because it is a
decorator someone forgot. There are no transactions because nothing required one.
There is no validation because nothing enforced it. **NestJS makes these
structural rather than discretionary**, and its `APP_GUARD` mechanism is a direct
answer to finding C-6. It also maps almost one-to-one onto the team's existing .NET
mental model, which materially reduces migration risk.

Express would be a reasonable choice for a greenfield team already fluent in Node.
For a team coming from ASP.NET Core, migrating a system whose problems are exactly
the ones NestJS structures away, it is the wrong trade.

**ORM: Drizzle + node-postgres.**

| | Prisma | TypeORM | **Drizzle** | node-postgres alone |
|---|---|---|---|---|
| Type safety | Excellent | Poor | **Excellent** | None |
| **Complex joins / dynamic filters** | Awkward — often needs `$queryRaw` | Workable | **Excellent — it *is* SQL** | Excellent |
| **SQL transparency** | Opaque | Semi | **You write the SQL** | Total |
| Transactions | Good | Good | **Good** | Manual |
| Migrations | Excellent | Adequate | **Good (Drizzle Kit)** | None |
| Bundle / cold start | Heavy (Rust engine) | Medium | **Very light** | Lightest |
| Maturity | Highest | High | Newer but stable | — |

**Why Drizzle here:** the reporting queries are multi-table joins with dynamic
filters and grouping — exactly the shape that Prisma's fluent API obstructs and
that would push a large fraction of this system into `$queryRaw` anyway. More
importantly, **this migration depends on being able to see exactly what SQL is
produced**, because the whole performance problem is queries the previous ORM
generated invisibly. Drizzle keeps SQL first-class while giving full type inference
from the schema.

TypeORM's type safety is too weak for a financial system. Raw `node-postgres` alone
gives up type inference and migrations for no benefit Drizzle does not already
provide.

---

## 8. What NOT to port

| Do not port | Why |
|---|---|
| The 15-file service layer | 100% pass-through |
| `ItemInWordRepo.cs` (439 lines) | Unregistered duplicate — dead code |
| `DbHelper.cs` | Dead ADO.NET; will not compile against PostgreSQL |
| ~440 lines of commented-out stored-proc code | Dead |
| `Web/Models/Common.cs` AES helper | Dead, broken, and cryptographically unsound |
| `AuthenticationController.cs:34` | Generates a token that is discarded |
| `SupplierInvoiceRepo.cs:1060`, `SalesRepo.cs:962` | `query.FirstOrDefault().GetType()` — dead code that costs a query and throws on empty sets |
| The `InvoiceListView` screen | Duplicates `SupplierInvoiceListView`; its sort control calls a commented-out function |
| The "Remember me" password cookie | Security defect |
| Three response envelopes | Standardise on one |
| Blind approval toggles | Take an explicit target state |
| Read-max-then-increment numbering | Use the counter table |
| Client-side money arithmetic | Server-authoritative |
