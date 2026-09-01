/*==============================================================================
  MSSQL SCHEMA + PERFORMANCE EXTRACTION
  Database : DBAccManegment
  Purpose  : Fill the gaps the EF Core model cannot answer (indexes, constraints,
             triggers, procs, views, functions, row counts, missing-index DMVs).

  HOW TO RUN
  ----------
  1. Open SSMS, connect to srv1925876.hstgr.cloud,1433, select DBAccManegment.
  2. Query -> Results To -> Results To Text   (Ctrl+T)
  3. Tools -> Options -> Query Results -> SQL Server -> Results to Text
        Maximum number of characters displayed in each column = 8192
  4. Execute (F5).
  5. Save output as:  E:\nakul\Chintan Kalathiya\AC\Migration-Assessment\db-extract\01-schema.txt
  6. Then run 02-extract-perf-dmv.sql the same way -> 02-perf.txt

  READ-ONLY. This script creates nothing and changes nothing.
==============================================================================*/

SET NOCOUNT ON;

PRINT '################ 0. SERVER / DATABASE CONTEXT ################';
SELECT
    @@VERSION                                        AS sql_server_version,
    DB_NAME()                                        AS database_name,
    DATABASEPROPERTYEX(DB_NAME(),'Collation')        AS db_collation,
    DATABASEPROPERTYEX(DB_NAME(),'Recovery')         AS recovery_model,
    (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) AS compat_level,
    (SELECT is_query_store_on FROM sys.databases WHERE name = DB_NAME())   AS query_store_enabled;

PRINT '';
PRINT '################ 1. DATABASE SIZE ################';
SELECT
    name              AS logical_file,
    type_desc,
    physical_name,
    CAST(size/128.0 AS DECIMAL(18,2))                AS size_mb,
    CAST(FILEPROPERTY(name,'SpaceUsed')/128.0 AS DECIMAL(18,2)) AS used_mb
FROM sys.database_files;

PRINT '';
PRINT '################ 2. TABLES + ROW COUNTS + STORAGE ################';
/* Row counts are the single most important number for sizing the migration. */
SELECT
    s.name                                           AS schema_name,
    t.name                                           AS table_name,
    p.rows                                           AS row_count,
    CAST(SUM(a.total_pages)   * 8 / 1024.0 AS DECIMAL(18,2)) AS total_mb,
    CAST(SUM(a.used_pages)    * 8 / 1024.0 AS DECIMAL(18,2)) AS used_mb,
    t.create_date,
    t.modify_date
FROM sys.tables t
JOIN sys.schemas s        ON s.schema_id = t.schema_id
JOIN sys.indexes i        ON i.object_id = t.object_id
JOIN sys.partitions p     ON p.object_id = i.object_id AND p.index_id = i.index_id
JOIN sys.allocation_units a ON a.container_id = p.partition_id
WHERE i.index_id <= 1
GROUP BY s.name, t.name, p.rows, t.create_date, t.modify_date
ORDER BY p.rows DESC;

PRINT '';
PRINT '################ 3. ALL COLUMNS (full definition) ################';
SELECT
    s.name        AS schema_name,
    t.name        AS table_name,
    c.column_id   AS ord,
    c.name        AS column_name,
    ty.name       AS data_type,
    CASE
      WHEN ty.name IN ('nvarchar','nchar') AND c.max_length <> -1 THEN c.max_length/2
      WHEN c.max_length = -1 THEN -1
      ELSE c.max_length
    END           AS length_chars,
    c.precision,
    c.scale,
    c.is_nullable,
    c.is_identity,
    c.is_computed,
    cc.definition AS computed_definition,
    dc.definition AS default_definition,
    c.collation_name
FROM sys.columns c
JOIN sys.tables t              ON t.object_id = c.object_id
JOIN sys.schemas s             ON s.schema_id = t.schema_id
JOIN sys.types ty              ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
ORDER BY t.name, c.column_id;

