import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Calculator, ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
  hasPermission,
  createBalanceSheetSchema,
  type BalanceSheetPreview,
  type BalanceSheetRow,
} from "@accountmanagement/contracts";
import { ExportExcelButton } from "../../components/DataGrid";
import { Alert, Button, FormDialog, FormSection, SelectField, TextField } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { useAuth } from "../../contexts/AuthContext";
import { ProjectDetail } from "../balance-sheet/ProjectDetail";
import { ClientIncomeFormDialog } from "../client-incomes/ClientIncomeFormDialog";
import { ApiError } from "../../lib/api-client";
import { formatMoney } from "../../lib/format";
import { exportAmount, type ExportColumn } from "../../lib/grid-export";
import { useCompanyOptions } from "../purchase-orders/api";
import { useCreateBalanceSheet, usePreviewBalanceSheet, useSavedBalanceSheet, useUpdateBalanceSheet } from "./api";

/** What the sheet's Excel holds: the projects, then the Total. */
export const SHEET_EXPORT_COLUMNS: ExportColumn<BalanceSheetRow>[] = [
  { header: "Project", width: 34, value: (row) => row.siteName },
  { header: "Income", width: 16, align: "right", value: (row) => exportAmount(row.income) },
  { header: "Billed", width: 16, align: "right", value: (row) => exportAmount(row.billed) },
  { header: "Paid", width: 16, align: "right", value: (row) => exportAmount(row.paid) },
  { header: "Still to pay", width: 16, align: "right", value: (row) => exportAmount(row.stillToPay) },
  { header: "Salary", width: 16, align: "right", value: (row) => exportAmount(row.salary) },
  { header: "Cash balance", width: 16, align: "right", value: (row) => exportAmount(row.cashBalance) },
  { header: "Project result", width: 16, align: "right", value: (row) => exportAmount(row.projectResult) },
];

const Num = ({ value, strong = false }: { value: string; strong?: boolean }) => (
  <td
    className={`tabular px-3 py-1.5 text-right ${strong ? "font-semibold" : ""} ${Number(value) < 0 ? "text-rose-700" : "text-slate-900"}`}
  >
    {formatMoney(value)}
  </td>
);

/**
 * Make, view or change a saved Balance Sheet (client request, 14 Oct 2026).
 *
 * The person picks a company, the dates of the income to count and the dates of
 * the invoices to count, and presses GENERATE to see the sheet. It is SAVED only
 * once what is on screen was worked out from the filters as they now stand —
 * change a date and Save waits for another Generate, so what is kept is never a
 * sheet for different dates than the ones in the boxes.
 */
