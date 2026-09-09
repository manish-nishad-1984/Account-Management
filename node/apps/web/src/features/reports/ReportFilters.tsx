import { RotateCcw, Search } from "lucide-react";
import { Button, SelectField, TextField } from "../../components/ui";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { useCompanyOptions, useSupplierOptions } from "../purchase-orders/api";
import type { ReportQuery } from "./api";

/**
 * The seven filters both report panels carry, and the Reset beside them.
 *
 * The legacy screen has `filterType` as a string switch over `currentMonth`,
 * `tillMonth`, `currentYear` and `betweenYear`, each computing a date range in
 * C# — four server code paths that produce two dates, and one of them
 * (`betweenYear`) parses the year out of a string with
 * `int.Parse("20" + years[1])`, so it stops working in 2100 and throws on any
 * label that is not `NN-NN`. The presets are built here instead and the API
 * takes two dates.
 *
 * APPLIED ON SUBMIT, not on change. These reports scan every document for a
 * party; re-running them on each keystroke of a date is the kind of thing that
 * makes a report screen feel broken. The legacy screen has a magnifier button
 * for the same reason.
 */

export interface FilterState {
  companyId: string;
  siteId: string;
  partyId: string;
  fromDate: string;
  toDate: string;
}

export const EMPTY_FILTERS: FilterState = {
  companyId: "",
  siteId: "",
  partyId: "",
  fromDate: "",
  toDate: "",
};

/** The financial year runs April to March, as `FinancialYear.cs` defines it. */
export function financialYearRange(today = new Date()): { fromDate: string; toDate: string } {
  const year = today.getUTCFullYear();
  const startYear = today.getUTCMonth() >= 3 ? year : year - 1;
  return {
    fromDate: `${startYear}-04-01`,
    toDate: `${startYear + 1}-03-31`,
  };
}

export const toQuery = (filters: FilterState): ReportQuery => ({
  companyId: filters.companyId || undefined,
  siteId: filters.siteId || undefined,
  partyId: filters.partyId || undefined,
  fromDate: filters.fromDate || undefined,
  toDate: filters.toDate || undefined,
});

export function ReportFilters({
  value,
  onChange,
  onApply,
  onReset,
  partyLabel,
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
  onApply: () => void;
  onReset: () => void;
  partyLabel: string;
}) {
  const scope = useSiteScope();
  const suppliers = useSupplierOptions();
  const companies = useCompanyOptions();

  const set = (change: Partial<FilterState>) => onChange({ ...value, ...change });

  return (
    <form
      className="mb-4 rounded-xl border border-slate-200/80 bg-white p-3 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <SelectField
          label="Company"
          value={value.companyId}
          onChange={(event) => set({ companyId: event.target.value })}
          options={[
            { value: "", label: "All companies" },
            ...(companies.data?.rows ?? []).map((company) => ({
              value: company.id,
              label: company.name,
            })),
          ]}
        />

        <SelectField
          label="Site"
          value={value.siteId}
          onChange={(event) => set({ siteId: event.target.value })}
          options={[
            { value: "", label: "All sites" },
            ...scope.sites.map((site) => ({ value: site.id, label: site.name })),
          ]}
        />

        <SelectField
          label={partyLabel}
          value={value.partyId}
          onChange={(event) => set({ partyId: event.target.value })}
          options={[
            { value: "", label: "All" },
            ...(suppliers.data?.rows ?? []).map((supplier) => ({
              value: supplier.id,
              label: supplier.name,
            })),
          ]}
        />

        <TextField
          label="From"
          type="date"
          value={value.fromDate}
          onChange={(event) => set({ fromDate: event.target.value })}
        />
        <TextField
          label="To"
          type="date"
          value={value.toDate}
          onChange={(event) => set({ toDate: event.target.value })}
        />

        <div className="flex items-end gap-2">
          <Button type="submit" icon={Search}>
            Search
          </Button>
          <Button type="button" variant="secondary" icon={RotateCcw} onClick={onReset}>
            Reset
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          className="rounded-full px-2 py-0.5 text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"
          onClick={() => onChange({ ...value, ...financialYearRange() })}
        >
          This financial year
        </button>
        <button
          type="button"
          className="rounded-full px-2 py-0.5 text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
          onClick={() => onChange({ ...value, fromDate: "", toDate: "" })}
        >
          All dates
        </button>
      </div>
    </form>
  );
}