PRINT '';
PRINT '################ 4. IDENTITY COLUMNS (seed/increment/current) ################';
/* Needed to build setval() statements after the PostgreSQL bulk load. */
SELECT
    OBJECT_SCHEMA_NAME(ic.object_id) AS schema_name,
    OBJECT_NAME(ic.object_id)        AS table_name,
    ic.name                          AS column_name,
    ic.seed_value,
    ic.increment_value,
    ic.last_value
FROM sys.identity_columns ic
ORDER BY table_name;

PRINT '';
PRINT '################ 5. PRIMARY KEYS + UNIQUE CONSTRAINTS ################';
SELECT
    OBJECT_SCHEMA_NAME(kc.parent_object_id) AS schema_name,
    OBJECT_NAME(kc.parent_object_id)        AS table_name,
    kc.name                                 AS constraint_name,
    kc.type_desc                            AS constraint_type,
    STUFF((SELECT ', ' + c2.name
           FROM sys.index_columns ic2
           JOIN sys.columns c2 ON c2.object_id = ic2.object_id AND c2.column_id = ic2.column_id
           WHERE ic2.object_id = kc.parent_object_id AND ic2.index_id = kc.unique_index_id
           ORDER BY ic2.key_ordinal
           FOR XML PATH('')),1,2,'')        AS key_columns
FROM sys.key_constraints kc
ORDER BY table_name, kc.type_desc;

PRINT '';
PRINT '################ 6. FOREIGN KEYS (with cascade behaviour) ################';
/* CRITICAL: the EF model configures ~25 FKs. This tells us what is ACTUALLY
   enforced in the database. Any difference is a data-integrity landmine. */
SELECT
    fk.name                                   AS fk_name,
    OBJECT_SCHEMA_NAME(fk.parent_object_id)   AS parent_schema,
    OBJECT_NAME(fk.parent_object_id)          AS parent_table,
    pc.name                                   AS parent_column,
    OBJECT_NAME(fk.referenced_object_id)      AS referenced_table,
    rc.name                                   AS referenced_column,
    fk.delete_referential_action_desc         AS on_delete,
    fk.update_referential_action_desc         AS on_update,
    fk.is_disabled,
    fk.is_not_trusted
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id     AND pc.column_id = fkc.parent_column_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
ORDER BY parent_table, fk.name;

PRINT '';
PRINT '################ 7. CHECK CONSTRAINTS ################';
SELECT
    OBJECT_SCHEMA_NAME(cc.parent_object_id) AS schema_name,
    OBJECT_NAME(cc.parent_object_id)        AS table_name,
    cc.name                                 AS constraint_name,
    cc.definition,
    cc.is_disabled,
    cc.is_not_trusted
FROM sys.check_constraints cc
ORDER BY table_name;

PRINT '';
PRINT '################ 8. INDEXES (THE BIG ONE) ################';
/* The EF model declares ZERO HasIndex(). Either this DB has no secondary
   indexes at all (a severe production problem and probably THE cause of the
   reported slowness), or the scaffold simply dropped them. This query settles it. */
SELECT
    OBJECT_SCHEMA_NAME(i.object_id) AS schema_name,
    OBJECT_NAME(i.object_id)        AS table_name,
    i.name                          AS index_name,
    i.type_desc,
    i.is_unique,
    i.is_primary_key,
    i.is_unique_constraint,
    i.has_filter,
    i.filter_definition,
    i.fill_factor,
    STUFF((SELECT ', ' + c.name + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE '' END
           FROM sys.index_columns ic
           JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
           WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
           ORDER BY ic.key_ordinal
           FOR XML PATH('')),1,2,'') AS key_columns,
    STUFF((SELECT ', ' + c.name
           FROM sys.index_columns ic
           JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
           WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
           ORDER BY ic.index_column_id
           FOR XML PATH('')),1,2,'') AS included_columns
FROM sys.indexes i
JOIN sys.tables t ON t.object_id = i.object_id
WHERE i.type > 0
ORDER BY table_name, i.index_id;

