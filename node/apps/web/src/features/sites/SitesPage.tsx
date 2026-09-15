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
              {/* The first contact is shown; the rest are on the form. */}
              {row.original.contactCount > 1 && ` +${row.original.contactCount - 1} more`}
            </div>
          </div>
        ),
      },
      {
        id: "contactPersonPhoneNo",
        header: "Contact",
        /*
          ONE NUMBER PER LINE, because the legacy field holds several.

          Live data has rows like `9624972802,7567501707,98982598555` in this
          one column — 33 characters that cannot wrap, since a phone number is
          `.tabular` and so `nowrap`. That single cell held the site list 321px
          wide and was the last grid still scrolling sideways on the live site.
          Split, it is three short lines, each still unbreakable in itself, and
          easier to read besides.
        */
        cell: ({ row }) => {
          const numbers = (row.original.contactPersonPhoneNo ?? "")
            .split(",")
            .map((number) => number.trim())
            .filter((number) => number !== "");

          if (numbers.length === 0) return <Absent />;
          return (
            <div className="tabular text-slate-600">
              {/* Indexed: the same number twice in one field is untidy data, not a crash. */}
              {numbers.map((number, index) => (
                <div key={`${number}-${index}`}>{number}</div>
              ))}
            </div>
          );
        },
      },
      {
        id: "area",
        // "Area", not "Location": since 15 Sep 2026 a location is a place
        // inside a site, with its own screen and its own count column below.
        header: "Area",
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
        id: "locationCount",
        header: "Locations",
        cell: ({ row }) => (
          <span
            className="tabular inline-flex min-w-6 justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
            title="Locations recorded for this site on the Site Location screen"
          >
            {row.original.locationCount}
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
        description="Project sites, their contacts and their addresses"
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
              are assigned or the site still has locations. Both are fixable on a
              screen — the locations on Site Location.
            */}
            <p className="mt-2 text-xs text-slate-500">
              The site is marked deleted and hidden from every list. It is refused
              while users are assigned to it, or while it still has site locations.
            </p>
          </>
        }
      />
    </>
  );
}
