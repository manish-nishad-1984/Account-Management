import { useMemo, useState } from "react";
import clsx from "clsx";
import type { ColumnDef } from "@tanstack/react-table";
import {
  SITE_LOCATION_SORT_FIELDS,
  type SiteLocationRow,
} from "@accountmanagement/contracts";
import { Plus, Upload } from "lucide-react";
import { DataGrid, ExportExcelButton, RowActions } from "../../components/DataGrid";
import type { ExportColumn } from "../../lib/grid-export";
import { Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { useDeleteSiteLocations, useSiteLocationList } from "./api";
import { LocationImportDialog } from "./LocationImportDialog";
import { SiteLocationFormDialog } from "./SiteLocationFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";

/** What the sheet holds, column for column — the screen's own columns, as text. */
export const EXPORT_COLUMNS: ExportColumn<SiteLocationRow>[] = [
  { header: "Site", width: 30, value: (row) => row.siteName },
  { header: "Locations", width: 10, align: "right", value: (row) => row.locationCount },
  { header: "With address", width: 14, align: "right", value: (row) => row.addressCount },
  // The list carries only the first few names; the count above is the full one.
  { header: "Location names", width: 50, value: (row) => row.locationNames.join(", ") },
];

/**
 * Site Location — the screen that was Site Groups, renamed and reshaped by the
 * business on 15 Sep 2026 and again on 17 Sep, when a location and its address
 * became one PAIR. One row per site that has any.
 *
 * The rights are still the `group` ones: they were granted on the legacy Group
 * form, and renaming the subject would take the screen from everyone who has it.
 */
export function SiteLocationsPage() {
  const canAdd = usePermission("group", "add");
  const canEdit = usePermission("group", "edit");
  const [importOpen, setImportOpen] = useState(false);
  const screen = useMasterScreen<SiteLocationRow>({
    defaultSortBy: "siteName",
  });
  const query = useSiteLocationList(screen.listParams);
  const remove = useDeleteSiteLocations();

  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<SiteLocationRow, unknown>[]>(
    () => [
      {
        id: "siteName",
        header: "Site",
        cell: ({ row }) => (
          <div className="font-medium text-slate-900">
            {row.original.siteName}
          </div>
        ),
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
        header: "With address",
        /*
          A PROGRESS figure, not a second list's length. Migration 0020 carried
          every old address across as a pair with no name, so a site can hold
          pairs that are half filled in either direction — and "16 locations, 6
          with an address" is what someone tidying this up needs to see without
          opening the form. Amber while any pair is still missing its address.
        */
        cell: ({ row }) => {
          const { addressCount, locationCount } = row.original;
          const complete = addressCount === locationCount;
          return (
            <span
              className={clsx(
                "tabular inline-flex min-w-6 justify-center rounded-md px-1.5 py-0.5 text-xs font-medium",
                complete
                  ? "bg-slate-100 text-slate-600"
                  : "bg-amber-50 text-amber-700",
              )}
              title={
                complete
                  ? "Every location here has an address"
                  : `${locationCount - addressCount} of these have no address yet`
              }
            >
              {addressCount}/{locationCount}
            </span>
          );
        },
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
      />

      <DataGrid<SiteLocationRow>
        // One row above the grid (client request, 18 Sep 2026): the screen's
        // filters beside the search box and its actions at the right-hand end.
        actions={
          <>
            <ExportExcelButton<SiteLocationRow>
              resource="site-locations"
              params={screen.listParams}
              columns={EXPORT_COLUMNS}
              sheetName="Site locations"
              fileName="Site-Locations"
            />
            {canAdd && canEdit && (
              <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
                Import locations
              </Button>
            )}
            {canAdd && (
              <Button icon={Plus} onClick={screen.openCreate}>
                Add site location
              </Button>
            )}
          </>
        }
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

      <LocationImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete site location"
        typeToConfirm={screen.deleteTarget?.siteName ?? ""}
        body={
          <>
            <p>
              Remove every location and address of{" "}
              <span className="font-medium text-slate-900">
                {screen.deleteTarget?.siteName}
              </span>
              ?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The site itself is not affected. Orders and invoices that already
              name one of these locations keep showing it.
            </p>
          </>
        }
      />
    </>
  );
}
