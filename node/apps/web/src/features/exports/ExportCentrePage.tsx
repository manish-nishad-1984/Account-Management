import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Check, CheckCircle2, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { hasPermission, type DateBasis, type GridWorkbookSheet } from "@accountmanagement/contracts";
import { Alert, Button, Card, PageHeader, SelectField, TextField } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { downloadWorkbook } from "../../lib/grid-export";
import { useCompanyOptions } from "../purchase-orders/api";
import { EXPORT_DATASETS, EXPORT_GROUPS, EXPORT_PACKS, type ExportChoices, type ExportDataset } from "./datasets";
import { DATE_PRESETS, describeRange, presetDates, presetOf } from "./date-presets";

/**
 * THE EXCEL EXPORT CENTRE (client, 20 Oct 2026): every module's export in one
 * place — tick what you want, set the dates once, get ONE Excel file with a
 * sheet for each and a Summary sheet saying what was exported.
 *
 * Built so the person does not have to think: the dates default to this
 * financial year, packs tick the usual sets in one click, each tick says which
 * date it is counted by, and the masters say they are exported whole. A sheet
 * the person cannot see on its own screen is not offered here either.
 */

const REMEMBERED = "export-centre:chosen:v1";

function remembered(): string[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(REMEMBERED) ?? "null");
    return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

type Progress = { state: "waiting" | "working" | "done" | "failed"; rows?: number };

const BASES: { value: DateBasis; label: string; hint: string }[] = [
  { value: "document", label: "Document date", hint: "The bill's, payment's or income's own date" },
  { value: "entry", label: "Entry date", hint: "The day it was entered in the software" },
];

