/*==============================================================================
  REFERENTIAL-INTEGRITY AND DUPLICATE CENSUS
  Database : DBAccManegment

  WHY THIS IS THE MOST IMPORTANT SCRIPT OF THE THREE
  --------------------------------------------------
  The EF Core model configures roughly 25 foreign keys, but roughly 62 columns
  in this schema are named like references (XxxId) and have NO foreign key
  behind them. That includes all four master/detail spines:

      PurchaseOrder      -> PurchaseOrderDetails.PORefId          (no FK)
      PurchaseOrder      -> PODeliveryAddress.POId                (no FK)
      SupplierInvoice    -> SupplierInvoiceDetails.RefInvoiceId   (no FK, NULLABLE)
      SalesInvoice       -> SalesInvoiceDetails.RefSalesInvoiceId (no FK, NULLABLE)

  PostgreSQL will refuse to create those constraints while orphan rows exist.
  The number of orphans is therefore the single biggest unknown in the schedule.
  Every non-zero result below is remediation work that must be scoped BEFORE a
  migration date is committed.

  READ-ONLY. Produces counts only.

  HOW TO RUN
  ----------
  SSMS -> Results To Grid (Ctrl+D is fine here) -> F5 -> save as
  E:\nakul\Chintan Kalathiya\AC\Migration-Assessment\db-extract\03-census.txt
==============================================================================*/

SET NOCOUNT ON;

/*----------------------------------------------------------------------------
  PART A — MASTER/DETAIL ORPHANS  (blocks the migration outright)
----------------------------------------------------------------------------*/
PRINT '################ A. MASTER/DETAIL ORPHANS ################';

SELECT 'PurchaseOrderDetails.PORefId -> PurchaseOrder.Id' AS relationship,
       COUNT(*) AS orphan_rows
FROM PurchaseOrderDetails d
LEFT JOIN PurchaseOrder p ON p.Id = d.PORefId
WHERE p.Id IS NULL
UNION ALL
SELECT 'PurchaseOrderDetails.PORefId IS NULL', COUNT(*)
FROM PurchaseOrderDetails WHERE PORefId IS NULL
UNION ALL
SELECT 'PODeliveryAddress.POId -> PurchaseOrder.Id', COUNT(*)
FROM PODeliveryAddress a
LEFT JOIN PurchaseOrder p ON p.Id = a.POId
WHERE p.Id IS NULL
UNION ALL
SELECT 'SupplierInvoiceDetails.RefInvoiceId -> SupplierInvoice.Id', COUNT(*)
FROM SupplierInvoiceDetails d
LEFT JOIN SupplierInvoice i ON i.Id = d.RefInvoiceId
WHERE d.RefInvoiceId IS NOT NULL AND i.Id IS NULL
UNION ALL
SELECT 'SupplierInvoiceDetails.RefInvoiceId IS NULL (unattachable)', COUNT(*)
FROM SupplierInvoiceDetails WHERE RefInvoiceId IS NULL
UNION ALL
SELECT 'SalesInvoiceDetails.RefSalesInvoiceId -> SalesInvoice.Id', COUNT(*)
FROM SalesInvoiceDetails d
LEFT JOIN SalesInvoice i ON i.Id = d.RefSalesInvoiceId
WHERE d.RefSalesInvoiceId IS NOT NULL AND i.Id IS NULL
UNION ALL
SELECT 'SalesInvoiceDetails.RefSalesInvoiceId IS NULL (unattachable)', COUNT(*)
FROM SalesInvoiceDetails WHERE RefSalesInvoiceId IS NULL
UNION ALL
SELECT 'ItemInWordDocument -> ItemInword (parent missing)', COUNT(*)
FROM ItemInWordDocument d
LEFT JOIN ItemInword i ON i.InwordId = d.InwordId
WHERE i.InwordId IS NULL;

/*----------------------------------------------------------------------------
  PART B — REFERENCE ORPHANS ON TRANSACTION TABLES
----------------------------------------------------------------------------*/
PRINT '';
PRINT '################ B. TRANSACTION -> MASTER ORPHANS ################';

