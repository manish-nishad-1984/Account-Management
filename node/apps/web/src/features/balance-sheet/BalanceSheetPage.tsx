import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BalanceSheetRow } from "@accountmanagement/contracts";
import { Alert, PageHeader, SelectField, TextField } from "../../components/ui";
import { useScopedSiteId, useSiteScope } from "../../contexts/SiteScopeContext";
import { ApiError } from "../../lib/api-client";
import { formatDate, formatMoney } from "../../lib/format";
import { useCompanyOptions } from "../purchase-orders/api";
import { useBalanceSheet, useBalanceSheetDetail, type BalanceSheetFilters } from "./api";

/**
 * The site-wise Balance Sheet (9 Oct 2026): per project, what came in and what
 * went out. Follows the project in the header like the other reports; choose
 * "All sites" there to compare projects side by side.
 *
 *   Cash balance    = income - paid      what is in hand for the project
 *   Project result  = income - billed    where it stands once the dues are met
 *
 * A row opens to the income entries and the suppliers behind it.
 */
const Signed = ({ value }: { value: string }) => (
  <span className={`tabular block text-right font-semibold ${Number(value) < 0 ? "text-rose-700" : "text-slate-900"}`}>
    {formatMoney(value)}
  </span>
);

const Plain = ({ value, className = "text-slate-700" }: { value: string; className?: string }) => (
  <span className={`tabular block text-right ${className}`}>{formatMoney(value)}</span>
);

function Detail({ siteId, filters }: { siteId: string; filters: Omit<BalanceSheetFilters, "siteId"> }) {
  const detail = useBalanceSheetDetail(siteId, filters);
  if (detail.isLoading) return <p className="px-4 py-3 text-sm text-slate-500">Loading…</p>;
  if (!detail.data) return <p className="px-4 py-3 text-sm text-rose-700">Could not load this project.</p>;
  const { incomes, suppliers } = detail.data;
  return (
    <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Income received</h3>
        {incomes.length === 0 ? (
          <p className="text-sm text-slate-500">No income recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {incomes.map((one) => (
                <tr key={one.id}>
                  <td className="tabular py-1 pr-3 text-slate-600">{formatDate(one.incomeDate)}</td>
                  <td className="py-1 pr-3 text-slate-800">
                    {one.clientName} <span className="text-xs text-slate-500">· {one.companyName}</span>
                  </td>
                  <td className="tabular py-1 text-right font-medium text-slate-900">{formatMoney(one.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Suppliers</h3>
        {suppliers.length === 0 ? (
          <p className="text-sm text-slate-500">No supplier bills or payments.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-3 text-left font-medium">Supplier</th>
                <th className="py-1 text-right font-medium">Billed</th>
                <th className="py-1 text-right font-medium">Paid</th>
                <th className="py-1 text-right font-medium">To pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {suppliers.map((one) => (
                <tr key={one.partyId}>
                  <td className="py-1 pr-3 text-slate-800">{one.partyName}</td>
                  <td className="tabular py-1 text-right text-slate-700">{formatMoney(one.billed)}</td>
                  <td className="tabular py-1 text-right text-slate-700">{formatMoney(one.paid)}</td>
                  <td className="tabular py-1 text-right font-medium text-slate-900">{formatMoney(one.stillToPay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function BalanceSheetPage() {
  const scope = useSiteScope();
  const { siteId, isReady } = useScopedSiteId();
  const [companyId, setCompanyId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const companies = useCompanyOptions();

  const filters = useMemo<BalanceSheetFilters>(
    () => ({ siteId, companyId, fromDate, toDate }),
    [siteId, companyId, fromDate, toDate],
  );
  const detailFilters = useMemo(() => ({ companyId, fromDate, toDate }), [companyId, fromDate, toDate]);
  const sheet = useBalanceSheet(filters, isReady);

  const companyOptions = [
    { value: "", label: "All companies" },
    ...(companies.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name })),
  ];

  const rows: BalanceSheetRow[] = sheet.data?.rows ?? [];
  const totals = sheet.data?.totals;

  return (
    <>
      <PageHeader
        title="Balance Sheet"
        description={`Project-wise: what came in and what went out${scope.siteName ? ` - ${scope.siteName}` : ""}`}
      />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <SelectField label="Company" value={companyId} options={companyOptions} onChange={(e) => setCompanyId(e.target.value)} />
        </div>
        <div className="w-44">
          <TextField label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="w-44">
          <TextField label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      {sheet.error && (
        <Alert className="mb-3">
          {sheet.error instanceof ApiError ? sheet.error.message : "Could not load the balance sheet"}
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
        <table className="w-full min-w-[60rem] border-collapse text-sm">
          <thead className="bg-surface-muted text-xs text-slate-600">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Project</th>
              <th className="px-4 py-2.5 text-right font-medium">Income</th>
              <th className="px-4 py-2.5 text-right font-medium" title="Purchase invoices less returns">Billed</th>
              <th className="px-4 py-2.5 text-right font-medium">Paid</th>
              <th className="px-4 py-2.5 text-right font-medium">Still to pay</th>
              <th className="px-4 py-2.5 text-right font-medium" title="Income less what has been paid">Cash balance</th>
              <th className="px-4 py-2.5 text-right font-medium" title="Income less what has been billed">Project result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sheet.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!sheet.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Nothing recorded for this selection yet
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const key = row.siteId ?? "none";
              const isOpen = open === key;
              return (
                <Fragment key={key}>
                  <tr
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => row.siteId && setOpen(isOpen ? null : key)}
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-900">
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
                    <td className="px-4 py-2.5"><Plain value={row.income} className="text-emerald-700" /></td>
                    <td className="px-4 py-2.5"><Plain value={row.billed} /></td>
                    <td className="px-4 py-2.5"><Plain value={row.paid} /></td>
                    <td className="px-4 py-2.5"><Plain value={row.stillToPay} /></td>
                    <td className="px-4 py-2.5"><Signed value={row.cashBalance} /></td>
                    <td className="px-4 py-2.5"><Signed value={row.projectResult} /></td>
                  </tr>
                  {isOpen && row.siteId && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={7}>
                        <Detail siteId={row.siteId} filters={detailFilters} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot className="bg-surface-muted font-semibold">
              <tr>
                <td className="px-4 py-2.5 text-slate-900">Total</td>
                <td className="px-4 py-2.5"><Plain value={totals.income} className="text-emerald-700" /></td>
                <td className="px-4 py-2.5"><Plain value={totals.billed} className="text-slate-900" /></td>
                <td className="px-4 py-2.5"><Plain value={totals.paid} className="text-slate-900" /></td>
                <td className="px-4 py-2.5"><Plain value={totals.stillToPay} className="text-slate-900" /></td>
                <td className="px-4 py-2.5"><Signed value={totals.cashBalance} /></td>
                <td className="px-4 py-2.5"><Signed value={totals.projectResult} /></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Income is the Final Total of each entry. Billed is purchase invoices less returns; opening balances are not counted.
        Cash balance is income less what has been paid; project result is income less what has been billed.
      </p>
    </>
  );
}
