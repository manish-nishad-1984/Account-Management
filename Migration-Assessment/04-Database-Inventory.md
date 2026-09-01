# 04 — Database Inventory

> **Source of this document.** The live database could not be reached from the
> analysis environment. Everything here is derived from
> `DbaccManegmentContext.cs` (the EF Core `OnModelCreating`) and the 28 entity
> classes. That model is a snapshot from when it was last scaffolded and **may
> have drifted from the real database.**
>
> Items marked **UNKNOWN — requires live DB** can only be answered by running
> [`tools/01-extract-mssql-schema.sql`](tools/01-extract-mssql-schema.sql).

---

## 1. Headline numbers

| Measure | Value |
|---|---|
| Mapped tables | **24** |
| Entity classes present | 28 (**4 are dead scaffolding** — `SiteMember`, `UserRole`, `RolewiseFormPermission`, `SiteDeliveryAddress`) |
| Total columns | **337** |
| Configured foreign keys | **25** |
| Reference-shaped columns with **no** FK | **~62** |
| **Referential integrity actually enforced** | **~29%** |
| `HasIndex(...)` declarations in the model | **0** |
| Unique constraints in the model | **0** |
| Check constraints in the model | **0** |
| Concurrency tokens | **0** |
| Global query filters | **0** |
| Tables with no primary key | 0 |
| Composite primary keys | 0 |
| Row counts | **UNKNOWN — requires live DB** |

> **The `HasIndex` = 0 finding is the most consequential unknown in this pack.**
> Either the database genuinely has no secondary indexes — which would be a severe
> production problem and very plausibly *the* cause of the reported slowness — or
> the scaffold simply did not emit them. Section 8 of the schema extraction script
> settles this in one query. **Do not plan performance work before running it.**

---

## 2. Table inventory

Grouped by role. Column counts from the EF model.

### Reference / lookup (5 tables)

| Table | PK | Cols | Key generation | Notes |
|---|---|---|---|---|
| `Countries` | `int` | 3 | `ValueGeneratedNever` | `char(2)` code, `DEFAULT ('')` |
| `States` | `int` | 4 | `ValueGeneratedNever` | → `Countries`. Column `Country_id` |
| `Cities` | `int` | 3 | `ValueGeneratedNever` | → `States`. Column `State_Id` |
| `UnitMaster` | `int` IDENTITY | 2 | IDENTITY | **6 inbound FKs — the most-referenced table** |
| `Form` | `int` IDENTITY | 7 | IDENTITY | Screen registry driving the menu. No audit columns |

### Identity & access (3 tables + 3 dead)

| Table | PK | Cols | Notes |
|---|---|---|---|
| `User` | `uuid` | 16 | ⚠️ **`SiteId` and `CompanyId` are `nvarchar(max)` comma-separated GUID lists.** `Password` is `nvarchar(20)`, plaintext. `User` is a PostgreSQL reserved word. Self-referencing audit columns. `RoleId` is `uuid` but `UserRole.RoleId` is `int` — **type mismatch, cannot be FK'd** |
| `UserwiseFormPermission` | `int` IDENTITY | 12 | The live permission model. Both FKs configured. No unique on `(UserId, FormId)` |
| `SiteAddress` | `int` IDENTITY | 4 | Shipping addresses per site. No audit columns |
| ~~`SiteMember`~~ | — | — | **Dead — not mapped.** Ironically this is the correctly-designed junction table that `User.SiteId` should have been using |
| ~~`UserRole`~~ | — | — | **Dead — not mapped** |
| ~~`RolewiseFormPermission`~~ | — | — | **Dead — not mapped.** Role-based permissions were designed and abandoned in favour of user-based |

### Master data (5 tables)

