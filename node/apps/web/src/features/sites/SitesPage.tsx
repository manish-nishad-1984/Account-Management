import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { SITE_SORT_FIELDS, type SiteRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Badge, Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { useDeleteSite, useSiteList } from "./api";
import { SiteFormDialog } from "./SiteFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";

const Absent = () => <span className="text-slate-300">—</span>;

export function SitesPage() {
  const canAdd = usePermission("site", "add");
  const screen = useMasterScreen<SiteRow>({ defaultSortBy: "name" });
  const query = useSiteList(screen.listParams);
  const remove = useDeleteSite();

  const { openEdit, askDelete } = screen;

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
        title="Sites"
        description="Project sites, their contacts and the groups they belong to"
        actions={
          canAdd ? (
            <Button icon={Plus} onClick={screen.openCreate}>
              Add site
            </Button>
          ) : undefined
        }
      />

      <DataGrid<SiteRow>
        gridKey="sites"
        columns={columns}
        searchPlaceholder="Search site, area or contact"
        sortableFields={SITE_SORT_FIELDS}
        emptyMessage="No sites match this search"
        {...screen.gridProps(query)}
      />

      <SiteFormDialog
        open={screen.isFormOpen}
        siteId={screen.editingId}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete site"
        body={
          <>
            <p>
              Delete <span className="font-medium text-slate-900">{screen.deleteTarget?.name}</span>?
            </p>
            {/*
              Worth stating up front: this delete is refused outright while users
              are assigned or the site belongs to a group, and site groups are
              read-only in this app, so a group membership has to be cleared in
              the database rather than on a screen.
            */}
            <p className="mt-2 text-xs text-slate-500">
              The site is marked deleted and hidden from every list. It is refused
              while users are assigned to it, or while it belongs to a site group.
            </p>
          </>
        }
      />
    </>
  );
}