PRINT '';
PRINT '################ 8b. TABLES WITH NO NONCLUSTERED INDEX AT ALL ################';
SELECT
    t.name AS table_name,
    p.rows AS row_count
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
WHERE NOT EXISTS (SELECT 1 FROM sys.indexes i WHERE i.object_id = t.object_id AND i.type = 2)
ORDER BY p.rows DESC;

PRINT '';
PRINT '################ 9. VIEWS ################';
SELECT
    OBJECT_SCHEMA_NAME(v.object_id) AS schema_name,
    v.name                          AS view_name,
    m.definition
FROM sys.views v
LEFT JOIN sys.sql_modules m ON m.object_id = v.object_id
ORDER BY v.name;

PRINT '';
PRINT '################ 10. STORED PROCEDURES ################';
/* The repository layer contains ~440 lines of COMMENTED-OUT stored procedure
   calls. This tells us whether those procs still exist and whether anything
   else still calls them. */
SELECT
    OBJECT_SCHEMA_NAME(p.object_id) AS schema_name,
    p.name                          AS proc_name,
    p.create_date,
    p.modify_date,
    m.definition
FROM sys.procedures p
LEFT JOIN sys.sql_modules m ON m.object_id = p.object_id
ORDER BY p.name;

PRINT '';
PRINT '################ 11. FUNCTIONS ################';
SELECT
    OBJECT_SCHEMA_NAME(o.object_id) AS schema_name,
    o.name                          AS function_name,
    o.type_desc,
    o.create_date,
    o.modify_date,
    m.definition
FROM sys.objects o
LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
WHERE o.type IN ('FN','IF','TF','AF')
ORDER BY o.name;

PRINT '';
PRINT '################ 12. TRIGGERS ################';
/* Triggers are invisible to the EF model and are a classic source of
   "the migration lost a business rule". */
SELECT
    OBJECT_SCHEMA_NAME(tr.parent_id) AS schema_name,
    OBJECT_NAME(tr.parent_id)        AS table_name,
    tr.name                          AS trigger_name,
    tr.is_disabled,
    tr.is_instead_of_trigger,
    m.definition
FROM sys.triggers tr
LEFT JOIN sys.sql_modules m ON m.object_id = tr.object_id
WHERE tr.parent_class = 1
ORDER BY table_name, tr.name;

PRINT '';
PRINT '################ 13. SEQUENCES ################';
SELECT name, start_value, increment, current_value, minimum_value, maximum_value, is_cycling
FROM sys.sequences ORDER BY name;

PRINT '';
PRINT '################ 14. FULL-TEXT INDEXES ################';
SELECT
    OBJECT_NAME(fi.object_id) AS table_name,
    c.name                    AS column_name,
    fc.name                   AS catalog_name
FROM sys.fulltext_indexes fi
JOIN sys.fulltext_index_columns fic ON fic.object_id = fi.object_id
JOIN sys.columns c ON c.object_id = fic.object_id AND c.column_id = fic.column_id
JOIN sys.fulltext_catalogs fc ON fc.fulltext_catalog_id = fi.fulltext_catalog_id
ORDER BY table_name;

PRINT '';
PRINT '################ 15. TABLES WITH NO PRIMARY KEY ################';
SELECT s.name AS schema_name, t.name AS table_name
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE NOT EXISTS (SELECT 1 FROM sys.key_constraints kc
                  WHERE kc.parent_object_id = t.object_id AND kc.type = 'PK')
ORDER BY t.name;

PRINT '';
PRINT '################ 16. DATABASE USERS / ROLES / PERMISSIONS ################';
SELECT
    dp.name          AS principal_name,
    dp.type_desc     AS principal_type,
    STUFF((SELECT ', ' + r.name
           FROM sys.database_role_members rm
           JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
           WHERE rm.member_principal_id = dp.principal_id
           FOR XML PATH('')),1,2,'') AS roles
FROM sys.database_principals dp
WHERE dp.type IN ('S','U','G') AND dp.principal_id > 4
ORDER BY dp.name;

PRINT '';
PRINT '################ END OF SCHEMA EXTRACT ################';