| Table | PK | Cols | FKs configured | Notes |
|---|---|---|---|---|
| `Company` | `uuid` | 20 | 0 | 3 orphan geography refs. `GSTNo varchar(17)` (supplier's is 20 — inconsistent). Column `IsDelete` (elsewhere `IsDeleted`) |
| `Site` | `uuid` | 22 | 0 | **6 orphan geography refs** (billing + shipping). Misspellings `ContectPersonName`, `ContectPersonPhoneNo` |
| `GroupMaster` | `int` IDENTITY | 6 | 0 | ⚠️ **Dual key** — PK is `int` but the app addresses rows by `GroupId uuid`. Half-implemented audit |
| `SupplierMaster` | `uuid` | 22 | 2 | Best-constrained master. ⚠️ `SupplierName varchar(30)` — too narrow for a legal entity name |
| `ItemMaster` | `uuid` | 14 | 1 | → `UnitMaster`. **No item code / SKU column exists** — `ItemName` is the de-facto key |

### Transactional (11 tables)

| Table | PK | Cols | FKs | Notes |
|---|---|---|---|---|
| `PurchaseRequest` | `uuid` | 17 | 3 | `PrNo` — no unique constraint. Orphan `SiteAddressId` |
| `PurchaseOrder` | `uuid` | **30** | 1 | ⚠️ 3 orphan uuid refs. `POId nvarchar(100)` is the PO *number*, nullable, not unique. Three independent boolean status flags |
| `PurchaseOrderDetail` | `int` IDENTITY | 17 | 0 | ⚠️ **`PORefId` has no FK** — the master/detail spine is unenforced. `ItemName varchar(50)` truncates against `ItemMaster.ItemName varchar(100)` |
| `PodeliveryAddress` | `int` IDENTITY | 6 | 0 | ⚠️ Orphan parent. `Quantity int` — every other Quantity in the schema is `numeric(18,2)` |
| `SupplierInvoice` | `uuid` | **32** | **1** | ⚠️ **The widest table with the fewest FKs.** No soft-delete column. `InvoiceNo` nullable, not unique. Two invoice-number columns (`InvoiceNo` and `SupplierInvoiceNo`) — purpose of the second is **UNKNOWN**. `POId` is a text match to `PurchaseOrder.POId` |
| `SupplierInvoiceDetail` | `int` IDENTITY | 18 | 0 | ⚠️ **`RefInvoiceId` is NULLABLE and has no FK.** Rows can exist with no parent at all. `TotalAmount` and `Gst` nullable |
| `SalesInvoice` | `uuid` | 29 | **3** | Best-constrained header. ⚠️ `SalesInvoiceNo` is **overloaded with the literal `'PayIn'`** as a row-type discriminator |
| `SalesInvoiceDetail` | `int` IDENTITY | 18 | 2 | ⚠️ `RefSalesInvoiceId` nullable, no FK |
| `ItemInword` | `uuid` | 18 | 2 | Misspelt table name. `InvoiceNo nvarchar(max)`. `UnitTypeId` is the only such column in the schema with no FK. `Date` is `datetime` where 7 peer tables use `date` |
| `ItemInWordDocument` | `int` IDENTITY | 3 | 1 | One of only two properly-constrained master/detail pairs |
| `InventoryInward` | `uuid` | 14 | 2 | `ValueGeneratedNever` uuid PK. Orphan `SiteId` |

---

## 3. Relationship map

### 3a. Relationships that ARE enforced (25 FKs)

```
Countries ──1:N──► States ──1:N──► Cities

UnitMaster ──1:N──► ItemMaster
           ──1:N──► PurchaseRequest
           ──1:N──► SalesInvoiceDetail
           ──1:N──► ItemInword
           ──1:N──► InventoryInward
           ──1:N──► (one more)

Form ──1:N──► UserwiseFormPermission ◄──N:1── User

Site ──1:N──► SiteAddress
     ──1:N──► PurchaseRequest
     ──1:N──► SalesInvoice

SupplierMaster ──1:N──► SalesInvoice
               ──N:1──► Cities, States

Company ──1:N──► SalesInvoice

ItemMaster ──1:N──► PurchaseRequest
           ──1:N──► SalesInvoiceDetail
           ──1:N──► InventoryInward

ItemInword ──1:N──► ItemInWordDocument
```

### 3b. Relationships that are NOT enforced (~62 orphan columns)

**Group A — the master/detail spines. All four unenforced.**

| Child | Column | Should reference | Nullable? |
|---|---|---|---|
| `PurchaseOrderDetail` | `PORefId` | `PurchaseOrder.Id` | no |
| `PodeliveryAddress` | `POId` | `PurchaseOrder.Id` | no |
| `SupplierInvoiceDetail` | `RefInvoiceId` | `SupplierInvoice.Id` | **YES** |
| `SalesInvoiceDetail` | `RefSalesInvoiceId` | `SalesInvoice.Id` | **YES** |

The two nullable ones are worse than the others: a detail row can exist with no
parent reference at all, which no constraint could ever have caught.

**Group B — transaction → master (~20 columns)**

`SupplierInvoice.SupplierId`, `.CompanyId`, `.SiteId`;
`PurchaseOrder.SiteId`, `.ToCompanyId`, `.SupplierId`;
`SupplierInvoiceDetail.ItemId`, `.UnitTypeId`;
`PurchaseOrderDetail.ItemId`, `.UnitTypeId`;
`ItemInword.SiteId`, `.SupplierId`, `.UnitTypeId`;
`InventoryInward.SiteId`; `PurchaseRequest.SiteAddressId`; and others.

**Group C — geography on masters (9 columns)**

`Company.CityId`, `.StateId`, `.Country`;
`Site.CityId`, `.StateId`, `.Country`, `.ShippingCityId`, `.ShippingStateId`, `.ShippingCountry`.

**Group D — audit columns (30 columns across 15 tables)**

Every `CreatedBy` and `UpdatedBy` in the schema references `User.Id`. **Not one
has a foreign key.** Expect orphans from deleted users and bootstrap/system GUIDs.

**Group E — text-based pseudo-relationships**

| From | Column | Matched against | Mechanism |
|---|---|---|---|
| `SupplierInvoice` | `POId nvarchar(100)` | `PurchaseOrder.POId` | **string equality** |
| `PurchaseOrder` | `SiteGroup nvarchar` | `GroupMaster.GroupName` | **string equality** |
| `SupplierInvoice` | `SiteGroup nvarchar` | `GroupMaster.GroupName` | **string equality** |
| `User` | `SiteId nvarchar(max)` | `Site.SiteId` | **comma-separated GUID list** |
| `User` | `CompanyId nvarchar(max)` | `Company.CompanyId` | **comma-separated GUID list** |

### 3c. Cardinality summary

| Type | Instances |
|---|---|
| One-to-many | ~45 (25 enforced, ~20 not) |
| One-to-one | 0 |
| **Many-to-many** | 2 — `User↔Site` and `User↔Company`, **implemented as CSV strings, not junction tables** |
| Self-referencing | 1 — `User.CreatedBy`/`UpdatedBy` → `User.Id` |
| Master-detail | 4 — PO→lines, PO→addresses, SupplierInvoice→lines, SalesInvoice→lines. **All unenforced** |

---

## 4. Data type analysis

Better news than expected. The types themselves map cleanly.

| MSSQL type (configured) | Columns | PostgreSQL | Risk | Note |
|---|---|---|---|---|
| `nvarchar(n)` | 101 | `varchar(n)` | Low | Check collation behaviour |
| `uniqueidentifier` | 70 | `uuid` | Low | **Client-generated** — `Guid.NewGuid()` at 19 sites. Only `User.Id` has a `(newid())` DB default, and the app overrides it anyway |
| `numeric(18,2)` | **40** | `numeric(18,2)` | **None** | ✅ **All money and quantity columns are proper decimals. No float, no double, no money-as-string anywhere** |
| `int` | 39 | `integer` | Low | 10 are IDENTITY → `GENERATED BY DEFAULT AS IDENTITY` + `setval()` |
| `datetime` | 32 | `timestamp(3)` | Low | ✅ **No dates stored as strings** |
| `bit` | 32 | `boolean` | **Medium** | **22 are nullable.** See §5.3 |
| `nvarchar(max)` | 11 | `text` | Low | Several should be bounded instead |
| `date` | 8 | `date` | Low | |
| `varchar` / `char` | 4 | `varchar` / `char` | Low | `char(2)` blank-padding differs between engines |
| **XML columns** | **0** | — | — | None |
| **Computed columns** | **0** in the model | — | — | **UNKNOWN — requires live DB** |
| **`money` type** | **0** | — | — | None |

**Precision concerns to address during migration:**

- `GSTPer` and `DiscountPer` are `numeric(18,2)` — insufficient for a rate like
  `18.5%` expressed as `0.185`. **Widen to `numeric(9,4)`.**
- `Quantity` is `numeric(18,2)` in most places but **`int`** in `PodeliveryAddress`.
  Normalise to `numeric(18,3)`.
- `PurchaseOrderDetail.ItemName varchar(50)` vs `ItemMaster.ItemName varchar(100)` —
  **truncation on copy**. Widen to 100.

---

## 5. Schema quality findings, ranked

**1 — `User.SiteId` / `User.CompanyId` are CSV GUID strings driving authorisation.**
`UserAuthentication.cs:55-60` splits them at runtime. This forces
`SiteMasterRepo.cs:348-354` to load the **entire `Users` table** and string-split it
in memory just to count active users on a site. It makes indexing impossible and
makes referential integrity unachievable. A correctly-designed junction table
(`SiteMember`) exists in the same folder, unused. **Fix: two junction tables.**

**2 — ~71% of reference columns have no foreign key.** All four master/detail
spines are unenforced, two permitting a NULL parent. The 30 audit columns have
none. PostgreSQL will refuse to create these constraints until orphans are cleaned.
**The volume of orphans is the single biggest schedule unknown.**

**3 — No unique constraint on any business key.** Invoice numbers, PO numbers, PR
numbers, usernames, emails and item names all permit duplicates. Combined with the
racy read-max-then-increment numbering (see [07](07-Business-Rule-Inventory.md)),
duplicate GST invoice numbers are not merely possible — they are likely.

**4 — Document-number columns are overloaded with type discriminators.**
`SupplierInvoice.InvoiceNo` holds `'PayOut'` and `'Opening Balance'`;
`SalesInvoice.SalesInvoiceNo` holds `'PayIn'`. These sentinel rows **will break any
unique constraint** and must be modelled as a proper `document_type` discriminator
before the constraint can be added.

**5 — 22 nullable boolean flags.** The application filters `IsDeleted == false`,
so rows with `NULL` are **currently invisible to users**. Backfilling `NULL → false`
will make them appear. Count them (census script Part G) and get business sign-off
before doing so.

**6 — Inconsistent audit columns.** `IsDelete` on `Company` and `SupplierMaster`,
`IsDeleted` everywhere else. `Createdby` (lowercase b) on `UserwiseFormPermission`.
`GroupMaster` has only `CreatedOn`. `Form` and `SiteAddress` have none. Audit values
are set manually in ~40 places and **frequently omitted** — e.g.
`PurchaseOrderRepo.UpdateMultiplePurchaseOrderDetails` never sets `UpdatedBy`/`UpdatedOn`.

**7 — No optimistic-concurrency token on any table.** Two users editing the same
invoice silently overwrite each other. PostgreSQL's system `xmin` column gives this
for free via `UseXminAsConcurrencyToken()`.

**8 — Denormalisation without a snapshot rationale.** `ItemName`, `SiteAddress`,
`ShippingAddress` are copied into transaction rows. For invoices this is correct
(a document should record what it said at the time) — but it is applied
inconsistently and the copies are narrower than their sources.

**9 — Naming inconsistencies.** `ItemInword` / `ItemInWord` / `ItemInward` — the
same domain concept spelled three ways across table, controller and repository.
`ContectPersonName`, `PODelevryAddress`, `IFFCCode` (should be `IFSC`), `Poid` vs
`POId` vs `PORefId`.

---

## 6. What the EF model cannot tell us

Run [`tools/01-extract-mssql-schema.sql`](tools/01-extract-mssql-schema.sql) to resolve:

| Unknown | Why it matters | Script section |
|---|---|---|
| **Actual indexes** | The model declares zero. This is probably *the* performance answer | §8, §8b |
| **Actual foreign keys** | The model configures 25 — the DB may have more or fewer | §6 |
| **Row counts and table sizes** | No performance claim can be sized without them | §2 |
| **Triggers** | Invisible to EF. A classic source of "the migration lost a business rule" | §12 |
| **Stored procedures** | ~440 lines of commented-out proc calls exist in the repos. Do the procs still exist? Does anything else call them? | §10 |
| **Views** | | §9 |
| **Functions** | | §11 |
| **Check constraints** | | §7 |
| **Computed columns** | `PurchaseOrderDetail.ItemTotal` looks like a candidate | §3 |
| **Database collation** | Determines whether string comparison is case-insensitive today. Affects all 116 string columns | §0 |
| **Identity current values** | Needed to build `setval()` after the bulk load | §4 |
| **Schema drift** | Three clues in the model (`PK_Users` on table `User`, `PK_Form_1`, `PK_PODelevryAddress`) suggest tables have been renamed and recreated over time. **Re-scaffold and diff before trusting any of this** | all |

---

## 7. Suggested migration order (FK-dependency aware)

| Tier | Tables | Rationale |
|---|---|---|
| 0 | `countries`, `unit_master`, `form` | No outbound dependencies |
| 1 | `states` | → countries |
| 2 | `cities` | → states |
| 3 | `app_user` | 30 audit columns become FKs to it. **Self-referencing** — load with FKs `NOT VALID`, then `VALIDATE` |
| 4 | `company`, `site` | → geography, → app_user |
| 5 | `user_site`, `user_company` *(new)*, `user_form_permission`, `site_address`, `group_master` | |
| 6 | `supplier_master` | |
| 7 | `item_master` | |
| 8 | `purchase_request` | |
| 9 | `purchase_order` | |
| 10 | `purchase_order_detail`, `po_delivery_address` | |
| 11 | `supplier_invoice` | |
| 12 | `supplier_invoice_detail` | |
| 13 | `sales_invoice` | |
| 14 | `sales_invoice_detail` | |
| 15 | `item_inward`, `inventory_inward` | |
| 16 | `item_inward_document` | |
| — | `site_member`, `user_role`, `rolewise_form_permission`, `site_delivery_address` | **Do not migrate** until the live DB confirms whether they hold data. If empty, drop |

Full type mapping and target DDL are in [09-MSSQL-to-PostgreSQL-Mapping.md](09-MSSQL-to-PostgreSQL-Mapping.md).