SELECT 'SupplierInvoice.SupplierId -> SupplierMaster' AS relationship, COUNT(*) AS orphan_rows
FROM SupplierInvoice t LEFT JOIN SupplierMaster m ON m.SupplierId = t.SupplierId
WHERE t.SupplierId IS NOT NULL AND m.SupplierId IS NULL
UNION ALL
SELECT 'SupplierInvoice.CompanyId -> Company', COUNT(*)
FROM SupplierInvoice t LEFT JOIN Company m ON m.CompanyId = t.CompanyId
WHERE t.CompanyId IS NOT NULL AND m.CompanyId IS NULL
UNION ALL
SELECT 'SupplierInvoice.SiteId -> Site', COUNT(*)
FROM SupplierInvoice t LEFT JOIN Site m ON m.SiteId = t.SiteId
WHERE t.SiteId IS NOT NULL AND m.SiteId IS NULL
UNION ALL
SELECT 'PurchaseOrder.SiteId -> Site', COUNT(*)
FROM PurchaseOrder t LEFT JOIN Site m ON m.SiteId = t.SiteId
WHERE t.SiteId IS NOT NULL AND m.SiteId IS NULL
UNION ALL
SELECT 'PurchaseOrder.ToCompanyId -> Company', COUNT(*)
FROM PurchaseOrder t LEFT JOIN Company m ON m.CompanyId = t.ToCompanyId
WHERE t.ToCompanyId IS NOT NULL AND m.CompanyId IS NULL
UNION ALL
SELECT 'SupplierInvoiceDetails.ItemId -> ItemMaster', COUNT(*)
FROM SupplierInvoiceDetails t LEFT JOIN ItemMaster m ON m.ItemId = t.ItemId
WHERE t.ItemId IS NOT NULL AND m.ItemId IS NULL
UNION ALL
SELECT 'PurchaseOrderDetails.ItemId -> ItemMaster', COUNT(*)
FROM PurchaseOrderDetails t LEFT JOIN ItemMaster m ON m.ItemId = t.ItemId
WHERE t.ItemId IS NOT NULL AND m.ItemId IS NULL
UNION ALL
SELECT 'ItemInword.SiteId -> Site', COUNT(*)
FROM ItemInword t LEFT JOIN Site m ON m.SiteId = t.SiteId
WHERE t.SiteId IS NOT NULL AND m.SiteId IS NULL
UNION ALL
SELECT 'ItemInword.SupplierId -> SupplierMaster', COUNT(*)
FROM ItemInword t LEFT JOIN SupplierMaster m ON m.SupplierId = t.SupplierId
WHERE t.SupplierId IS NOT NULL AND m.SupplierId IS NULL
UNION ALL
SELECT 'InventoryInward.SiteId -> Site', COUNT(*)
FROM InventoryInward t LEFT JOIN Site m ON m.SiteId = t.SiteId
WHERE t.SiteId IS NOT NULL AND m.SiteId IS NULL;

/*----------------------------------------------------------------------------
  PART C — AUDIT COLUMN ORPHANS  (CreatedBy / UpdatedBy -> User.Id)
  30 such columns exist across 15 tables; none has an FK. Expect orphans from
  deleted users and from bootstrap/system GUIDs.
----------------------------------------------------------------------------*/
PRINT '';
PRINT '################ C. AUDIT COLUMN ORPHANS ################';

