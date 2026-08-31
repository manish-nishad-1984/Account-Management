/*==============================================================================
  MSSQL PERFORMANCE EVIDENCE EXTRACTION (DMVs)
  Database : DBAccManegment

  WHY THIS MATTERS
  ----------------
  The code analysis identified the *likely* bottlenecks by reading the source.
  This script produces the *measured* evidence that either confirms or refutes
  them. Do not commit to a performance work plan without it.

  IMPORTANT: DMV statistics reset when SQL Server restarts. Run this after the
  system has been under normal production load for at least a full working day.
  Check `sqlserver_start_time` in section 0 before trusting the numbers.

  HOW TO RUN
  ----------
  Same as 01: SSMS -> Results To Text -> F5 -> save as
  E:\nakul\Chintan Kalathiya\AC\Migration-Assessment\db-extract\02-perf.txt

  READ-ONLY.
==============================================================================*/

SET NOCOUNT ON;

PRINT '################ 0. UPTIME (how much history do these numbers cover?) ################';
SELECT
    sqlserver_start_time,
    DATEDIFF(HOUR, sqlserver_start_time, GETDATE()) AS hours_of_history
FROM sys.dm_os_sys_info;

PRINT '';
PRINT '################ 1. TOP 30 QUERIES BY TOTAL WORKER TIME (CPU) ################';
SELECT TOP 30
    qs.execution_count,
    CAST(qs.total_worker_time  / 1000.0 AS DECIMAL(18,2)) AS total_cpu_ms,
    CAST(qs.total_worker_time  / 1000.0 / NULLIF(qs.execution_count,0) AS DECIMAL(18,2)) AS avg_cpu_ms,
    CAST(qs.total_elapsed_time / 1000.0 AS DECIMAL(18,2)) AS total_elapsed_ms,
    CAST(qs.total_elapsed_time / 1000.0 / NULLIF(qs.execution_count,0) AS DECIMAL(18,2)) AS avg_elapsed_ms,
    qs.total_logical_reads,
    qs.total_logical_reads / NULLIF(qs.execution_count,0) AS avg_logical_reads,
    qs.total_rows / NULLIF(qs.execution_count,0)          AS avg_rows_returned,
    qs.last_execution_time,
    SUBSTRING(st.text, (qs.statement_start_offset/2)+1,
        ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
          ELSE qs.statement_end_offset END - qs.statement_start_offset)/2)+1) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY qs.total_worker_time DESC;

PRINT '';
PRINT '################ 2. TOP 30 QUERIES BY TOTAL LOGICAL READS (I/O) ################';
/* This is where unpaged list queries and the N+1 loops will surface. */
SELECT TOP 30
    qs.execution_count,
    qs.total_logical_reads,
    qs.total_logical_reads / NULLIF(qs.execution_count,0) AS avg_logical_reads,
    CAST(qs.total_elapsed_time / 1000.0 / NULLIF(qs.execution_count,0) AS DECIMAL(18,2)) AS avg_elapsed_ms,
    qs.total_rows / NULLIF(qs.execution_count,0)          AS avg_rows_returned,
    SUBSTRING(st.text, (qs.statement_start_offset/2)+1,
        ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
          ELSE qs.statement_end_offset END - qs.statement_start_offset)/2)+1) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY qs.total_logical_reads DESC;

PRINT '';
PRINT '################ 3. TOP 30 MOST-EXECUTED QUERIES ################';
/* An N+1 loop shows up here as a small, fast query with an enormous
   execution_count. That signature is the proof of the N+1 findings. */
SELECT TOP 30
    qs.execution_count,
    CAST(qs.total_elapsed_time / 1000.0 / NULLIF(qs.execution_count,0) AS DECIMAL(18,2)) AS avg_elapsed_ms,
    CAST(qs.total_elapsed_time / 1000.0 AS DECIMAL(18,2)) AS total_elapsed_ms,
    qs.total_logical_reads / NULLIF(qs.execution_count,0) AS avg_logical_reads,
    SUBSTRING(st.text, (qs.statement_start_offset/2)+1,
        ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
          ELSE qs.statement_end_offset END - qs.statement_start_offset)/2)+1) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY qs.execution_count DESC;

