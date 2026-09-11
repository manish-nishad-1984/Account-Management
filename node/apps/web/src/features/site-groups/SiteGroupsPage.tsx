import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  DEFAULT_PAGE_SIZE,
  SITE_GROUP_SORT_FIELDS,
  type SiteGroupRow,
  type SortDirection,
} from "@accountmanagement/contracts";
import { Info, Pencil, Plus, Trash2 } from "lucide-react";
import { DataGrid } from "../../components/DataGrid";
import { Alert, Button, PageHeader } from "../../components/ui";
import { useSiteGroupList } from "./api";
import { ApiError } from "../../lib/api-client";
import { usePermission } from "../../lib/permissions";

export function SiteGroupsPage() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<string>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const canAdd = usePermission("group", "add");

  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];

  const query = useSiteGroupList({
    limit: DEFAULT_PAGE_SIZE,
    cursor,
    sortBy,
    sortDir,
    search: search.trim() || undefined,
  });

  const resetPaging = () => setCursors([]);

  const columns = useMemo<ColumnDef<SiteGroupRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Group",
        cell: ({ row }) => <div className="font-medium text-slate-900">{row.original.name}</div>,
      },
      {
        id: "siteCount",
        header: "Sites",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="tabular inline-flex min-w-6 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
              {row.original.siteCount}
            </span>
            <span className="truncate text-xs text-slate-500">
              {row.original.siteNames.join(", ")}
              {row.original.siteCount > row.original.siteNames.length &&
                ` +${row.original.siteCount - row.original.siteNames.length} more`}
            </span>
          </div>
        ),
      },
      {
        id: "addressCount",
        header: "Addresses",
        cell: ({ row }) => (
          <span
            className="tabular inline-flex min-w-6 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
            title="Delivery addresses recorded against this group"
          >
            {row.original.addressCount}
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
                className="px-2 py-2 lg:py-1.5"
                aria-label={`Edit ${row.original.name}`}
                title={`Edit ${row.original.name}`}
              />
            )}
            {row.original.capabilities.canDelete && (
              <Button
                variant="ghost"
                icon={Trash2}
                className="px-2 py-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 lg:py-1.5"
                aria-label={`Delete ${row.original.name}`}
                title={`Delete ${row.original.name}`}
              />
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
        title="Site Groups"
        description="Named sets of sites, used to scope purchase orders and supplier invoices"
        actions={canAdd ? <Button icon={Plus}>Add group</Button> : undefined}
      />

      {/*
       * Not a placeholder and not an error. `Group-View` is the only group
       * permission that exists in the .NET solution — there is no Group-Add,
       * Group-Edit or Group-Delete attribute anywhere — so nobody holds rights to
       * change a group, and the row actions above render for nobody. Saying so is
       * better than a grid that looks half-built.
       */}
      <div className="mb-4">
        <Alert tone="info" icon={Info}>
        Site groups are read-only. The existing application defines only a
        &ldquo;Group-View&rdquo; permission — no add, edit or delete right exists for
        groups, so creating and removing them is currently unauthorised. Confirm with
        the business before write access is added.
        </Alert>
      </div>

      <DataGrid<SiteGroupRow>
        gridKey="site-groups"
        columns={columns}
        rows={query.data?.rows ?? []}
        total={query.data?.total ?? null}
        isLoading={query.isLoading}
        searchPlaceholder="Search group name"
        error={
          query.error
            ? query.error instanceof ApiError
              ? query.error.message
              : "Could not load site groups"
            : null
        }
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          resetPaging();
        }}
        sortBy={sortBy}
        sortDir={sortDir}
        sortableFields={SITE_GROUP_SORT_FIELDS}
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
        emptyMessage="No site groups match this search"
      />
    </>
  );
}
