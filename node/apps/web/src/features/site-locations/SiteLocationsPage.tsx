import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { SITE_LOCATION_SORT_FIELDS, type SiteLocationRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { useDeleteSiteLocations, useSiteLocationList } from "./api";
import { SiteLocationFormDialog } from "./SiteLocationFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";

/**
 * Site Location — the screen that was Site Groups, renamed and reshaped by the
 * business on 15 Sep 2026. One row per site that has locations or addresses.
 *
 * The rights are still the `group` ones: they were granted on the legacy Group
 * form, and renaming the subject would take the screen from everyone who has it.
 */
export function SiteLocationsPage() {
  const canAdd = usePermission("group", "add");
  const screen = useMasterScreen<SiteLocationRow>({ defaultSortBy: "siteName" });
  const query = useSiteLocationList(screen.listParams);
  const remove = useDeleteSiteLocations();

  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<SiteLocationRow, unknown>[]>(
    () => [
      {
        id: "siteName",
        header: "Site",
        cell: ({ row }) => <div className="font-medium text-slate-900">{row.original.siteName}</div>,
      },
      {
        id: "locationCount",
        header: "Locations",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="tabular inline-flex min-w-6 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
              {row.original.locationCount}
            </span>
            <span className="text-xs text-slate-500">
              {row.original.locationNames.join(", ")}
              {row.original.locationCount > row.original.locationNames.length &&
                ` +${row.original.locationCount - row.original.locationNames.length} more`}
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
            title="Addresses offered as shipping addresses for this site"
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
            label={row.original.siteName}
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
        title="Site Location"
        description="The locations inside each site, and the addresses its deliveries can go to"
        actions={
          canAdd ? (
            <Button icon={Plus} onClick={screen.openCreate}>
              Add site location
            </Button>
          ) : undefined
        }
      />

      <DataGrid<SiteLocationRow>
        gridKey="site-locations"
        columns={columns}
        searchPlaceholder="Search site or location"
        sortableFields={SITE_LOCATION_SORT_FIELDS}
        emptyMessage="No site locations match this search"
        {...screen.gridProps(query)}
      />

      <SiteLocationFormDialog
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
        title="Delete site location"
        body={
          <>
            <p>
              Remove every location and address of{" "}
              <span className="font-medium text-slate-900">{screen.deleteTarget?.siteName}</span>?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The site itself is not affected. Orders and invoices that already name one of these
              locations keep showing it.
            </p>
          </>
        }
      />
    </>
  );
}