export function BalanceSheetFormDialog({
  open,
  sheetId,
  readOnly = false,
  onClose,
}: {
  open: boolean;
  sheetId: string | null;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const isEdit = sheetId !== null;
  const detail = useSavedBalanceSheet(open && isEdit ? sheetId : null);
  const companies = useCompanyOptions();
  // The site in the top header is where a NEW sheet starts; it can be changed here.
  const scope = useSiteScope();
  const preview = usePreviewBalanceSheet();
  const create = useCreateBalanceSheet();
  const update = useUpdateBalanceSheet();

  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [incomeFrom, setIncomeFrom] = useState("");
  const [incomeTo, setIncomeTo] = useState("");
  const [invoiceFrom, setInvoiceFrom] = useState("");
  const [invoiceTo, setInvoiceTo] = useState("");
  const [note, setNote] = useState("");
  const [generated, setGenerated] = useState<{ key: string; data: BalanceSheetPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A project opened to its income and suppliers, as on the report, and income
  // recorded from here (client, 22 Oct 2026: "all in one in balance sheet").
  const [openSite, setOpenSite] = useState<string | null>(null);
  const [addingIncome, setAddingIncome] = useState<{ siteId?: string } | null>(null);
  const { user } = useAuth();
  const canAddIncome = !readOnly && hasPermission(user?.permissions ?? [], "income", "add");

  /** The filters that decide the figures. Title and note do not. */
  const filterKey = (values: { companyId: string; siteId: string; incomeFrom: string; incomeTo: string; invoiceFrom: string; invoiceTo: string }) =>
    JSON.stringify([values.companyId, values.siteId, values.incomeFrom, values.incomeTo, values.invoiceFrom, values.invoiceTo]);
  const currentKey = filterKey({ companyId, siteId, incomeFrom, incomeTo, invoiceFrom, invoiceTo });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setOpenSite(null);
    preview.reset();
    if (!isEdit) {
      setTitle("");
      setCompanyId("");
      setSiteId(scope.siteId ?? "");
      setIncomeFrom("");
      setIncomeTo("");
      setInvoiceFrom("");
      setInvoiceTo("");
      setNote("");
      setGenerated(null);
    } else if (detail.data) {
      const d = detail.data;
      setTitle(d.title ?? "");
      setCompanyId(d.companyId ?? "");
      setSiteId(d.siteId ?? "");
      setIncomeFrom(d.incomeFrom ?? "");
      setIncomeTo(d.incomeTo ?? "");
      setInvoiceFrom(d.invoiceFrom ?? "");
      setInvoiceTo(d.invoiceTo ?? "");
      setNote(d.note ?? "");
      setGenerated({
        key: filterKey({
          companyId: d.companyId ?? "",
          siteId: d.siteId ?? "",
          incomeFrom: d.incomeFrom ?? "",
          incomeTo: d.incomeTo ?? "",
          invoiceFrom: d.invoiceFrom ?? "",
          invoiceTo: d.invoiceTo ?? "",
        }),
        data: { rows: d.rows, totals: d.figures },
      });
    }
    // `preview` is a new object each render; the form resets on open and on a loaded record only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, detail.data]);

  const body = useMemo(
    () => ({ title, companyId, siteId, incomeFrom, incomeTo, invoiceFrom, invoiceTo, note }),
    [title, companyId, siteId, incomeFrom, incomeTo, invoiceFrom, invoiceTo, note],
  );

  const parsed = () => {
    const result = createBalanceSheetSchema.safeParse(body);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Check the dates");
      return null;
    }
    return result.data;
  };

  const generate = async () => {
    setError(null);
    const values = parsed();
    if (!values) return;
    try {
      const data = await preview.mutateAsync(values);
      setGenerated({ key: currentKey, data });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The sheet could not be worked out");
    }
  };

  const current = generated !== null && generated.key === currentKey;

  const save = async () => {
    setError(null);
    const values = parsed();
    if (!values) return;
    if (!current) {
      setError("Generate the sheet first, so what is saved is the one you are looking at.");
      return;
    }
    try {
      if (isEdit) await update.mutateAsync({ id: sheetId, body: values });
      else await create.mutateAsync(values);
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The sheet could not be saved");
    }
  };

  const siteOptions = [
    // Only a user not tied to particular sites may leave it on every site.
    ...(scope.canSelectAll ? [{ value: "", label: "All sites" }] : []),
    ...scope.sites.map((row) => ({ value: row.id, label: row.name })),
  ];

  const companyOptions = [
    { value: "", label: "All companies" },
    ...(companies.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name })),
  ];

  const data = generated?.data ?? null;
  const exportRows: BalanceSheetRow[] = data ? [...data.rows, { siteId: null, siteName: "Total", ...data.totals }] : [];

  return (
    <>
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={() => void save()}
      title={isEdit ? "Balance sheet" : "New balance sheet"}
      description="Project-wise: what came in and what went out, for the dates you choose"
      formError={error}
      pending={create.isPending || update.isPending}
      submitLabel={isEdit ? "Save changes" : "Save balance sheet"}
      readOnly={readOnly}
      size="xl"
      footerStart={
        data && (
          <ExportExcelButton<BalanceSheetRow>
            resource="balance-sheets"
            rows={exportRows}
            columns={SHEET_EXPORT_COLUMNS}
            sheetName="Balance sheet"
            fileName="Balance-sheet"
          />
        )
      }
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading balance sheet…</p>
      ) : isEdit && detail.isError ? (
        <Alert icon={AlertTriangle}>This balance sheet could not be loaded. Close it and open it again.</Alert>
      ) : (
        <>
          <FormSection title="Sheet" columns={2}>
            <TextField label="Title" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
            <SelectField label="Company" value={companyId} options={companyOptions} onChange={(event) => setCompanyId(event.target.value)} />
            <SelectField label="Site" value={siteId} options={siteOptions} onChange={(event) => setSiteId(event.target.value)} />
            <TextField label="Note" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </FormSection>

          <FormSection title="Dates" columns={2}>
            <TextField label="Income from" type="date" value={incomeFrom} onChange={(event) => setIncomeFrom(event.target.value)} />
            <TextField label="Income to" type="date" value={incomeTo} onChange={(event) => setIncomeTo(event.target.value)} />
            <TextField label="Invoice from" type="date" value={invoiceFrom} onChange={(event) => setInvoiceFrom(event.target.value)} />
            <TextField label="Invoice to" type="date" value={invoiceTo} onChange={(event) => setInvoiceTo(event.target.value)} />
          </FormSection>
          <p className="-mt-2 text-xs text-slate-500">
            Income dates choose which income entries count. Invoice dates choose which bills and payments count.
            A blank date leaves that end open.
          </p>

          {!readOnly && (
            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" icon={Calculator} onClick={() => void generate()} loading={preview.isPending}>
                Generate
              </Button>
              {canAddIncome && (
                <Button type="button" variant="secondary" icon={Plus} onClick={() => setAddingIncome({})}>
                  Add income
                </Button>
              )}
              {data && !current && (
                <span className="text-xs text-amber-700">The filters changed. Generate again before saving.</span>
              )}
            </div>
          )}

          {data ? (
            <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200" aria-label="Balance sheet">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 text-right font-medium">Income</th>
                    <th className="px-3 py-2 text-right font-medium">Billed</th>
                    <th className="px-3 py-2 text-right font-medium">Paid</th>
                    <th className="px-3 py-2 text-right font-medium">Still to pay</th>
                    <th className="px-3 py-2 text-right font-medium">Salary</th>
                    <th className="px-3 py-2 text-right font-medium">Cash balance</th>
                    <th className="px-3 py-2 text-right font-medium">Project result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                        Nothing recorded for these filters
                      </td>
                    </tr>
                  )}
                  {data.rows.map((row) => {
                    const isOpen = row.siteId !== null && openSite === row.siteId;
                    return (
                      <Fragment key={row.siteId ?? "none"}>
                        <tr
                          className={row.siteId ? "cursor-pointer hover:bg-slate-50" : undefined}
                          onClick={() => row.siteId && setOpenSite(isOpen ? null : row.siteId)}
                        >
                          <td className="px-3 py-1.5 font-medium text-slate-900">
                            <span className="inline-flex items-center gap-1.5">
                              {row.siteId ? (
                                <button
                                  type="button"
                                  aria-label={`${isOpen ? "Hide" : "Show"} ${row.siteName}`}
                                  aria-expanded={isOpen}
                                  className="text-slate-400"
                                >
                                  {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                </button>
                              ) : (
                                <span className="size-4" />
                              )}
                              {row.siteName}
                            </span>
                          </td>
                          <Num value={row.income} />
                          <Num value={row.billed} />
                          <Num value={row.paid} />
                          <Num value={row.stillToPay} />
                          <Num value={row.salary} />
                          <Num value={row.cashBalance} strong />
                          <Num value={row.projectResult} strong />
                        </tr>
                        {isOpen && row.siteId && (
                          <tr className="bg-slate-50/60">
                            <td colSpan={8}>
                              <ProjectDetail
                                siteId={row.siteId}
                                filters={{ companyId, incomeFrom, incomeTo, invoiceFrom, invoiceTo }}
                                onAddIncome={canAddIncome ? () => setAddingIncome({ siteId: row.siteId! }) : undefined}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr>
                    <td className="px-3 py-2 font-semibold text-slate-900">Total</td>
                    <Num value={data.totals.income} strong />
                    <Num value={data.totals.billed} strong />
                    <Num value={data.totals.paid} strong />
                    <Num value={data.totals.stillToPay} strong />
                    <Num value={data.totals.salary} strong />
                    <Num value={data.totals.cashBalance} strong />
                    <Num value={data.totals.projectResult} strong />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            !readOnly && <Alert tone="info">Choose the company and dates, then press Generate to see the sheet.</Alert>
          )}
        </>
      )}
    </FormDialog>
    {/* Outside the form: a submit inside it would bubble to this one through the portal. */}
    <ClientIncomeFormDialog
      open={addingIncome !== null}
      incomeId={null}
      defaultSiteId={addingIncome?.siteId}
      defaultCompanyId={companyId || undefined}
      // The figures on screen count income: work them out again with it.
      onSaved={() => {
        if (generated) void generate();
      }}
      onClose={() => setAddingIncome(null)}
    />
    </>
  );
}
