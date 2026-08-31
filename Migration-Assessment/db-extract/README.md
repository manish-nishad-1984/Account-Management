# db-extract — put the script outputs here

Save the three SSMS outputs into this folder with these exact names:

| Run this | Save output as |
|---|---|
| `tools/01-extract-mssql-schema.sql` | `01-schema.txt` |
| `tools/02-extract-perf-dmv.sql` | `02-perf.txt` |
| `tools/03-orphan-and-duplicate-census.sql` | `03-census.txt` |

## SSMS settings before you run

1. Connect to `srv1925876.hstgr.cloud,1433`, select database **DBAccManegment**
2. **Query → Results To → Results to Text** (or `Ctrl+T`)
3. **Tools → Options → Query Results → SQL Server → Results to Text**
   → set *Maximum number of characters displayed in each column* to **8192**
   (the default 256 will truncate stored procedure and index definitions)
4. Open the script, press **F5**
5. **File → Save Results As…** → save into this folder with the name above

All three scripts are READ-ONLY. They create nothing and change nothing.

## Notes

- Script 02 reads DMV statistics that reset on SQL Server restart. Check the
  `hours_of_history` value in its section 0 — if it is very low, the server
  restarted recently and the numbers are not yet representative. Re-run it after
  a full working day of normal load.
- Script 03 is the important one. It measures the referential-integrity gap that
  is currently the largest unknown in the migration schedule.
- If any query errors because a table or column name differs from what the EF
  model said, that is itself a finding (schema drift — see Blocker 5). Note the
  error and carry on with the rest; the scripts are independent sections.