PRINT '';
PRINT '################ 4. MISSING INDEX RECOMMENDATIONS (ranked) ################';
/* Treat as hypotheses, not instructions. Consolidate overlapping suggestions
   before creating anything, and never create all of them. */
SELECT TOP 40
    CAST(migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) AS DECIMAL(18,2)) AS improvement_measure,
    OBJECT_NAME(mid.object_id)   AS table_name,
    migs.user_seeks,
    migs.user_scans,
    migs.last_user_seek,
    CAST(migs.avg_total_user_cost AS DECIMAL(18,4)) AS avg_query_cost,
    CAST(migs.avg_user_impact     AS DECIMAL(18,2)) AS avg_pct_benefit,
    mid.equality_columns,
    mid.inequality_columns,
    mid.included_columns,
    'CREATE INDEX IX_' + OBJECT_NAME(mid.object_id) + '_'
      + REPLACE(REPLACE(REPLACE(ISNULL(mid.equality_columns,''),', ','_'),'[',''),']','')
      + ' ON ' + mid.statement
      + ' (' + ISNULL(mid.equality_columns,'')
      + CASE WHEN mid.equality_columns IS NOT NULL AND mid.inequality_columns IS NOT NULL THEN ',' ELSE '' END
      + ISNULL(mid.inequality_columns,'') + ')'
      + ISNULL(' INCLUDE (' + mid.included_columns + ')','') AS suggested_ddl
FROM sys.dm_db_missing_index_groups mig
JOIN sys.dm_db_missing_index_group_stats migs ON migs.group_handle = mig.index_group_handle
JOIN sys.dm_db_missing_index_details mid      ON mid.index_handle  = mig.index_handle
WHERE mid.database_id = DB_ID()
ORDER BY improvement_measure DESC;

PRINT '';
PRINT '################ 5. INDEX USAGE — which existing indexes actually earn their keep ################';
SELECT
    OBJECT_NAME(i.object_id) AS table_name,
    i.name                   AS index_name,
    i.type_desc,
    ISNULL(ius.user_seeks,0)   AS seeks,
    ISNULL(ius.user_scans,0)   AS scans,
    ISNULL(ius.user_lookups,0) AS lookups,
    ISNULL(ius.user_updates,0) AS writes,
    ius.last_user_seek,
    ius.last_user_scan
FROM sys.indexes i
JOIN sys.tables t ON t.object_id = i.object_id
LEFT JOIN sys.dm_db_index_usage_stats ius
       ON ius.object_id = i.object_id AND ius.index_id = i.index_id AND ius.database_id = DB_ID()
WHERE i.type > 0
ORDER BY table_name, seeks + scans + lookups DESC;

PRINT '';
PRINT '################ 6. TABLE SCAN HOTSPOTS ################';
/* High user_scans on a large heap/clustered index = full table scan in production. */
SELECT
    OBJECT_NAME(ius.object_id) AS table_name,
    i.name                     AS index_name,
    i.type_desc,
    ius.user_scans,
    ius.user_seeks,
    p.rows                     AS row_count
FROM sys.dm_db_index_usage_stats ius
JOIN sys.indexes i    ON i.object_id = ius.object_id AND i.index_id = ius.index_id
JOIN sys.partitions p ON p.object_id = ius.object_id AND p.index_id = ius.index_id
WHERE ius.database_id = DB_ID() AND ius.user_scans > 0 AND i.index_id <= 1
ORDER BY ius.user_scans DESC;

PRINT '';
PRINT '################ 7. WAIT STATISTICS (what the server is actually waiting on) ################';
SELECT TOP 25
    wait_type,
    CAST(wait_time_ms / 1000.0 AS DECIMAL(18,2))                     AS wait_time_s,
    CAST(signal_wait_time_ms / 1000.0 AS DECIMAL(18,2))              AS signal_wait_s,
    waiting_tasks_count,
    CAST(wait_time_ms / NULLIF(waiting_tasks_count,0) AS DECIMAL(18,2)) AS avg_wait_ms
