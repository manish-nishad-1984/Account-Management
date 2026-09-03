# db-extract — put the script outputs here

Three read-only scripts in [`../tools/`](../tools/) measure what the code analysis
could not: the real indexes and constraints, the measured query cost, and — most
importantly — **how many orphan rows exist across the ~62 reference columns that
have no foreign key behind them**.

Until these have been run, no target schema can be finalised and the ETL cannot be
written. This is the binding constraint on the whole migration.

---

## The short way (recommended)

```powershell
cd Migration-Assessment\tools
.\run-db-extract.ps1
```

That runs all three scripts and writes `01-schema.txt`, `02-perf.txt` and
`03-census.txt` into this folder, then prints a summary of every non-zero orphan
count it found. It prompts for the password once and never writes it anywhere.

Useful variations:

```powershell
.\run-db-extract.ps1 -Only census        # just the orphan census
.\run-db-extract.ps1 -Only perf          # run this at the END of a working day
$env:ACC_DB_PASSWORD = '<pw>'; .\run-db-extract.ps1   # no prompt
```

The script needs `sqlcmd`, which ships with SSMS and with the SQL Server ODBC
client tools. It finds it automatically.

### Read the summary carefully

The script ends with an **orphan census summary**. Two things to know about it:

- **Failed sections are reported first, in red.** A section that errored reports no
  orphans *because it never looked*. A partial census that reads as clean is the
  one genuinely dangerous outcome here. An error is also a finding in its own
  right — it means the live schema has drifted from the EF model.
- **The summary is a best-effort parse** of the last numeric column of each row.
  It is a fast read of the answer, not a replacement for reading `03-census.txt`.

---

## The manual way (SSMS, if sqlcmd is unavailable)

| Run this | Save output as |
|---|---|
| `tools/01-extract-mssql-schema.sql` | `01-schema.txt` |
| `tools/02-extract-perf-dmv.sql` | `02-perf.txt` |
| `tools/03-orphan-and-duplicate-census.sql` | `03-census.txt` |

1. Connect to `srv1925876.hstgr.cloud,1433`, select database **DBAccManegment**
2. **Query → Results To → Results to Text** (or `Ctrl+T`)
3. **Tools → Options → Query Results → SQL Server → Results to Text**
   → set *Maximum number of characters displayed in each column* to **8192**
   (the default 256 will truncate stored procedure and index definitions)
4. Open the script, press **F5**
5. **File → Save Results As…** → save into this folder with the name above

Note that the runner writes `03-census.txt` **pipe-delimited** so it can be parsed
and pasted into a spreadsheet. SSMS will give you the space-aligned form instead.
Either is fine to commit; only the automatic summary depends on the delimiters.

---

## Before you run

**Rotate the `sa` password first.** It is in git history and must be treated as
public — see `SESSION-HANDOFF.md` §8. Run these scripts with the rotated
credential, not the old one.

All three scripts are READ-ONLY. They create nothing, change nothing, and take no
locks beyond what a `SELECT` takes. Running them against production is safe; that
is the point, since production is the only place the answer exists.

---

## Notes

- Script 02 reads DMV statistics that reset on SQL Server restart. Check the
  `hours_of_history` value in its section 0 — if it is very low, the server
  restarted recently and the numbers are not yet representative. Re-run it after
  a full working day of normal load.
- Script 03 is the important one. It measures the referential-integrity gap that
  is currently the largest unknown in the migration schedule.
- If any query errors because a table or column name differs from what the EF
  model said, that is itself a finding (schema drift — see Blocker 5). The runner
  surfaces these; note them and carry on, as the scripts are independent sections.
- **Commit the three `.txt` files.** They are the evidence every subsequent schema
  and ETL decision is built on.
