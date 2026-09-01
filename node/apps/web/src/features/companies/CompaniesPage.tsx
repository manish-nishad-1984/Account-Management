import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  COMPANY_SORT_FIELDS,
  DEFAULT_PAGE_SIZE,
  type CompanyRow,
  type SortDirection,
} from "@accountmanagement/contracts";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { DataGrid } from "../../components/DataGrid";
import { Button, PageHeader } from "../../components/ui";
import { useCompanyList } from "./api";
import { ApiError } from "../../lib/api-client";
import { usePermission } from "../../lib/permissions";

/** Renders a value that the source data is allowed to be missing, without lying. */
const Absent = () => <span className="text-slate-300">—</span>;

export function CompaniesPage() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<string>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const canAdd = usePermission("company", "add");

  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];

  const query = useCompanyList({
    limit: DEFAULT_PAGE_SIZE,
    cursor,
    sortBy,
    sortDir,
    search: search.trim() || undefined,
  });

  const resetPaging = () => setCursors([]);

  const columns = useMemo<ColumnDef<CompanyRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Company",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.name}</div>
            <div className="tabular text-xs text-slate-500">
              {row.original.panNo ?? "PAN not recorded"}
            </div>
          </div>
        ),
      },
      {
        id: "gstNo",
        header: "GST number",
        cell: ({ row }) =>
          row.original.gstNo ? (
            <span className="tabular text-slate-600">{row.original.gstNo}</span>
          ) : (
            <Absent />
          ),
      },
      {
        id: "invoicePrefix",
        header: "Invoice prefix",
        cell: ({ row }) =>
          row.original.invoicePrefix ? (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium tracking-wide text-slate-600">
              {row.original.invoicePrefix}
            </span>
          ) : (
            <Absent />
          ),
      },
      {
        id: "area",
        header: "Location",
        cell: ({ row }) =>
          row.original.area || row.original.pincode ? (
            <div>
              <div className="text-slate-700">{row.original.area ?? ""}</div>
              <div className="tabular text-xs text-slate-500">{row.original.pincode ?? ""}</div>
            </div>
          ) : (
            <Absent />
          ),
      },
      {
        id: "bankName",
        header: "Bank",
        cell: ({ row }) =>
          row.original.bankName ? (
            <span className="text-slate-600">{row.original.bankName}</span>
          ) : (
            <Absent />
          ),
      },
      {
        id: "userCount",
        header: "Users",
        cell: ({ row }) => (
          <span
            className="tabular inline-flex min-w-6 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
            title="Users assigned to this company"
          >
            {row.original.userCount}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {row.original.capabilities.canEdit && (
              <Button
                variant="ghost"
                icon={Pencil}
                className="px-2 py-1 text-xs"
                aria-label={`Edit ${row.original.name}`}
              >
                Edit
              </Button>
            )}
            {row.original.capabilities.canDelete && (
              <Button
                variant="ghost"
                icon={Trash2}
                className="px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                aria-label={`Delete ${row.original.name}`}
              >
                Delete
              </Button>
            )}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Companies"
        description="Billing entities — GST registration, invoice prefix and bank details"
        actions={canAdd ? <Button icon={Plus}>Add company</Button> : undefined}
      />

      <DataGrid<CompanyRow>
        columns={columns}
        rows={query.data?.rows ?? []}
        total={query.data?.total ?? null}
        isLoading={query.isLoading}
        searchPlaceholder="Search name, GST or PAN"
        error={
          query.error
            ? query.error instanceof ApiError
              ? query.error.message
              : "Could not load companies"
            : null
        }
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          resetPaging();
        }}
        sortBy={sortBy}
        sortDir={sortDir}
        sortableFields={COMPANY_SORT_FIELDS}
        onSortChange={(field, direction) => {
          setSortBy(field);
          setSortDir(direction);
          resetPaging();
        }}
        pageIndex={cursors.length}
        canGoBack={cursors.length > 0}
        canGoForward={Boolean(query.data?.nextCursor)}
        onPrevious={() => setCursors((stack) => stack.slice(0, -1))}
        onNext={() => {
          const next = query.data?.nextCursor;
          if (next) setCursors((stack) => [...stack, next]);
        }}
        emptyMessage="No companies match this search"
      />
    </>
  );
}
