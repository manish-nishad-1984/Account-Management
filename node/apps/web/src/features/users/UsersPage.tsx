import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  DEFAULT_PAGE_SIZE,
  USER_SORT_FIELDS,
  type SortDirection,
  type UserRow,
} from "@accountmanagement/contracts";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { DataGrid } from "../../components/DataGrid";
import { Badge, Button, PageHeader } from "../../components/ui";
import { useUserList } from "./api";
import { ApiError } from "../../lib/api-client";
import { usePermission } from "../../lib/permissions";

export function UsersPage() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<string>("userName");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const canAdd = usePermission("user", "add");

  // Cursors are a stack: each page pushes the cursor that produced it, so
  // "Previous" pops rather than re-querying from the start.
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];

  const query = useUserList({
    limit: DEFAULT_PAGE_SIZE,
    cursor,
    sortBy,
    sortDir,
    search: search.trim() || undefined,
  });

  const resetPaging = () => setCursors([]);

  const columns = useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      {
        id: "userName",
        header: "User",
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
              {row.original.firstName.slice(0, 1)}
              {row.original.lastName.slice(0, 1)}
            </div>
            <div>
              <div className="font-medium text-slate-900">{row.original.userName}</div>
              <div className="text-xs text-slate-500">
                {row.original.firstName} {row.original.lastName}
              </div>
            </div>
          </div>
        ),
      },
      { id: "email", header: "Email", accessorKey: "email" },
      {
        id: "phoneNo",
        header: "Phone",
        cell: ({ row }) => <span className="tabular text-slate-600">{row.original.phoneNo}</span>,
      },
      {
        id: "siteCount",
        header: "Sites",
        cell: ({ row }) => <span className="tabular inline-flex min-w-6 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{row.original.siteCount}</span>,
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <Badge dot tone={row.original.isActive ? "success" : "neutral"}>
              {row.original.isActive ? "Active" : "Inactive"}
            </Badge>
            {row.original.passwordIsLegacy && (
              <Badge
                tone="warning"
                title="Password is still the plaintext value migrated from SQL Server. It is hashed automatically the next time this user signs in."
              >
                Legacy password
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {row.original.capabilities.canEdit && (
              <Button variant="ghost" icon={Pencil} className="px-2 py-1 text-xs" aria-label={`Edit ${row.original.userName}`}>
                Edit
              </Button>
            )}
            {row.original.capabilities.canDelete && (
              <Button variant="ghost" icon={Trash2} className="px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700" aria-label={`Delete ${row.original.userName}`}>
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
        title="Users"
        description="System users, their sites and permissions"
        actions={canAdd ? <Button icon={Plus}>Add user</Button> : undefined}
      />

      <DataGrid<UserRow>
        columns={columns}
        rows={query.data?.rows ?? []}
        total={query.data?.total ?? null}
        isLoading={query.isLoading}
        searchPlaceholder="Search name, username or email"
        error={
          query.error
            ? query.error instanceof ApiError
              ? query.error.message
              : "Could not load users"
            : null
        }
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          resetPaging();
        }}
        sortBy={sortBy}
        sortDir={sortDir}
        sortableFields={USER_SORT_FIELDS}
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
        emptyMessage="No users match this search"
      />
    </>
  );
}
