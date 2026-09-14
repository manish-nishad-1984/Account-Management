import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { SITE_GROUP_SORT_FIELDS, type SiteGroupRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { useDeleteSiteGroup, useSiteGroupList } from "./api";
import { SiteGroupFormDialog } from "./SiteGroupFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";

/**
 * Site groups.
 *
 * READ-ONLY UNTIL 14 Sep 2026, and the screen said so in a notice: the .NET
 * solution defines `Group-View` and no other group permission, so changing a
 * group was unauthorised there — assessment finding C-6.
 *
 * The business asked for it, and the rights were already in the data.
 * Permissions are rows in `user_form_permissions` with separate view, add, edit
 * and delete flags, and the live rows grant all four on the Group form to two
 * users. The old app simply never read three of those columns for this form. So
 * the buttons below are gated on rights that already existed, and the server
 * checks each of them again.
 */
export function SiteGroupsPage() {
  const canAdd = usePermission("group", "add");
  const screen = useMasterScreen<SiteGroupRow>({ defaultSortBy: "name" });
  const query = useSiteGroupList(screen.listParams);
  const remove = useDeleteSiteGroup();

  const { openEdit, askDelete } = screen;

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
          <RowActions
            capabilities={row.original.capabilities}
            label={row.original.name}
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
        title="Site Groups"
        description="Named sets of sites, used to scope purchase orders and supplier invoices"
        actions={
          canAdd ? (
            <Button icon={Plus} onClick={screen.openCreate}>
              Add group
            </Button>
          ) : undefined
        }
      />

      <DataGrid<SiteGroupRow>
        gridKey="site-groups"
        columns={columns}
        searchPlaceholder="Search group name"
        sortableFields={SITE_GROUP_SORT_FIELDS}
        emptyMessage="No site groups match this search"
        {...screen.gridProps(query)}
      />

      <SiteGroupFormDialog
        open={screen.isFormOpen}
        groupId={screen.editingId}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete site group"
        body={
          <>
            <p>
              Delete{" "}
              <span className="font-medium text-slate-900">{screen.deleteTarget?.name}</span>?
            </p>
            {/*
              Worth saying before the click: the group's own rows go with it, and
              the delete is refused outright while a document still names it.
            */}
            <p className="mt-2 text-xs text-slate-500">
              The group is marked deleted and hidden from every list. Its member sites
              are not affected. It is refused while a purchase order or a purchase
              invoice still uses the group.
            </p>
          </>
        }
      />
    </>
  );
}