export function ExportCentrePage() {
  const { user } = useAuth();
  const scope = useSiteScope();
  const companies = useCompanyOptions();
  const today = useMemo(() => new Date(), []);

  const offered = useMemo(
    () => EXPORT_DATASETS.filter((dataset) => hasPermission(user?.permissions ?? [], dataset.permission, "view")),
    [user?.permissions],
  );

  const [chosen, setChosen] = useState<Set<string>>(() => new Set(remembered()));
  const [{ fromDate, toDate }, setDates] = useState(() => presetDates("fy", today));
  const [dateBasis, setDateBasis] = useState<DateBasis>("document");
  const [companyId, setCompanyId] = useState("");
  const [siteId, setSiteId] = useState(scope.siteId ?? "");
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [finished, setFinished] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(REMEMBERED, JSON.stringify([...chosen]));
    } catch {
      // A private window: the ticks are simply not remembered.
    }
  }, [chosen]);

  const picked = offered.filter((dataset) => chosen.has(dataset.key));
  const preset = presetOf(fromDate, toDate, today);
  const anyDated = picked.some((dataset) => dataset.dateLabel);

  const toggle = (key: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const setMany = (keys: string[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  const companyName = (companies.data?.rows ?? []).find((row) => row.id === companyId)?.name ?? "All companies";
  const siteName = scope.sites.find((site) => site.id === siteId)?.name ?? "All sites";

  const run = async () => {
    setBusy(true);
    setFailed(null);
    setFinished(null);
    setProgress(Object.fromEntries(picked.map((dataset) => [dataset.key, { state: "waiting" }])));
    const choices: ExportChoices = { fromDate, toDate, dateBasis, companyId, siteId };
    const sheets: GridWorkbookSheet[] = [];
    try {
      for (const dataset of picked) {
        setProgress((current) => ({ ...current, [dataset.key]: { state: "working" } }));
        try {
          const sheet = await dataset.sheet(choices);
          sheets.push(sheet);
          setProgress((current) => ({ ...current, [dataset.key]: { state: "done", rows: sheet.rows.length } }));
        } catch (error) {
          setProgress((current) => ({ ...current, [dataset.key]: { state: "failed" } }));
          throw new Error(`${dataset.label}: ${error instanceof Error ? error.message : "could not be read"}`);
        }
      }
      const fileName = `Account-Book-${fromDate || "start"}-to-${toDate || "today"}`;
      await downloadWorkbook([summarySheet(picked, sheets, { fromDate, toDate, dateBasis, companyName, siteName }), ...sheets], fileName);
      const rows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
      setFinished(`${fileName}.xlsx — ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}, ${rows.toLocaleString("en-IN")} rows`);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "The export could not be produced.");
    } finally {
      setBusy(false);
    }
  };

  const siteOptions = [
    ...(scope.canSelectAll ? [{ value: "", label: "All sites" }] : []),
    ...scope.sites.map((site) => ({ value: site.id, label: site.name })),
  ];
  const companyOptions = [
    { value: "", label: "All companies" },
    ...(companies.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name })),
  ];

  return (
    <>
      <PageHeader
        title="Excel Export"
        description="Tick what you need, set the dates once, and get one Excel file with a sheet for each."
      />

      {offered.length === 0 ? (
        <Alert tone="neutral">You do not have access to any screen that can be exported. Ask an administrator.</Alert>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs font-medium text-slate-600">Quick pick:</span>
                {EXPORT_PACKS.map((pack) => {
                  const keys = pack.keys.filter((key) => offered.some((dataset) => dataset.key === key));
                  if (keys.length === 0) return null;
                  return (
                    <Button key={pack.label} variant="secondary" onClick={() => setMany(keys, true)}>
                      {pack.label}
                    </Button>
                  );
                })}
                <Button variant="secondary" onClick={() => setMany(offered.map((dataset) => dataset.key), true)}>
                  Everything
                </Button>
                <Button variant="ghost" onClick={() => setChosen(new Set())} disabled={chosen.size === 0}>
                  Clear
                </Button>
              </div>
            </Card>

            {EXPORT_GROUPS.map((group) => {
              const inGroup = offered.filter((dataset) => dataset.group === group);
              if (inGroup.length === 0) return null;
              const allOn = inGroup.every((dataset) => chosen.has(dataset.key));
              return (
                <Card key={group}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">{group}</h2>
                      <p className="text-xs text-slate-500">
                        {group === "Masters" ? "Always the full list — dates do not apply." : "Only the records in your date range."}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs font-medium text-brand-700 hover:underline"
                      onClick={() => setMany(inGroup.map((dataset) => dataset.key), !allOn)}
                    >
                      {allOn ? "Untick all" : "Tick all"}
                    </button>
                  </div>
                  <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {inGroup.map((dataset) => (
                      <DatasetTick
                        key={dataset.key}
                        dataset={dataset}
                        on={chosen.has(dataset.key)}
                        progress={progress[dataset.key]}
                        basis={dateBasis}
                        onChange={(on) => toggle(dataset.key, on)}
                      />
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>

          <Card className="space-y-4 lg:sticky lg:top-4">
            <section aria-labelledby="export-dates" className="space-y-2.5">
              <h2 id="export-dates" className="text-sm font-semibold text-slate-900">
                Dates
              </h2>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range">
                {DATE_PRESETS.map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    aria-pressed={preset === choice.key}
                    onClick={() => setDates(presetDates(choice.key, today))}
                    className={clsx(
                      "rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
                      preset === choice.key
                        ? "bg-brand-600 text-white ring-brand-600"
                        : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
                    )}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TextField label="From" type="date" value={fromDate} onChange={(event) => setDates({ fromDate: event.target.value, toDate })} />
                <TextField label="To" type="date" value={toDate} onChange={(event) => setDates({ fromDate, toDate: event.target.value })} />
              </div>
              <fieldset>
                <legend className="text-xs font-medium text-slate-600">Count by</legend>
                <div className="mt-1 grid gap-1.5">
                  {BASES.map((basis) => (
                    <label
                      key={basis.value}
                      className={clsx(
                        "flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-1.5 ring-1 ring-inset",
                        dateBasis === basis.value ? "bg-brand-50 ring-brand-500" : "ring-slate-200 hover:bg-slate-50",
                      )}
                    >
                      <input
                        type="radio"
                        name="date-basis"
                        className="mt-0.5 size-4 text-brand-600 focus:ring-brand-500"
                        checked={dateBasis === basis.value}
                        onChange={() => setDateBasis(basis.value)}
                      />
                      <span className="text-sm text-slate-800">
                        {basis.label}
                        <span className="block text-xs text-slate-500">{basis.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>

            <section aria-label="Company and site" className="grid gap-2">
              <SelectField label="Company" value={companyId} options={companyOptions} onChange={(event) => setCompanyId(event.target.value)} />
              <SelectField label="Site" value={siteId} options={siteOptions} onChange={(event) => setSiteId(event.target.value)} />
              <p className="text-xs text-slate-500">Applied to each sheet that has a company or a site.</p>
            </section>

            <section className="space-y-2 border-t border-slate-200 pt-3">
              <p className="text-sm text-slate-700">
                {picked.length === 0 ? (
                  "Nothing ticked yet."
                ) : (
                  <>
                    <strong>{picked.length}</strong> sheet{picked.length === 1 ? "" : "s"}
                    {anyDated && <> · {describeRange(fromDate, toDate)}</>}
                  </>
                )}
              </p>
              <Button
                className="w-full justify-center"
                icon={Download}
                onClick={() => void run()}
                disabled={picked.length === 0}
                loading={busy}
                loadingLabel="Preparing the file…"
              >
                Export to Excel
              </Button>
              {failed && (
                <Alert icon={AlertTriangle}>{failed}</Alert>
              )}
              {finished && (
                <Alert tone="success" icon={CheckCircle2}>
                  Downloaded {finished}
                </Alert>
              )}
            </section>
          </Card>
        </div>
      )}
    </>
  );
}

function DatasetTick({
  dataset,
  on,
  progress,
  basis,
  onChange,
}: {
  dataset: ExportDataset;
  on: boolean;
  progress?: Progress;
  basis: DateBasis;
  onChange: (on: boolean) => void;
}) {
  const by = dataset.dateLabel ? (basis === "entry" ? "Entry date" : dataset.dateLabel) : null;
  return (
    <li>
      <label
        className={clsx(
          "flex h-full cursor-pointer items-start gap-2.5 rounded-lg p-2.5 ring-1 ring-inset transition-colors",
          on ? "bg-brand-50 ring-brand-500" : "bg-white ring-slate-200 hover:bg-slate-50",
        )}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500 focus:ring-offset-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
            <FileSpreadsheet aria-hidden className="size-3.5 shrink-0 text-emerald-600" />
            {dataset.label}
          </span>
          <span className="block text-xs text-slate-500">{dataset.hint}</span>
          <span className="mt-1 block text-[11px] text-slate-500">{by ? `By ${by.toLowerCase()}` : "Full list"}</span>
        </span>
        <ProgressMark progress={progress} />
      </label>
    </li>
  );
}

function ProgressMark({ progress }: { progress?: Progress }) {
  if (!progress) return null;
  if (progress.state === "working") return <Loader2 aria-label="Reading" className="size-4 shrink-0 animate-spin text-brand-600" />;
  if (progress.state === "failed") return <AlertTriangle aria-label="Failed" className="size-4 shrink-0 text-rose-600" />;
  if (progress.state === "done")
    return (
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-700">
        <Check aria-hidden className="size-3.5" />
        {(progress.rows ?? 0).toLocaleString("en-IN")}
      </span>
    );
  return null;
}

/** The first sheet: what is in the file and how it was chosen, so a forwarded file explains itself. */
export function summarySheet(
  datasets: ExportDataset[],
  sheets: GridWorkbookSheet[],
  filters: { fromDate: string; toDate: string; dateBasis: DateBasis; companyName: string; siteName: string },
): GridWorkbookSheet {
  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return {
    sheetName: "Summary",
    columns: [
      { header: "Sheet", width: 28, align: "left" },
      { header: "Rows", width: 10, align: "right" },
      { header: "Filtered by", width: 60, align: "left" },
    ],
    rows: [
      ["Exported on", "", stamp],
      ["Dates", "", describeRange(filters.fromDate, filters.toDate)],
      ["Counted by", "", filters.dateBasis === "entry" ? "Entry date (the day it was entered)" : "Each record's own date"],
      ["Company", "", filters.companyName],
      ["Site", "", filters.siteName],
      ["", "", ""],
      ...datasets.map((dataset, at) => [
        sheets[at]?.sheetName ?? dataset.label,
        String(sheets[at]?.rows.length ?? 0),
        dataset.dateLabel
          ? [
              filters.dateBasis === "entry" ? "Entry date" : dataset.dateLabel,
              dataset.byCompany ? "company" : null,
              dataset.bySite ? "site" : null,
            ]
              .filter(Boolean)
              .join(", ")
          : "Full list",
      ]),
    ],
  };
}
