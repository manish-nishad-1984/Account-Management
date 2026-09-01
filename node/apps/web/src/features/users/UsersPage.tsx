import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { USER_SORT_FIELDS, type UserRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Badge, Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { useDeleteUser, useUserList } from "./api";
import { UserFormDialog } from "./UserFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";

export function UsersPage() {
  const canAdd = usePermission("user", "add");
  const screen = useMasterScreen<UserRow>({ defaultSortBy: "userName" });
  const query = useUserList(screen.listParams);
  const remove = useDeleteUser();

  const { openEdit, askDelete } = screen;

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
        cell: ({ row }) => (
          <span className="tabular inline-flex min-w-6 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
            {row.original.siteCount}
          </span>
        ),
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
                title="Password is still the plaintext value migrated from SQL Server. It is hashed on this user's next successful sign-in, or when an administrator sets a new one."
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
          <RowActions
            capabilities={row.original.capabilities}
            label={row.original.userName}
            onEdit={() => openEdit(row.original.id)}
            onDelete={() => askDelete(row.original)}
          />
        ),
      },
    ],
    [openEdit, askDelete],
  );

  return (
    <>
      <PageHeader
        title="Users"
        description="System users, their sites and permissions"
        actions={
          canAdd ? (
            <Button icon={Plus} onClick={screen.openCreate}>
              Add user
            </Button>
          ) : undefined
        }
      />

      <DataGrid<UserRow>
        columns={columns}
        searchPlaceholder="Search name, username or email"
        sortableFields={USER_SORT_FIELDS}
        emptyMessage="No users match this search"
        {...screen.gridProps(query)}
      />

      <UserFormDialog
        open={screen.isFormOpen}
        userId={screen.editingId}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete user"
        body={
          <>
            <p>
              Delete{" "}
              <span className="font-medium text-slate-900">{screen.deleteTarget?.userName}</span>?
            </p>
            {/*
              Say that sign-out is not immediate. A soft delete revokes the
              refresh token, but an access token already issued runs to expiry —
              that is the accepted cost of stateless auth, and it is better said
              here than discovered.
            */}
            <p className="mt-2 text-xs text-slate-500">
              The account is deactivated and hidden, and its refresh tokens are
              revoked. An access token already issued stays valid until it expires.
            </p>
          </>
        }
      />
    </>
  );
}