FROM sys.dm_os_wait_stats
WHERE waiting_tasks_count > 0
  AND wait_type NOT IN (
    'CLR_SEMAPHORE','LAZYWRITER_SLEEP','RESOURCE_QUEUE','SLEEP_TASK','SLEEP_SYSTEMTASK',
    'SQLTRACE_BUFFER_FLUSH','WAITFOR','LOGMGR_QUEUE','CHECKPOINT_QUEUE','REQUEST_FOR_DEADLOCK_SEARCH',
    'XE_TIMER_EVENT','BROKER_TO_FLUSH','BROKER_TASK_STOP','CLR_MANUAL_EVENT','CLR_AUTO_EVENT',
    'DISPATCHER_QUEUE_SEMAPHORE','FT_IFTS_SCHEDULER_IDLE_WAIT','XE_DISPATCHER_WAIT','XE_DISPATCHER_JOIN',
    'SQLTRACE_INCREMENTAL_FLUSH_SLEEP','HADR_FILESTREAM_IOMGR_IOCOMPLETION','DIRTY_PAGE_POLL',
    'SP_SERVER_DIAGNOSTICS_SLEEP','HADR_CLUSAPI_CALL','QDS_ASYNC_QUEUE','QDS_SHUTDOWN_QUEUE',
    'PREEMPTIVE_XE_GETTARGETSTATE','BROKER_EVENTHANDLER','SLEEP_DBSTARTUP','SLEEP_DCOMSTARTUP')
ORDER BY wait_time_ms DESC;

PRINT '';
PRINT '################ 8. CURRENTLY BLOCKING / BLOCKED SESSIONS ################';
SELECT
    r.session_id,
    r.blocking_session_id,
    r.wait_type,
    r.wait_time            AS wait_time_ms,
    r.wait_resource,
    r.status,
    r.command,
    DB_NAME(r.database_id) AS database_name,
    t.text                 AS running_sql
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.session_id > 50
ORDER BY r.blocking_session_id DESC, r.wait_time DESC;

PRINT '';
PRINT '################ 9. CONNECTION / SESSION COUNT BY APPLICATION ################';
/* Confirms whether connection pooling is behaving. A very high count from the
   API process points at the socket-exhaustion problem found in the Web tier. */
SELECT
    program_name,
    login_name,
    host_name,
    COUNT(*) AS session_count
FROM sys.dm_exec_sessions
WHERE is_user_process = 1
GROUP BY program_name, login_name, host_name
ORDER BY session_count DESC;

PRINT '';
PRINT '################ 10. INDEX FRAGMENTATION (>10% on tables >1000 pages) ################';
SELECT
    OBJECT_NAME(ips.object_id) AS table_name,
    i.name                     AS index_name,
    CAST(ips.avg_fragmentation_in_percent AS DECIMAL(18,2)) AS frag_pct,
    ips.page_count
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
JOIN sys.indexes i ON i.object_id = ips.object_id AND i.index_id = ips.index_id
WHERE ips.avg_fragmentation_in_percent > 10 AND ips.page_count > 1000
ORDER BY ips.avg_fragmentation_in_percent DESC;

PRINT '';
PRINT '################ 11. DEADLOCK HISTORY (system_health XEvent ring buffer) ################';
/* The document-numbering race conditions and the "load whole table then update
   every row" bulk-approve methods are prime deadlock candidates. */
SELECT TOP 20
    XEventData.XEvent.value('(data/value)[1]','VARCHAR(MAX)') AS deadlock_graph
FROM (
    SELECT CAST(target_data AS XML) AS TargetData
    FROM sys.dm_xe_session_targets st
    JOIN sys.dm_xe_sessions s ON s.address = st.event_session_address
    WHERE s.name = 'system_health' AND st.target_name = 'ring_buffer'
) AS Data
CROSS APPLY TargetData.nodes('RingBufferTarget/event[@name="xml_deadlock_report"]') AS XEventData(XEvent);

PRINT '';
PRINT '################ END OF PERFORMANCE EXTRACT ################';