SELECT 'SupplierInvoice.CreatedBy -> User' AS relationship, COUNT(*) AS orphan_rows
FROM SupplierInvoice t LEFT JOIN [User] u ON u.Id = t.CreatedBy
WHERE t.CreatedBy IS NOT NULL AND u.Id IS NULL
UNION ALL
SELECT 'PurchaseOrder.CreatedBy -> User', COUNT(*)
FROM PurchaseOrder t LEFT JOIN [User] u ON u.Id = t.CreatedBy
WHERE t.CreatedBy IS NOT NULL AND u.Id IS NULL
UNION ALL
SELECT 'SalesInvoice.CreatedBy -> User', COUNT(*)
FROM SalesInvoice t LEFT JOIN [User] u ON u.Id = t.CreatedBy
WHERE t.CreatedBy IS NOT NULL AND u.Id IS NULL
UNION ALL
SELECT 'ItemMaster.CreatedBy -> User', COUNT(*)
FROM ItemMaster t LEFT JOIN [User] u ON u.Id = t.CreatedBy
WHERE t.CreatedBy IS NOT NULL AND u.Id IS NULL
UNION ALL
SELECT 'SupplierMaster.CreatedBy -> User', COUNT(*)
FROM SupplierMaster t LEFT JOIN [User] u ON u.Id = t.CreatedBy
WHERE t.CreatedBy IS NOT NULL AND u.Id IS NULL
UNION ALL
SELECT 'Site.CreatedBy -> User', COUNT(*)
FROM Site t LEFT JOIN [User] u ON u.Id = t.CreatedBy
WHERE t.CreatedBy IS NOT NULL AND u.Id IS NULL
UNION ALL
SELECT 'User.CreatedBy -> User (self-reference)', COUNT(*)
FROM [User] t LEFT JOIN [User] u ON u.Id = t.CreatedBy
WHERE t.CreatedBy IS NOT NULL AND u.Id IS NULL;

/*----------------------------------------------------------------------------
  PART D — DUPLICATE CENSUS  (blocks the UNIQUE constraints we want to add)
----------------------------------------------------------------------------*/
PRINT '';
PRINT '################ D. DUPLICATE BUSINESS KEYS ################';

PRINT '--- D1: duplicate supplier invoice numbers per company (GST compliance) ---';
SELECT CompanyId, InvoiceNo, COUNT(*) AS dupe_count
FROM SupplierInvoice
WHERE InvoiceNo IS NOT NULL AND InvoiceNo NOT IN ('PayOut','Opening Balance')
GROUP BY CompanyId, InvoiceNo
HAVING COUNT(*) > 1
ORDER BY dupe_count DESC;

PRINT '--- D2: duplicate PO numbers per company ---';
SELECT ToCompanyId, POId, COUNT(*) AS dupe_count
FROM PurchaseOrder
WHERE POId IS NOT NULL
GROUP BY ToCompanyId, POId
HAVING COUNT(*) > 1
ORDER BY dupe_count DESC;

PRINT '--- D3: duplicate PR numbers ---';
SELECT PrNo, COUNT(*) AS dupe_count
FROM PurchaseRequest
WHERE PrNo IS NOT NULL
GROUP BY PrNo HAVING COUNT(*) > 1
ORDER BY dupe_count DESC;

PRINT '--- D4: duplicate sales invoice numbers per company ---';
SELECT CompanyId, SalesInvoiceNo, COUNT(*) AS dupe_count
FROM SalesInvoice
WHERE SalesInvoiceNo IS NOT NULL AND SalesInvoiceNo <> 'PayIn'
GROUP BY CompanyId, SalesInvoiceNo
HAVING COUNT(*) > 1
ORDER BY dupe_count DESC;

PRINT '--- D5: duplicate usernames / emails ---';
SELECT UserName, COUNT(*) AS dupe_count FROM [User] GROUP BY UserName HAVING COUNT(*) > 1;
SELECT Email,    COUNT(*) AS dupe_count FROM [User] WHERE Email IS NOT NULL GROUP BY Email HAVING COUNT(*) > 1;

PRINT '--- D6: duplicate item names ---';
SELECT ItemName, COUNT(*) AS dupe_count
FROM ItemMaster GROUP BY ItemName HAVING COUNT(*) > 1 ORDER BY dupe_count DESC;

PRINT '--- D7: duplicate user/form permission rows ---';
SELECT UserId, FormId, COUNT(*) AS dupe_count
FROM UserwiseFormPermission GROUP BY UserId, FormId HAVING COUNT(*) > 1 ORDER BY dupe_count DESC;

