import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  DEFAULT_PAGE_SIZE,
  SITE_SORT_FIELDS,
  type SiteRow,
  type SortDirection,
} from "@accountmanagement/contracts";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { DataGrid } from "../../components/DataGrid";
import { Badge, Button, PageHeader } from "../../components/ui";
import { useSiteList } from "./api";
import { ApiError } from "../../lib/api-client";
import { usePermission } from "../../lib/permissions";

const Absent = () => <span className="text-slate-300">—</span>;

export function SitesPage() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<string>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const canAdd = usePermission("site", "add");

  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];

  const query = useSiteList({
    limit: DEFAULT_PAGE_SIZE,
    cursor,
    sortBy,
    sortDir,
    search: search.trim() || undefined,
  });

  const resetPaging = () => setCursors([]);

  const columns = useMemo<ColumnDef<SiteRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Site",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.name}</div>
            <div className="text-xs text-slate-500">
              {row.original.contactPersonName ?? "No contact recorded"}
            </div>
          </div>
        ),
      },
      {
        id: "contactPersonPhoneNo",
        header: "Contact",
        cell: ({ row }) =>
          row.original.contactPersonPhoneNo ? (
            <span className="tabular text-slate-600">{row.original.contactPersonPhoneNo}</span>
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
        id: "userCount",
        header: "Users",
        cell: ({ row }) => (
          <span
            className="tabular inline-flex min-w-6 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
            title="Users assigned to this site"
          >
            {row.original.userCount}
          </span>
        ),
      },
      {
        id: "groupCount",
        header: "Groups",
        cell: ({ row }) => (
          <span
            className="tabular inline-flex min-w-6 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
            title="Site groups this site belongs to"
          >
            {row.original.groupCount}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge dot tone={row.original.isActive ? "success" : "neutral"}>
            {row.original.isActive ? "Active" : "Inactive"}
          </Badge>
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
        title="Sites"
        description="Project sites, their contacts and the groups they belong to"
        actions={canAdd ? <Button icon={Plus}>Add site</Button> : undefined}
      />

      <DataGrid<SiteRow>
        columns={columns}
        rows={query.data?.rows ?? []}
        total={query.data?.total ?? null}
        isLoading={query.isLoading}
        searchPlaceholder="Search site, area or contact"
        error={
          query.error
            ? query.error instanceof ApiError
              ? query.error.message
              : "Could not load sites"
            : null
        }
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          resetPaging();
        }}
        sortBy={sortBy}
        sortDir={sortDir}
        sortableFields={SITE_SORT_FIELDS}
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
        emptyMessage="No sites match this search"
      />
    </>
  );
}
