<#
.SYNOPSIS
    Runs the three read-only extraction scripts against DBAccManegment and writes
    their output into Migration-Assessment/db-extract/.

.DESCRIPTION
    Replaces the manual SSMS procedure (connect, switch Results-to-Text, change the
    max-characters-per-column setting, run, Save Results As, repeat three times).

    Everything these scripts do is READ-ONLY. They create nothing, change nothing,
    and take no locks beyond what a SELECT takes.

    The password is NEVER passed on the command line -- that would expose it in the
    process list and in your shell history. It is handed to sqlcmd through the
    SQLCMDPASSWORD environment variable, which is cleared again when the run ends.

.PARAMETER Server
    Server and port. Defaults to the production host recorded in the assessment.

.PARAMETER Database
    Database name. Defaults to DBAccManegment.

.PARAMETER User
    SQL login. Defaults to 'sa'. NOTE: this credential is pending rotation --
    see SESSION-HANDOFF.md section 8. Use the rotated password.

.PARAMETER Only
    Which scripts to run: schema, perf, census. Defaults to all three.
    Script 02 (perf) reads DMV counters that reset when SQL Server restarts, so it
    is worth running separately after a full working day of normal production load.

.PARAMETER TrustServerCertificate
    Passes -C to sqlcmd. On by default: the server presents a self-signed
    certificate and the existing application connects with Encrypt=False.

.EXAMPLE
    .\run-db-extract.ps1
    Prompts for the password, runs all three, writes three files into db-extract/.

.EXAMPLE
    $env:ACC_DB_PASSWORD = '<rotated password>'
    .\run-db-extract.ps1 -Only census
    Runs only the orphan census, without prompting.

.EXAMPLE
    .\run-db-extract.ps1 -Only perf
    Run this one on its own, at the end of a normal working day.
#>

[CmdletBinding()]
param(
    [string]   $Server   = 'srv1925876.hstgr.cloud,1433',
    [string]   $Database = 'DBAccManegment',
    [string]   $User     = 'sa',
    [ValidateSet('schema', 'perf', 'census')]
    [string[]] $Only     = @('schema', 'perf', 'census'),
    [switch]   $TrustServerCertificate = $true
)

$ErrorActionPreference = 'Stop'

$toolsDir  = $PSScriptRoot
$outputDir = Join-Path (Split-Path $toolsDir -Parent) 'db-extract'

# ---------------------------------------------------------------------------
# The three scripts. 'Delimited' controls output shape:
#   01 and 02 hold DDL and query text -- they need column width, so they get the
#   default space-aligned layout with -y 8192 (the SSMS "8192 characters" setting).
#   03 is entirely counts -- pipe-delimited so it can be parsed and pasted into a
#   spreadsheet without hand-editing.
# ---------------------------------------------------------------------------
$scripts = @(
    [pscustomobject]@{ Key = 'schema'; Script = '01-extract-mssql-schema.sql';        Output = '01-schema.txt'; Delimited = $false; Label = 'Schema, indexes, constraints, procs' }
    [pscustomobject]@{ Key = 'perf';   Script = '02-extract-perf-dmv.sql';            Output = '02-perf.txt';   Delimited = $false; Label = 'Performance DMVs (measured evidence)' }
    [pscustomobject]@{ Key = 'census'; Script = '03-orphan-and-duplicate-census.sql'; Output = '03-census.txt'; Delimited = $true;  Label = 'Orphan and duplicate census' }
)