/*----------------------------------------------------------------------------
  PART E — SENTINEL VALUES IN BUSINESS-KEY COLUMNS
  The code overloads document-number columns with type discriminators. These
  rows will break any UNIQUE constraint and must be modelled properly.
----------------------------------------------------------------------------*/
PRINT '';
PRINT '################ E. SENTINEL VALUES IN DOCUMENT NUMBER COLUMNS ################';

SELECT 'SupplierInvoice.InvoiceNo' AS column_name, InvoiceNo AS sentinel_value, COUNT(*) AS row_count
FROM SupplierInvoice
WHERE InvoiceNo IN ('PayOut','Opening Balance') OR InvoiceNo IS NULL
GROUP BY InvoiceNo
UNION ALL
SELECT 'SalesInvoice.SalesInvoiceNo', SalesInvoiceNo, COUNT(*)
FROM SalesInvoice
WHERE SalesInvoiceNo IN ('PayIn','Opening Balance') OR SalesInvoiceNo IS NULL
GROUP BY SalesInvoiceNo;

PRINT '--- E2: distinct InvoiceType / PaymentStatus values (needed before defining enums) ---';
SELECT 'SupplierInvoice.InvoiceType' AS col, InvoiceType AS value, COUNT(*) AS row_count
FROM SupplierInvoice GROUP BY InvoiceType
UNION ALL
SELECT 'SupplierInvoice.PaymentStatus', PaymentStatus, COUNT(*)
FROM SupplierInvoice GROUP BY PaymentStatus
UNION ALL
SELECT 'SalesInvoice.InvoiceType', InvoiceType, COUNT(*)
FROM SalesInvoice GROUP BY InvoiceType
UNION ALL
SELECT 'SalesInvoice.PaymentStatus', PaymentStatus, COUNT(*)
FROM SalesInvoice GROUP BY PaymentStatus;

/*----------------------------------------------------------------------------
  PART F — THE CSV GUID COLUMNS  (User.SiteId / User.CompanyId)
  These nvarchar(max) comma-separated GUID lists drive authorisation.
  They must become junction tables. This measures the job.
----------------------------------------------------------------------------*/
PRINT '';
PRINT '################ F. CSV GUID COLUMNS ON [User] ################';

SELECT
    COUNT(*)                                                                   AS total_users,
    SUM(CASE WHEN SiteId    IS NULL OR SiteId    = '' THEN 1 ELSE 0 END)       AS users_with_no_sites,
    SUM(CASE WHEN CompanyId IS NULL OR CompanyId = '' THEN 1 ELSE 0 END)       AS users_with_no_companies,
    MAX(LEN(SiteId))                                                           AS longest_siteid_csv,
    MAX(LEN(CompanyId))                                                        AS longest_companyid_csv
FROM [User];

PRINT '--- F2: site GUID fragments that do not resolve to a real Site ---';
SELECT COUNT(*) AS unresolvable_site_grants
FROM [User] u
CROSS APPLY STRING_SPLIT(ISNULL(u.SiteId,''), ',') s
WHERE LTRIM(RTRIM(s.value)) <> ''
  AND TRY_CONVERT(uniqueidentifier, LTRIM(RTRIM(s.value))) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM Site x WHERE x.SiteId = TRY_CONVERT(uniqueidentifier, LTRIM(RTRIM(s.value))));

PRINT '--- F3: fragments that are not even valid GUIDs (silently dropped today) ---';
SELECT COUNT(*) AS malformed_site_fragments
FROM [User] u
CROSS APPLY STRING_SPLIT(ISNULL(u.SiteId,''), ',') s
WHERE LTRIM(RTRIM(s.value)) <> ''
  AND TRY_CONVERT(uniqueidentifier, LTRIM(RTRIM(s.value))) IS NULL;