# --- locate sqlcmd ---------------------------------------------------------
function Find-Sqlcmd {
    $candidates = @(
        'C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\180\Tools\Binn\SQLCMD.EXE',
        'C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE'
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    $onPath = Get-Command sqlcmd -ErrorAction SilentlyContinue
    if ($null -ne $onPath) { return $onPath.Source }
    throw "sqlcmd not found. Install the SQL Server command line tools, or run the three scripts in tools/ manually through SSMS (see db-extract/README.md)."
}

$sqlcmd = Find-Sqlcmd
Write-Host "sqlcmd : $sqlcmd"
Write-Host "server : $Server"
Write-Host "database: $Database"
Write-Host "user   : $User"
Write-Host "output : $outputDir"
Write-Host ""

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

# --- password: env var, else prompt ----------------------------------------
$password = $env:ACC_DB_PASSWORD
if ([string]::IsNullOrEmpty($password)) {
    $secure = Read-Host -Prompt "Password for '$User' on $Server" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}
if ([string]::IsNullOrEmpty($password)) {
    throw "No password supplied. Set `$env:ACC_DB_PASSWORD or enter it when prompted."
}

$selected = $scripts | Where-Object { $Only -contains $_.Key }
$results  = @()

try {
    # sqlcmd reads this instead of -P, so the password never reaches the process list
    $env:SQLCMDPASSWORD = $password

    foreach ($s in $selected) {
        $scriptPath = Join-Path $toolsDir $s.Script
        $outputPath = Join-Path $outputDir $s.Output

        if (-not (Test-Path $scriptPath)) {
            throw "Missing script: $scriptPath"
        }

        Write-Host ("-" * 70)
        Write-Host "Running $($s.Script)"
        Write-Host "  $($s.Label)"

        # -y 8192  variable-length column width (the SSMS Results-to-Text setting)
        # -l 30    login timeout; query timeout is left at 0 = wait indefinitely
        # -C       trust the server certificate
        # NO -b:   an error in one section must not abort the remaining sections.
        #          The scripts are independent; a failure is itself a finding
        #          (schema drift), and is recorded inline in the output file.
        $sqlArgs = @(
            '-S', $Server
            '-d', $Database
            '-U', $User
            '-i', $scriptPath
            '-o', $outputPath
            '-y', '8192'
            '-l', '30'
        )
        if ($TrustServerCertificate) { $sqlArgs += '-C' }
        if ($s.Delimited) { $sqlArgs += @('-s', '|', '-W') }

        $started = Get-Date
        & $sqlcmd @sqlArgs
        $exit = $LASTEXITCODE
        $elapsed = (Get-Date) - $started

        $lines = 0
        if (Test-Path $outputPath) {
            $lines = (Get-Content $outputPath | Measure-Object -Line).Lines
        }

        if ($exit -eq 0) {
            Write-Host ("  OK  {0} -- {1} lines in {2:n0}s" -f $s.Output, $lines, $elapsed.TotalSeconds) -ForegroundColor Green
        } else {
            Write-Host ("  sqlcmd exited {0} -- check {1}" -f $exit, $s.Output) -ForegroundColor Yellow
        }

        $results += [pscustomobject]@{
            Script  = $s.Script
            Output  = $s.Output
            Exit    = $exit
            Lines   = $lines
            Seconds = [math]::Round($elapsed.TotalSeconds)
        }
    }
} finally {
    # never leave the password behind in the session
    Remove-Item Env:\SQLCMDPASSWORD -ErrorAction SilentlyContinue
    $password = $null
}

Write-Host ""
Write-Host ("=" * 70)
$results | Format-Table -AutoSize

# ---------------------------------------------------------------------------
# Census summary -- the question this whole exercise exists to answer.
# Non-zero means rows that PostgreSQL will refuse a foreign key over, and that
# the ETL must therefore clean, quarantine or reject before cutover.
# ---------------------------------------------------------------------------
$censusPath = Join-Path $outputDir '03-census.txt'
if (($Only -contains 'census') -and (Test-Path $censusPath)) {
    Write-Host ""
    Write-Host "ORPHAN CENSUS SUMMARY" -ForegroundColor Cyan
    Write-Host ("-" * 70)

    $offenders = @()
    $failures  = @()
    foreach ($line in Get-Content $censusPath) {
        # A section that errored did not run, so its zero is not a real zero.
        # Surface these FIRST -- a partial census that reads as clean is the one
        # genuinely dangerous outcome of this whole exercise.
        if ($line -match '^Msg \d+, Level \d+') {
            $failures += $line.Trim()
        }
        elseif ($line -match "^(Invalid object name|Invalid column name)") {
            $failures += $line.Trim()
        }
        # pipe-delimited rows look like:  <label>|<count>
        elseif ($line -match '^(.+)\|\s*(\d+)\s*$') {
            $label = $matches[1].Trim()
            $count = [int]$matches[2]
            # skip the ---- separator rows sqlcmd prints under each header
            if ($label -notmatch '^-+$' -and $count -gt 0) {
                $offenders += [pscustomobject]@{ Finding = $label; Rows = $count }
            }
        }
    }

    if ($failures.Count -gt 0) {
        Write-Host ("{0} section(s) FAILED to run -- this census is INCOMPLETE:" -f $failures.Count) -ForegroundColor Red
        $failures | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        Write-Host ""
        Write-Host "A failed section reports no orphans because it never looked." -ForegroundColor Red
        Write-Host "Each failure is also a finding in its own right: the live schema"
        Write-Host "differs from the EF model the scripts were written against."
        Write-Host ""
    }

    if ($offenders.Count -eq 0) {
        Write-Host "No non-zero counts found." -ForegroundColor Green
        Write-Host "Confirm against the file itself before trusting this -- the summary"
        Write-Host "below is a best-effort parse, not a substitute for reading 03-census.txt."
    } else {
        $offenders | Sort-Object Rows -Descending | Format-Table -AutoSize
        Write-Host ("{0} non-zero findings. Every one is remediation work that must be" -f $offenders.Count) -ForegroundColor Yellow
        Write-Host "scoped BEFORE a migration date is committed."
        Write-Host ""
        Write-Host "Best-effort parse: it reads the last numeric column of each row, so"
        Write-Host "check anything surprising against 03-census.txt directly."
    }
}

Write-Host ""
Write-Host "Done. Output is in $outputDir"
Write-Host "Commit the three .txt files -- they are the evidence the schema work builds on."