/*----------------------------------------------------------------------------
  PART G — NULL BOOLEANS
  22 bit columns are nullable. The application filters `IsDeleted == false`,
  so rows with NULL are currently INVISIBLE. Backfilling NULL -> false will
  make them appear. Count them first and get business sign-off.
----------------------------------------------------------------------------*/
PRINT '';
PRINT '################ G. NULL BOOLEAN FLAGS (rows the app is currently hiding) ################';

SELECT 'SupplierInvoice.IsApproved IS NULL' AS flag, COUNT(*) AS row_count FROM SupplierInvoice WHERE IsApproved IS NULL
UNION ALL SELECT 'PurchaseOrder.IsApproved IS NULL',  COUNT(*) FROM PurchaseOrder  WHERE IsApproved IS NULL
UNION ALL SELECT 'PurchaseOrder.IsDeleted IS NULL',   COUNT(*) FROM PurchaseOrder  WHERE IsDeleted  IS NULL
UNION ALL SELECT 'ItemMaster.IsDeleted IS NULL',      COUNT(*) FROM ItemMaster     WHERE IsDeleted  IS NULL
UNION ALL SELECT 'ItemMaster.IsApproved IS NULL',     COUNT(*) FROM ItemMaster     WHERE IsApproved IS NULL
UNION ALL SELECT 'Site.IsDeleted IS NULL',            COUNT(*) FROM Site           WHERE IsDeleted  IS NULL
UNION ALL SELECT 'PurchaseRequest.IsDeleted IS NULL', COUNT(*) FROM PurchaseRequest WHERE IsDeleted IS NULL
UNION ALL SELECT 'ItemInword.IsDeleted IS NULL',      COUNT(*) FROM ItemInword     WHERE IsDeleted  IS NULL;

/*----------------------------------------------------------------------------
  PART H — MONEY RECONCILIATION
  All money arithmetic currently happens in browser JavaScript and the server
  persists whatever it is told. This checks whether stored header totals
  actually agree with their line items. Any mismatch is pre-existing corruption
  that a server-side calculator will expose.
----------------------------------------------------------------------------*/
PRINT '';
PRINT '################ H. HEADER vs LINE-ITEM TOTAL RECONCILIATION ################';

PRINT '--- H1: supplier invoices whose header TotalAmount disagrees with SUM(lines) by > 1.00 ---';
SELECT COUNT(*) AS mismatched_supplier_invoices
FROM SupplierInvoice i
CROSS APPLY (
    SELECT SUM(ISNULL(d.TotalAmount,0)) AS line_total
    FROM SupplierInvoiceDetails d WHERE d.RefInvoiceId = i.Id
) x
WHERE x.line_total IS NOT NULL
  AND ABS(ISNULL(i.TotalAmount,0) - x.line_total) > 1.00;

PRINT '--- H2: same for sales invoices ---';
SELECT COUNT(*) AS mismatched_sales_invoices
FROM SalesInvoice i
CROSS APPLY (
    SELECT SUM(ISNULL(d.TotalAmount,0)) AS line_total
    FROM SalesInvoiceDetails d WHERE d.RefSalesInvoiceId = i.Id
) x
WHERE x.line_total IS NOT NULL
  AND ABS(ISNULL(i.TotalAmount,0) - x.line_total) > 1.00;

PRINT '--- H3: detail rows with NULL money (currently skipped by SUM) ---';
SELECT 'SupplierInvoiceDetails.TotalAmount IS NULL' AS col, COUNT(*) AS row_count
FROM SupplierInvoiceDetails WHERE TotalAmount IS NULL
UNION ALL SELECT 'SupplierInvoiceDetails.Gst IS NULL', COUNT(*) FROM SupplierInvoiceDetails WHERE Gst IS NULL
UNION ALL SELECT 'SalesInvoiceDetails.TotalAmount IS NULL', COUNT(*) FROM SalesInvoiceDetails WHERE TotalAmount IS NULL
UNION ALL SELECT 'SalesInvoiceDetails.Gst IS NULL', COUNT(*) FROM SalesInvoiceDetails WHERE Gst IS NULL;

PRINT '';
PRINT '################ END OF CENSUS ################';
